/**
 * The combat state machine.
 *
 * Every exported function is a pure transition: it takes a `CombatState` and
 * returns a new one, never mutating the input. Randomness comes from the seed
 * carried in the state, so a battle replays identically given the same inputs.
 *
 * Turn shape:
 *
 *   player turn ─ select card → (select target) → resolve ─┐
 *        ▲                                                  │ repeat
 *        │                                                  ▼
 *   round++ ← enemy turn ← end-of-turn upkeep ← end turn ──┘
 */

import {
  drawCards,
  discardFromHand,
  refillHandTo,
  reshuffleDiscardIntoDraw,
  type Piles,
} from './deck';
import { nextRandom, shuffle, weightedPick } from './rng';
import {
  applyStatus,
  consumeBleedStack,
  consumeCounterStack,
  consumeUndyingStack,
  consumeOnTurnStart,
  consumeOnAttacked,
  consumeOnRest,
  extendPoisonDuration,
  isImmune,
  stacksOf,
  tickStatuses,
} from './status';
import {
  BLEED_MULTIPLIER,
  computeDamage,
  fatigueMultiplier,
  decideFirstTeam,
  effectiveDefense,
  missingStaminaBonus,
  mitigation,
  COUNTER_ATTACK_POWER,
  DEFAULT_TARGET_FOCUS,
  ENEMY_POWER_PER_STAMINA,
  RESTING_TARGET_WEIGHT,
  STAMINA_REGEN_FRACTION,
  SUPPORT_EFFECT_POWER,
  TARGET_SHARE_CAP,
  TARGET_STURDINESS_MAX,
  TARGET_STURDINESS_MIN,
  UNDYING_HEAL_FRACTION,
  WOUNDED_TARGET_THRESHOLD,
  WOUNDED_TARGET_WEIGHT,
  poisonTickDamage,
  staminaDrainFromDamage,
} from './stats';
import type {
  CardDefinition,
  PendingSelection,
  CombatEvent,
  CardEffect,
  CardInstanceId,
  CombatContent,
  CombatState,
  Combatant,
  CombatantId,
  EnemyAction,
  TargetKind,
  Team,
} from './types';

export const DEFAULT_HAND_LIMIT = 5;

// ── Cloning ─────────────────────────────────────────────────────────────────

function cloneCombatant(combatant: Combatant): Combatant {
  return {
    ...combatant,
    statuses: combatant.statuses.map((entry) => ({ ...entry, duration: { ...entry.duration } })),
  };
}

function cloneState(state: CombatState): CombatState {
  const combatants: Record<CombatantId, Combatant> = {};
  for (const [id, combatant] of Object.entries(state.combatants)) {
    combatants[id] = cloneCombatant(combatant);
  }

  return {
    ...state,
    combatants,
    playerOrder: [...state.playerOrder],
    enemyOrder: [...state.enemyOrder],
    drawPile: [...state.drawPile],
    hand: [...state.hand],
    discardPile: [...state.discardPile],
    exhaustPile: [...state.exhaustPile],
    cards: { ...state.cards },
    enemyQueue: [...state.enemyQueue],
    selection: state.selection
      ? { ...state.selection, cards: [...state.selection.cards] }
      : null,
    // Events describe only the step being taken, so every transition starts
    // from an empty list rather than inheriting the previous one.
    events: [],
    log: [...state.log],
  };
}

// ── Small accessors ─────────────────────────────────────────────────────────

function pilesOf(state: CombatState): Piles {
  return {
    drawPile: state.drawPile,
    hand: state.hand,
    discardPile: state.discardPile,
    seed: state.seed,
  };
}

function withPiles(state: CombatState, piles: Piles): CombatState {
  state.drawPile = piles.drawPile;
  state.hand = piles.hand;
  state.discardPile = piles.discardPile;
  state.seed = piles.seed;
  return state;
}

export function cardDefOf(
  state: CombatState,
  content: CombatContent,
  instanceId: CardInstanceId
): CardDefinition | null {
  const instance = state.cards[instanceId];
  if (!instance) return null;
  return content.cardDefs[instance.definitionId] ?? null;
}

/**
 * The card's Power, or null if it doesn't hit.
 *
 * Power is a percentage of the user's Attack, not a damage number — Power 60
 * lands at 60% of whoever plays it, so the same card reads differently in two
 * different hands. That is exactly why it is worth showing.
 *
 * A card that hits more than once reports its strongest hit; none of them pair
 * a headline attack with a bigger incidental one.
 *
 * Takes the effects rather than a whole card, so an enemy action — which is a
 * name and a list of effects with no deck or cost behind it — can be read the
 * same way, and Power means one thing across the game.
 */
export function cardPower(card: { effects: readonly CardEffect[] }): number | null {
  let strongest: number | null = null;

  for (const effect of card.effects) {
    if (
      effect.type !== 'damage' &&
      effect.type !== 'chainDamage' &&
      effect.type !== 'discardHandAndAttack'
    ) {
      continue;
    }
    if (strongest === null || effect.power > strongest) strongest = effect.power;
  }

  return strongest;
}

function teamMembers(state: CombatState, team: Team): Combatant[] {
  const order = team === 'player' ? state.playerOrder : state.enemyOrder;
  return order.map((id) => state.combatants[id]).filter((c): c is Combatant => c !== undefined);
}

/** Everyone in the fight, party first, each side in its own turn order. */
function allCombatants(state: CombatState): Combatant[] {
  return [...teamMembers(state, 'player'), ...teamMembers(state, 'enemy')];
}

/**
 * The defender currently drawing attacks for their team, if any.
 *
 * With two defenders taunting, the one holding more stacks takes it; ties go to
 * whoever appears first in team order, so the choice is at least deterministic.
 */
function taunterOf(state: CombatState, defendingTeam: Team): CombatantId | null {
  const taunters = teamMembers(state, defendingTeam)
    .filter((c) => !c.downed && stacksOf(c.statuses, 'taunt') > 0)
    .sort((a, b) => stacksOf(b.statuses, 'taunt') - stacksOf(a.statuses, 'taunt'));

  return taunters[0]?.id ?? null;
}

/**
 * Redirects a single-target attack to a taunting defender.
 *
 * Only redirects attacks — a card that merely debuffs is not "an attack", so
 * Taunt draws blows rather than curses.
 */
function redirectForTaunt(
  state: CombatState,
  defendingTeam: Team,
  chosen: CombatantId
): CombatantId {
  return taunterOf(state, defendingTeam) ?? chosen;
}

/**
 * Redirects an area attack onto a taunting defender.
 *
 * The taunter takes every hit the area would have dealt — one per target it
 * was going to strike, their own included — so a sweep across three allies is
 * three blows on the wall and none on anyone behind it. Anything riding on the
 * attack lands on the taunter the same number of times, because it is the same
 * blow landing.
 */
function redirectAreaForTaunt(
  state: CombatState,
  defendingTeam: Team,
  targets: CombatantId[]
): CombatantId[] {
  const taunter = taunterOf(state, defendingTeam);
  return taunter === null ? targets : targets.map(() => taunter);
}

/** Whether a set of effects actually constitutes an attack. */
function effectsAttack(effects: readonly CardEffect[]): boolean {
  return effects.some((effect) => effect.type === 'damage');
}

/** A character who can currently take an action. */
export function canAct(combatant: Combatant): boolean {
  return !combatant.downed && !combatant.resting;
}

function log(state: CombatState, line: string): void {
  state.log.push(line);
}

/** Records something for the arena to animate. */
function emit(state: CombatState, event: CombatEvent): void {
  state.events.push(event);
}

// ── Setup ───────────────────────────────────────────────────────────────────

export interface CreateCombatOptions {
  combatants: Combatant[];
  /** Card definition ids making up the shared draw pile, before shuffling. */
  deck: string[];
  seed?: number;
  handLimit?: number;
}

export function createCombat(options: CreateCombatOptions): CombatState {
  const { combatants, deck, seed = 1 } = options;
  const handLimit = options.handLimit ?? DEFAULT_HAND_LIMIT;

  const combatantMap: Record<CombatantId, Combatant> = {};
  const playerOrder: CombatantId[] = [];
  const enemyOrder: CombatantId[] = [];

  for (const combatant of combatants) {
    combatantMap[combatant.id] = cloneCombatant(combatant);
    if (combatant.team === 'player') playerOrder.push(combatant.id);
    else enemyOrder.push(combatant.id);
  }

  const cards: Record<CardInstanceId, { instanceId: CardInstanceId; definitionId: string }> = {};
  const drawPile: CardInstanceId[] = [];

  deck.forEach((definitionId, index) => {
    const instanceId = `c${index}`;
    cards[instanceId] = { instanceId, definitionId };
    drawPile.push(instanceId);
  });

  const first = decideFirstTeam(combatants);

  const state: CombatState = {
    combatants: combatantMap,
    playerOrder,
    enemyOrder,
    round: 1,
    activeTeam: first,
    cards,
    drawPile,
    hand: [],
    discardPile: [],
    exhaustPile: [],
    handLimit,
    phase: first === 'player' ? 'selectCard' : 'enemyTurn',
    pendingCard: null,
    selection: null,
    seed,
    enemyQueue: [],
    nextSummon: 1,
    events: [],
    log: [],
  };

  // Shuffle before dealing. `drawCards` only reshuffles once the draw pile runs
  // dry, so without this the opening hand would be the first five cards in
  // definition order — identical every battle.
  const shuffled = shuffle(drawPile, seed);
  const dealt = drawCards(
    { drawPile: shuffled.items, hand: [], discardPile: [], seed: shuffled.seed },
    handLimit
  );
  withPiles(state, dealt);

  log(state, `Battle begins. ${first === 'player' ? 'Your team' : 'The enemy'} is faster.`);

  // Winning initiative has to mean acting first, which takes a queue — the
  // phase alone is not enough. `stepEnemyTurn` shifts from `enemyQueue`, so an
  // enemy team that opened the battle with an empty one would hand the turn
  // straight back, and being the faster side would cost it a turn rather than
  // gain one.
  if (first === 'enemy') return beginEnemyTurn(state);

  return state;
}

// ── Targeting ───────────────────────────────────────────────────────────────

function effectsHeal(effects: readonly CardEffect[]): boolean {
  return effects.some((effect) => effect.type === 'heal' || effect.type === 'healPercent');
}

/** Whether a target kind needs the player to pick one specific combatant. */
export function needsTargetChoice(target: TargetKind): boolean {
  return target === 'oneAlly' || target === 'oneEnemy';
}

/**
 * Combatants a card may legally be aimed at.
 *
 * Downed allies are excluded unless the card heals — healing is what brings
 * them back, so a revive has to be able to select them, while a buff should not
 * be wasted on someone who is out.
 */
export function legalTargets(
  state: CombatState,
  content: CombatContent,
  instanceId: CardInstanceId
): CombatantId[] {
  const def = cardDefOf(state, content, instanceId);
  if (!def) return [];

  switch (def.target) {
    case 'oneAlly':
    case 'allAllies': {
      const allies = teamMembers(state, 'player');
      return (effectsHeal(def.effects) ? allies : allies.filter((c) => !c.downed)).map((c) => c.id);
    }
    case 'oneEnemy':
    case 'allEnemies':
      return teamMembers(state, 'enemy')
        .filter((c) => !c.downed)
        .map((c) => c.id);
    case 'self':
      return def.ownerId ? [def.ownerId] : [];
    case 'none':
      return [];
  }
}

// ── Playability ─────────────────────────────────────────────────────────────

export interface Playability {
  ok: boolean;
  reason?: string;
}

/**
 * Whether a card in hand can be played right now.
 *
 * A neutral card costs no stamina but still needs at least one character able
 * to act — the team can't regroup when everyone is flat on their back.
 */
export function canPlayCard(
  state: CombatState,
  content: CombatContent,
  instanceId: CardInstanceId
): Playability {
  if (state.phase === 'selecting') return { ok: false, reason: 'Finish choosing first' };
  if (state.phase !== 'selectCard' && state.phase !== 'selectTarget') {
    return { ok: false, reason: 'Not your turn' };
  }

  const def = cardDefOf(state, content, instanceId);
  if (!def) return { ok: false, reason: 'Unknown card' };
  if (!state.hand.includes(instanceId)) return { ok: false, reason: 'Card is not in hand' };

  if (def.ownerId === null) {
    const anyReady = teamMembers(state, 'player').some(canAct);
    return anyReady ? { ok: true } : { ok: false, reason: 'No one can act' };
  }

  const owner = state.combatants[def.ownerId];
  if (!owner) return { ok: false, reason: 'Owner not in this battle' };
  if (owner.downed) return { ok: false, reason: `${owner.name} is down` };
  if (owner.resting) return { ok: false, reason: `${owner.name} is resting` };

  if (legalTargets(state, content, instanceId).length === 0 && def.target !== 'none') {
    return { ok: false, reason: 'No valid target' };
  }

  return { ok: true };
}

// ── Effect resolution ───────────────────────────────────────────────────────

function resolveTargets(
  state: CombatState,
  def: CardDefinition,
  chosen: CombatantId | null
): CombatantId[] {
  switch (def.target) {
    case 'self':
      return def.ownerId ? [def.ownerId] : [];
    case 'oneAlly':
      return chosen ? [chosen] : [];
    case 'oneEnemy': {
      if (!chosen) return [];
      // Symmetric: if an enemy is taunting, the player must hit them too.
      return [effectsAttack(def.effects) ? redirectForTaunt(state, 'enemy', chosen) : chosen];
    }
    case 'allAllies':
      return teamMembers(state, 'player')
        .filter((c) => !c.downed || effectsHeal(def.effects))
        .map((c) => c.id);
    case 'allEnemies': {
      const living = teamMembers(state, 'enemy')
        .filter((c) => !c.downed)
        .map((c) => c.id);
      return effectsAttack(def.effects) ? redirectAreaForTaunt(state, 'enemy', living) : living;
    }
    case 'none':
      return [];
  }
}

/**
 * Applies one hit: bleed, immunity, damage, stamina drain, expiry, counter.
 *
 * `isCounter` is the recursion guard. A counter-attack must never itself
 * provoke a counter, or two characters holding stacks would volley until the
 * stack ran out — or forever, if either had a way to regain one.
 */
function dealDamage(
  state: CombatState,
  attacker: Combatant,
  target: Combatant,
  power: number,
  isCounter = false
): number {
  if (target.downed) return 0;

  let damage = computeDamage(attacker, target, power);

  // Bleed is consumed a stack at a time and amplifies the *final* damage, after
  // Attack and Defense have both been applied. An area attack therefore eats
  // one stack from each bleeding target it hits, not one stack in total.
  // A blocked attack still spends the stack — immunity stops the damage, not
  // the fact that a blow landed.
  //
  // Rounded rather than left raw: the multiplier is a tuning dial and need not
  // be a whole number, and half a point of damage would otherwise reach health,
  // the floating number and the log — nothing else in the game deals fractions.
  const bleed = consumeBleedStack(target.statuses);
  if (bleed.consumed) {
    target.statuses = bleed.statuses;
    damage = Math.max(1, Math.round(damage * BLEED_MULTIPLIER));
  }

  // Guarded while its side still stands. Applied to the final figure, after
  // Bleed, so it reads as a flat cut to whatever would have landed.
  if (target.damageTakenWithAllies !== undefined && hasStandingAlly(state, target)) {
    damage = Math.max(1, Math.round(damage * target.damageTakenWithAllies));
  }

  const immune = isImmune(target.statuses);

  emit(state, {
    type: 'attack',
    sourceId: attacker.id,
    targetId: target.id,
    damage: immune ? 0 : damage,
    bleed: bleed.consumed,
  });

  if (immune) {
    log(state, `${target.name} shrugs off ${attacker.name}'s attack.`);
  } else {
    applyDirectDamage(state, target, damage, true);
    log(
      state,
      `${attacker.name} hits ${target.name} for ${damage}${bleed.consumed ? ' (bleed)' : ''}.`
    );
  }

  target.statuses = consumeOnAttacked(target.statuses);

  // The counter fires even when the blow was blocked — being attacked is what
  // triggers it, not being hurt — but not if the hit put them down.
  if (!isCounter && !target.downed) fireCounter(state, target, attacker);

  return immune ? 0 : damage;
}

/** Whether anyone else on this combatant's side is still up. */
function hasStandingAlly(state: CombatState, combatant: Combatant): boolean {
  return teamMembers(state, combatant.team).some(
    (other) => other.id !== combatant.id && !other.downed
  );
}

/** Hits the attacker back with a basic attack, spending one Counter stack. */
function fireCounter(state: CombatState, defender: Combatant, attacker: Combatant): void {
  if (attacker.downed) return;

  const counter = consumeCounterStack(defender.statuses);
  if (!counter.consumed) return;

  defender.statuses = counter.statuses;
  log(state, `${defender.name} counters!`);

  // `true` marks this as a counter so it cannot provoke another one.
  dealDamage(state, defender, attacker, COUNTER_ATTACK_POWER, true);
}

/**
 * Applies already-computed damage.
 *
 * Split out from `dealDamage` because Poison needs to bypass everything that
 * makes an attack an attack: no attacker, no mitigation, no Bleed consumption,
 * and no stamina drain.
 */
function applyDirectDamage(
  state: CombatState,
  target: Combatant,
  damage: number,
  drainsStamina: boolean,
  ignoreShield = false
): void {
  if (target.downed || damage <= 0) return;

  // The shield sits between the damage and everything else. Whatever it eats
  // never reaches health *or* stamina — a blocked blow does not tire you — and
  // only the overflow gets through.
  let throughput = damage;

  if (!ignoreShield && target.shield > 0) {
    const absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    throughput = damage - absorbed;
  }

  if (throughput <= 0) return;

  target.health = Math.max(0, target.health - throughput);

  if (drainsStamina) {
    applyStaminaCost(
      state,
      target,
      staminaDrainFromDamage(throughput, target.maxHealth, target.maxStamina)
    );
  }

  if (target.health === 0 && !target.downed) {
    target.downed = true;
    target.resting = false;
    target.restingSinceTurnStart = false;
    emit(state, { type: 'downed', targetId: target.id });
    log(state, `${target.name} is down!`);

    payOutUndying(state, target.team === 'player' ? 'enemy' : 'player');
  }
}

/**
 * Feeds anyone holding Undying when an enemy of theirs falls.
 *
 * Heals half their max health, or raises them at half health if they were
 * already down — the same stack covers both, so the card pays out whether or
 * not things have gone badly.
 *
 * Note the one case it cannot cover: if the holder is the last ally standing
 * when they drop, the battle is decided before any enemy can fall, so nothing
 * is ever left to feed on.
 */
function payOutUndying(state: CombatState, benefitingTeam: Team): void {
  for (const combatant of teamMembers(state, benefitingTeam)) {
    const undying = consumeUndyingStack(combatant.statuses);
    if (!undying.consumed) continue;

    combatant.statuses = undying.statuses;

    const restored = Math.max(1, Math.round(combatant.maxHealth * UNDYING_HEAL_FRACTION));
    const wasDowned = combatant.downed;

    combatant.health = Math.min(combatant.maxHealth, combatant.health + restored);
    if (wasDowned) combatant.downed = false;

    emit(state, {
      type: 'heal',
      targetId: combatant.id,
      amount: restored,
      revived: wasDowned,
    });

    log(
      state,
      wasDowned
        ? `${combatant.name} rises, gorged on the kill.`
        : `${combatant.name} drinks deep and recovers ${restored}.`
    );
  }
}

/**
 * Spends stamina, forcing a rest when it bottoms out.
 *
 * Overspending is allowed — a heavy card can be played with only a sliver of
 * stamina left, which zeroes the bar and benches that character for the rest of
 * the turn. That's the interesting decision the resource is there to create.
 */
function applyStaminaCost(state: CombatState, combatant: Combatant, cost: number): number {
  if (cost <= 0 || combatant.downed) return 0;

  // Every stamina loss in the game funnels through here — damage drain, the
  // cost of playing a card, and direct drains — which is why Fatigue is applied
  // at this one point rather than at each call site.
  const amount = Math.round(cost * fatigueMultiplier(combatant.statuses));
  const before = combatant.stamina;
  combatant.stamina = Math.max(0, combatant.stamina - amount);

  if (combatant.stamina === 0 && !combatant.resting) {
    combatant.resting = true;
    log(state, `${combatant.name} is exhausted and must rest.`);
  }

  return before - combatant.stamina;
}

/**
 * Gives stamina back, waking the character if they were resting.
 *
 * Getting stamina back puts an exhausted character straight back into the
 * fight — a deliberate exception to "must rest for a turn", and what makes
 * Reserve and Resupply worth their cost. Returns whether they were woken.
 */
function restoreStamina(combatant: Combatant, amount: number): boolean {
  combatant.stamina = Math.min(combatant.maxStamina, combatant.stamina + amount);

  if (combatant.stamina > 0 && combatant.resting) {
    combatant.resting = false;
    combatant.restingSinceTurnStart = false;
    return true;
  }
  return false;
}

function applyEffects(
  state: CombatState,
  content: CombatContent,
  effects: readonly CardEffect[],
  sourceId: CombatantId | null,
  targetIds: readonly CombatantId[]
): void {
  const source = sourceId ? state.combatants[sourceId] : undefined;

  for (const effect of effects) {
    switch (effect.type) {
      case 'damage': {
        if (!source) {
          // Damage needs an attacker's Attack stat to scale from, so a neutral
          // card cannot deal it. Content-authoring error rather than a runtime
          // state you can reach through play.
          console.warn('[combat] damage effect with no source; skipped');
          break;
        }
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target) continue;

          // Scaling is read per target, so an area attack hits each one for
          // what their own condition warrants.
          const bonus = effect.scaling
            ? missingStaminaBonus(target, effect.scaling.bonusPower, effect.scaling.exponent)
            : 0;

          const dealt = dealDamage(state, source, target, effect.power + bonus);

          if (effect.lifesteal && dealt > 0 && !source.downed) {
            const healed = Math.max(1, Math.round(dealt * effect.lifesteal));
            source.health = Math.min(source.maxHealth, source.health + healed);
            emit(state, { type: 'heal', targetId: source.id, amount: healed, revived: false });
            log(state, `${source.name} drains ${healed} health.`);
          }
        }
        break;
      }

      case 'chainDamage': {
        if (!source) {
          console.warn('[combat] chainDamage with no source; skipped');
          break;
        }

        const first = targetIds[0];
        if (!first) break;

        // Annotated because it is reassigned from inside the loop that also
        // reads it; without this TypeScript cannot infer a non-optional type.
        let current: CombatantId = first;

        for (let hit = 0; hit < effect.maxHits; hit++) {
          const target = state.combatants[current];
          if (!target) break;

          dealDamage(state, source, target, effect.power);

          const roll = nextRandom(state.seed);
          state.seed = roll.seed;
          if (roll.value >= effect.continueChance) break;

          // Where the bolt goes next. It prefers a new enemy — `redirectChance`
          // of the time it takes one — but can double back, and with nobody
          // else standing it stays where it is rather than fizzling. That is
          // what keeps the chain worth casting into a single target: otherwise
          // a lone enemy has nowhere to jump and the card is one hit for its
          // stamina exactly when you are finishing someone off.
          //
          // One weighted draw either way, so the number of rolls a chain spends
          // does not depend on how many enemies are left — two casts from the
          // same seed stay comparable.
          const living = teamMembers(state, target.team).filter((c) => !c.downed);
          const others = living.filter((c) => c.id !== target.id);
          const struckStands = living.length !== others.length;

          const candidates =
            struckStands && others.length > 0
              ? [
                  { id: target.id, weight: 1 - effect.redirectChance },
                  ...others.map((c) => ({
                    id: c.id,
                    weight: effect.redirectChance / others.length,
                  })),
                ]
              : living.map((c) => ({ id: c.id, weight: 1 }));

          if (candidates.length === 0) break;

          const pick = weightedPick(candidates, state.seed);
          state.seed = pick.seed;
          if (!pick.picked) break;

          current = pick.picked.id;
        }
        break;
      }

      case 'shield': {
        if (!source) {
          console.warn('[combat] shield effect with no source; skipped');
          break;
        }

        const living = targetIds.filter((id) => state.combatants[id]?.downed === false);
        if (living.length === 0) break;

        const pool = source.maxHealth * effect.fractionOfSourceMaxHealth;
        const each = Math.max(1, Math.round(effect.split ? pool / living.length : pool));

        for (const id of living) {
          const target = state.combatants[id];
          if (!target) continue;

          // Shields refresh rather than stack: the bigger one wins, so casting
          // over a healthy shield is wasted rather than compounding.
          if (each <= target.shield) continue;

          target.shield = each;
          emit(state, { type: 'shield', targetId: id, amount: each });
          log(state, `${target.name} is shielded for ${each}.`);
        }
        break;
      }

      case 'restoreStamina': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target || target.downed) continue;

          const amount = effect.amount === 'all' ? target.maxStamina : effect.amount;

          if (restoreStamina(target, amount)) {
            log(state, `${target.name} finds a second wind.`);
          } else {
            log(state, `${target.name} recovers ${amount} stamina.`);
          }
        }
        break;
      }

      case 'drainStamina': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target || target.downed) continue;

          const requested = effect.amount === 'all' ? target.stamina : effect.amount;
          const drained = applyStaminaCost(state, target, requested);
          emit(state, {
            type: 'drain',
            targetId: target.id,
            amount: drained,
            emptied: target.stamina === 0,
          });
          log(state, `${target.name} loses ${drained} stamina.`);
        }
        break;
      }

      case 'extendPoison': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target || target.downed) continue;
          if (stacksOf(target.statuses, 'poison') === 0) continue;

          target.statuses = extendPoisonDuration(target.statuses, effect.turns);
          log(state, `${target.name}'s poison lingers ${effect.turns} turn longer.`);
        }
        break;
      }

      case 'focusedStatus': {
        // One target left means the whole card lands on them. Against a group
        // it spreads thin; one-on-one it is a finisher.
        const living = targetIds.filter((id) => state.combatants[id]?.downed === false);
        const stacks = living.length === 1 ? effect.soloStacks : effect.stacks;

        for (const id of living) {
          const target = state.combatants[id];
          if (!target) continue;
          if (effect.kind === 'poison' && target.poisonImmune) {
            log(state, `${target.name} is immune to poison.`);
            continue;
          }

          target.statuses = applyStatus(target.statuses, effect.kind, stacks, effect.duration);
          emit(state, { type: 'status', targetId: id, kind: effect.kind, stacks });
          log(state, `${target.name} gains ${stacks} ${effect.kind}.`);
        }
        break;
      }

      case 'revealAndKeep': {
        // Pull the cards clear of the draw pile and park them in the selection.
        // They belong to no pile until the player chooses, so none can be lost
        // if the battle ends mid-choice.
        let piles = pilesOf(state);
        const revealed: CardInstanceId[] = [];

        for (let i = 0; i < effect.look; i++) {
          if (piles.drawPile.length === 0) {
            if (piles.discardPile.length === 0) break;
            piles = reshuffleDiscardIntoDraw(piles);
          }
          const card = piles.drawPile.shift();
          if (card === undefined) break;
          revealed.push(card);
        }

        withPiles(state, piles);
        if (revealed.length === 0) break;

        state.selection = {
          kind: 'keepOne',
          cards: revealed,
          drawAfter: 0,
          prompt: 'Keep one card',
        };
        state.phase = 'selecting';
        break;
      }

      case 'discardThenDraw': {
        // With nothing to throw away there is no decision, so skip the prompt
        // rather than parking the player in a phase they cannot leave.
        if (state.hand.length === 0) {
          withPiles(state, drawCards(pilesOf(state), effect.draw));
          break;
        }

        state.selection = {
          kind: 'discardOne',
          cards: [...state.hand],
          drawAfter: effect.draw,
          prompt: 'Discard a card',
        };
        state.phase = 'selecting';
        break;
      }

      case 'discardHandAndAttack': {
        if (!source) {
          console.warn('[combat] discardHandAndAttack with no source; skipped');
          break;
        }

        // The card that triggered this has already left the hand, so what
        // remains is exactly what the player is giving up.
        const discarded = [...state.hand];
        let piles = pilesOf(state);
        for (const instanceId of discarded) piles = discardFromHand(piles, instanceId);
        withPiles(state, piles);

        log(state, `${source.name} throws away ${discarded.length} cards.`);

        for (let i = 0; i < discarded.length; i++) {
          const living = teamMembers(state, source.team === 'player' ? 'enemy' : 'player').filter(
            (c) => !c.downed
          );
          if (living.length === 0) break;

          const pick = weightedPick(
            living.map((c) => ({ id: c.id, weight: 1 })),
            state.seed
          );
          state.seed = pick.seed;
          if (!pick.picked) break;

          const target = state.combatants[pick.picked.id];
          if (!target) continue;

          dealDamage(state, source, target, effect.power);
          if (effect.bleedStacks > 0 && !target.downed) {
            target.statuses = applyStatus(target.statuses, 'bleed', effect.bleedStacks, {
              kind: 'permanent',
            });
          }
        }
        break;
      }

      case 'heal':
      case 'healPercent': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target) continue;

          const amount =
            effect.type === 'heal'
              ? effect.amount
              : Math.max(1, Math.round(target.maxHealth * effect.fraction));

          const wasDowned = target.downed;
          target.health = Math.min(target.maxHealth, target.health + amount);

          emit(state, {
            type: 'heal',
            targetId: target.id,
            amount,
            revived: wasDowned && target.health > 0,
          });

          if (wasDowned && target.health > 0) {
            target.downed = false;
            log(state, `${target.name} is back on their feet.`);
          } else {
            log(state, `${target.name} recovers ${amount} health.`);
          }
        }
        break;
      }

      case 'castCopiesFromDrawPile': {
        const cast = content.cardDefs[effect.cardId];
        if (!cast) {
          console.warn(`[combat] castCopiesFromDrawPile names unknown card ${effect.cardId}; skipped`);
          break;
        }

        // Pulled out of the draw pile before anything is cast, so the count is
        // fixed up front and a cast that draws cannot change it.
        const copies = state.drawPile.filter(
          (id) => state.cards[id]?.definitionId === effect.cardId
        );
        const pulled = new Set(copies);
        state.drawPile = state.drawPile.filter((id) => !pulled.has(id));
        state.discardPile = [...state.discardPile, ...copies];

        const casts = copies.length + effect.extra;
        log(state, `${cast.name} is cast ${casts} time${casts === 1 ? '' : 's'}.`);

        // A cast never casts again, whatever the card it names says.
        const castEffects = cast.effects.filter((e) => e.type !== 'castCopiesFromDrawPile');

        for (let i = 0; i < casts; i++) {
          // Retargeted every cast, so a fireball that kills someone does not
          // leave the next one aimed at a body.
          const targets = needsTargetChoice(cast.target)
            ? targetIds.filter((id) => state.combatants[id]?.downed === false)
            : resolveTargets(state, cast, null);
          if (targets.length === 0 && cast.target !== 'none') break;

          applyEffects(state, content, castEffects, sourceId ?? cast.ownerId, targets);
        }
        break;
      }

      case 'summon': {
        // Targets nothing — a summoner calls to its own side, so the source is
        // the only input this needs.
        if (!source) break;
        summon(state, content, source, effect.archetype, effect.count, effect.max);
        break;
      }

      case 'status': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target || target.downed) continue;

          if (effect.chance !== undefined && effect.chance < 1) {
            const roll = nextRandom(state.seed);
            state.seed = roll.seed;
            if (roll.value >= effect.chance) continue;
          }

          // After the roll, so an immune target consumes the same randomness a
          // vulnerable one would and replays stay in step.
          if (effect.kind === 'poison' && target.poisonImmune) {
            log(state, `${target.name} is immune to poison.`);
            continue;
          }

          target.statuses = applyStatus(
            target.statuses,
            effect.kind,
            effect.stacks,
            effect.duration
          );
          emit(state, {
            type: 'status',
            targetId: target.id,
            kind: effect.kind,
            stacks: effect.stacks,
          });
          log(state, `${target.name} gains ${effect.stacks} ${effect.kind}.`);
        }
        break;
      }

      case 'draw': {
        withPiles(state, drawCards(pilesOf(state), effect.count));
        log(state, `Drew ${effect.count}.`);
        break;
      }
    }
  }
}

// ── Battle end ──────────────────────────────────────────────────────────────

/**
 * Calls combatants onto the summoner's side, up to its cap.
 *
 * Counts only what this summoner currently has standing, so a brood refills as
 * it is cleared rather than being a one-off. Ids come off the state's own
 * counter, which is what keeps two plays of one seed identical.
 *
 * Summons deliberately do *not* join `enemyQueue`: it is built once at the top
 * of the enemy turn, so anything arriving mid-turn misses it and acts next turn
 * instead. That gives the player one turn to answer, for free, out of how the
 * queue already worked.
 */
function summon(
  state: CombatState,
  content: CombatContent,
  source: Combatant,
  archetype: string,
  count: number,
  max: number
): void {
  const template = content.summonable?.[archetype];
  if (!template) return;

  const standing = teamMembers(state, source.team).filter(
    (c) => !c.downed && c.summonedBy === source.id && c.archetype === archetype
  ).length;

  const room = Math.max(0, max - standing);
  const spawning = Math.min(count, room);
  if (spawning === 0) {
    log(state, `${source.name} calls, but nothing more answers.`);
    return;
  }

  const order = source.team === 'player' ? state.playerOrder : state.enemyOrder;

  for (let i = 0; i < spawning; i += 1) {
    const ordinal = state.nextSummon;
    state.nextSummon += 1;

    const id = `${archetype}-s${ordinal}`;
    const spawned: Combatant = {
      ...cloneCombatant(template),
      id,
      name: `${template.name} ${ordinal}`,
      team: source.team,
      summonedBy: source.id,
    };

    state.combatants[id] = spawned;
    order.push(id);
    log(state, `${source.name} calls in ${spawned.name}.`);
  }
}

/**
 * Clears summoned combatants off the board once they have no business on it.
 *
 * Two rules: a summon that falls is struck from the field rather than left as a
 * corpse, and a summon outlives nothing — when its summoner falls, so does it.
 *
 * The second is what keeps a summoner the win condition. Without it, killing
 * the Broodmother leaves her brood standing and the fight drags into a mop-up
 * of whatever happened to be on the board when she died.
 *
 * Called from `checkBattleEnd` before it decides anything, because the decision
 * depends on this having already happened: with the mother down and three of
 * her brood still listed, "are there enemies left" answers yes and the victory
 * never fires.
 */
function sweepSummons(state: CombatState): void {
  const leaving = new Set<CombatantId>();

  for (const id of [...state.playerOrder, ...state.enemyOrder]) {
    const combatant = state.combatants[id];
    if (!combatant?.summonedBy) continue;

    const summoner = state.combatants[combatant.summonedBy];
    if (!combatant.downed && summoner && !summoner.downed) continue;

    leaving.add(id);
    log(
      state,
      combatant.downed
        ? `${combatant.name} is gone.`
        : `${combatant.name} collapses without its summoner.`
    );
  }

  if (leaving.size === 0) return;

  for (const id of leaving) delete state.combatants[id];

  state.playerOrder = state.playerOrder.filter((id) => !leaving.has(id));
  state.enemyOrder = state.enemyOrder.filter((id) => !leaving.has(id));
  state.enemyQueue = state.enemyQueue.filter((id) => !leaving.has(id));
}

function checkBattleEnd(state: CombatState): void {
  if (state.phase === 'victory' || state.phase === 'defeat') return;

  sweepSummons(state);

  const enemiesLeft = teamMembers(state, 'enemy').some((c) => !c.downed);
  if (!enemiesLeft) {
    state.phase = 'victory';
    log(state, 'Victory!');
    return;
  }

  const alliesLeft = teamMembers(state, 'player').some((c) => !c.downed);
  if (!alliesLeft) {
    state.phase = 'defeat';
    log(state, 'Your team has fallen.');
  }
}

// ── Player actions ──────────────────────────────────────────────────────────

/**
 * Chooses a card. Cards needing a specific target park in `selectTarget`;
 * everything else resolves immediately.
 */
export function selectCard(
  state: CombatState,
  content: CombatContent,
  instanceId: CardInstanceId
): CombatState {
  if (!canPlayCard(state, content, instanceId).ok) return state;

  const def = cardDefOf(state, content, instanceId);
  if (!def) return state;

  if (needsTargetChoice(def.target)) {
    const next = cloneState(state);
    next.phase = 'selectTarget';
    next.pendingCard = instanceId;
    return next;
  }

  return resolveCard(state, content, instanceId, null);
}

/** Backs out of targeting without spending anything. */
export function cancelCardSelection(state: CombatState): CombatState {
  if (state.phase !== 'selectTarget') return state;

  const next = cloneState(state);
  next.phase = 'selectCard';
  next.pendingCard = null;
  return next;
}

/** Commits the pending card against a chosen target. */
export function chooseTarget(
  state: CombatState,
  content: CombatContent,
  targetId: CombatantId
): CombatState {
  if (state.phase !== 'selectTarget' || !state.pendingCard) return state;
  if (!legalTargets(state, content, state.pendingCard).includes(targetId)) return state;

  return resolveCard(state, content, state.pendingCard, targetId);
}

/** Pays the costs and applies the effects. */
export function resolveCard(
  state: CombatState,
  content: CombatContent,
  instanceId: CardInstanceId,
  targetId: CombatantId | null
): CombatState {
  const check = canPlayCard(state, content, instanceId);
  if (!check.ok) return state;

  const def = cardDefOf(state, content, instanceId);
  if (!def) return state;

  const next = cloneState(state);
  let staminaPaid = 0;

  if (def.ownerId) {
    const owner = next.combatants[def.ownerId];
    if (owner) {
      log(next, `${owner.name} plays ${def.name}.`);
      staminaPaid = applyStaminaCost(next, owner, def.staminaCost);

      // A cost, not damage: no stamina drain, no Bleed spent, no counter, and
      // never lethal — paying always leaves at least a sliver.
      if (def.healthCostFraction) {
        const paid = Math.max(1, Math.round(owner.maxHealth * def.healthCostFraction));
        owner.health = Math.max(1, owner.health - paid);
        log(next, `${owner.name} pays ${paid} health.`);
      }
    }
  } else {
    log(next, `Team plays ${def.name}.`);
  }

  // The card leaves the hand before its effects run, so a draw effect can't
  // pull the card that is currently resolving back into hand — and Saber's
  // discard-everything effect sees exactly the cards being given up.
  //
  // A neutral card costs no stamina, so nothing would stop it being played
  // every time it came round. Instead it is used up: it goes to the exhaust
  // pile and stays there for the rest of the battle.
  if (def.ownerId === null) {
    next.hand = next.hand.filter((id) => id !== instanceId);
    next.exhaustPile.push(instanceId);
  } else {
    withPiles(next, discardFromHand(pilesOf(next), instanceId));
  }

  const affected = resolveTargets(next, def, targetId);
  const staminaBefore = new Map(affected.map((id) => [id, next.combatants[id]?.stamina ?? 0]));

  applyEffects(next, content, def.effects, def.ownerId, affected);

  // Overdraw's refund: gives the owner back stamina if the card left anyone
  // empty. Checked against the before-state so a target who was already at
  // zero doesn't make the card free every turn, and capped at what was paid so
  // an overspend on a sliver cannot come back as a profit.
  const refund = Math.min(def.staminaRefundOnEmpty ?? 0, staminaPaid);
  const owner = def.ownerId ? next.combatants[def.ownerId] : undefined;
  if (refund > 0 && owner && !owner.downed) {
    const emptied = affected.some((id) => {
      const before = staminaBefore.get(id) ?? 0;
      return before > 0 && next.combatants[id]?.stamina === 0;
    });
    if (emptied) {
      restoreStamina(owner, refund);
      log(next, `${def.name} refunds ${refund} stamina.`);
    }
  }

  next.pendingCard = null;
  // A card that opened a selection stays in that phase until the player picks.
  if (next.phase !== 'selecting') next.phase = 'selectCard';
  checkBattleEnd(next);

  return next;
}

/**
 * Finishes a card that was waiting on the player to pick a card.
 *
 * `keepOne` puts the chosen card in hand and bins the rest; `discardOne` bins
 * the chosen card and then draws. Either way the selection closes and the turn
 * continues.
 */
export function resolveSelection(
  state: CombatState,
  chosen: CardInstanceId
): CombatState {
  if (state.phase !== 'selecting' || !state.selection) return state;
  if (!state.selection.cards.includes(chosen)) return state;

  const next = cloneState(state);
  const selection: PendingSelection = next.selection ?? {
    kind: 'keepOne',
    cards: [],
    drawAfter: 0,
    prompt: '',
  };

  if (selection.kind === 'keepOne') {
    next.hand.push(chosen);
    for (const card of selection.cards) {
      if (card !== chosen) next.discardPile.push(card);
    }
    log(next, 'Kept a card.');
  } else {
    withPiles(next, discardFromHand(pilesOf(next), chosen));
    withPiles(next, drawCards(pilesOf(next), selection.drawAfter));
    log(next, `Discarded a card and drew ${selection.drawAfter}.`);
  }

  next.selection = null;
  next.phase = 'selectCard';
  return next;
}

// ── Turn transitions ────────────────────────────────────────────────────────

/**
 * Start-of-turn upkeep: clears statuses that last until this team acts again,
 * and hands this team its stamina for the turn.
 *
 * Immunity is applied on your own turn, so it has to survive your end-of-turn
 * tick to cover the enemy turn. Expiring it here — as your next turn opens —
 * gives exactly one enemy turn of protection.
 *
 * Regeneration skips anyone resting: they are refilled in full when they wake,
 * so topping them up here would change nothing but when the bar moves. Both
 * sides regenerate the same way, each as its own turn opens.
 */
function runTurnStart(state: CombatState, team: Team): void {
  for (const combatant of teamMembers(state, team)) {
    combatant.statuses = consumeOnTurnStart(combatant.statuses);

    if (!combatant.downed && !combatant.resting) {
      restoreStamina(combatant, Math.round(combatant.maxStamina * STAMINA_REGEN_FRACTION));
    }
  }

  markRestsForTurn(state);
}

/**
 * Marks everyone already asleep as benched for the turn now opening.
 *
 * Both sides are marked whichever team is about to act, because a rest is
 * measured in turns rather than in whose turn it is: whoever is asleep when a
 * turn starts sleeps through all of it and wakes at its end. Exhausting
 * yourself on your own turn therefore costs you the enemy's turn — you are
 * marked as that turn opens, not as this one did — while a drain landing
 * mid-turn still costs its victim the turn after, as it always did.
 */
function markRestsForTurn(state: CombatState): void {
  for (const combatant of allCombatants(state)) {
    combatant.restingSinceTurnStart = combatant.resting;
  }
}

/**
 * Wakes anyone who has now slept through a whole turn. Runs at the end of every
 * turn, either side's.
 *
 * Stamina refills completely rather than partially, which is what makes a
 * forced rest cost exactly the turn it covers and nothing more.
 */
function runRecovery(state: CombatState): void {
  for (const combatant of allCombatants(state)) {
    if (combatant.downed || !combatant.resting || !combatant.restingSinceTurnStart) continue;

    combatant.resting = false;
    combatant.restingSinceTurnStart = false;
    combatant.stamina = combatant.maxStamina;
    // Resting is the only thing that clears Fatigue, so being ground down to
    // nothing is also how you shake it off.
    combatant.statuses = consumeOnRest(combatant.statuses);
    log(state, `${combatant.name} has recovered.`);
  }
}

/**
 * End-of-round upkeep: poison bites, then every timer ticks.
 *
 * Both teams tick here, at the close of the enemy turn, rather than each at the
 * end of its own. A one-turn buff is only worth playing if it survives the
 * enemy turn — Hollis's Goad taunts nobody if it expires before the enemies
 * pick their targets — and a one-turn debuff hung on an enemy has to last long
 * enough for them to act under it. Ticking both sides at the same moment gives
 * each exactly one full round, however early in the round it was applied.
 */
function runStatusUpkeep(state: CombatState): void {
  for (const combatant of allCombatants(state)) {
    // Poison resolves before the timers tick, so a 2-turn stack deals damage on
    // both of the turns it is alive rather than being cut short on the second.
    // Immunity blocks poison too — it is damage, and without this Ivy would
    // walk straight through the strongest defensive card in the game.
    if (!combatant.downed && !combatant.poisonImmune && !isImmune(combatant.statuses)) {
      const stacks = stacksOf(combatant.statuses, 'poison');
      if (stacks > 0) {
        const damage = poisonTickDamage(stacks, combatant.maxHealth);
        emit(state, { type: 'poison', targetId: combatant.id, damage });
        // `true` skips the shield: poison is the counter to shielding, so it
        // eats health directly however much protection is stacked up.
        applyDirectDamage(state, combatant, damage, false, true);
        log(state, `${combatant.name} takes ${damage} from poison.`);
      }
    }

    combatant.statuses = tickStatuses(combatant.statuses);
  }
}

/**
 * Ends the player turn.
 *
 * The hand is brought to the limit: short hands draw up, over-full hands park
 * in `discarding` until the player chooses what to lose. Only once the hand is
 * legal is the enemy queued.
 *
 * `_content` is unused since the enemy turn became stepped, but is kept so every
 * public transition shares one signature — callers shouldn't have to remember
 * which of them happen to need content this week.
 */
export function endPlayerTurn(state: CombatState, _content: CombatContent): CombatState {
  if (state.phase !== 'selectCard' && state.phase !== 'selectTarget') return state;

  const next = cloneState(state);
  next.pendingCard = null;

  if (next.hand.length > next.handLimit) {
    next.phase = 'discarding';
    log(next, `Discard down to ${next.handLimit}.`);
    return next;
  }

  withPiles(next, refillHandTo(pilesOf(next), next.handLimit));
  return beginEnemyTurn(next);
}

/** Applies the player's chosen discards, then hands over to the enemy. */
export function confirmDiscard(
  state: CombatState,
  _content: CombatContent,
  instanceIds: readonly CardInstanceId[]
): CombatState {
  if (state.phase !== 'discarding') return state;

  const next = cloneState(state);

  let piles = pilesOf(next);
  for (const instanceId of instanceIds) {
    piles = discardFromHand(piles, instanceId);
  }
  withPiles(next, piles);

  if (next.hand.length > next.handLimit) {
    // Not enough discarded yet — stay in the phase.
    return next;
  }

  return beginEnemyTurn(next);
}

/**
 * Hands over to the enemy, queueing them rather than resolving them.
 *
 * Nothing is applied here. The caller drives `stepEnemyTurn` one enemy at a
 * time so each attack can be animated; resolving the whole turn atomically
 * would give the UI a single jump from "before" to "after" with nothing to show
 * in between.
 */
function beginEnemyTurn(state: CombatState): CombatState {
  // The player turn is over: anyone who slept through it is back on their feet.
  runRecovery(state);

  checkBattleEnd(state);
  if (state.phase === 'victory' || state.phase === 'defeat') return state;

  state.activeTeam = 'enemy';
  state.phase = 'enemyTurn';
  runTurnStart(state, 'enemy');
  state.enemyQueue = teamMembers(state, 'enemy')
    .filter((enemy) => !enemy.downed)
    .map((enemy) => enemy.id);

  return state;
}

/**
 * Resolves exactly one enemy's action and returns.
 *
 * Enemies have no deck — each picks one action from a weighted
 * list. Intents are deliberately not telegraphed, so nothing is published for
 * the UI to read ahead of time. They do have stamina and can be staggered by
 * heavy hits exactly as the player's characters can.
 *
 * When the queue empties this runs the enemy's end-of-turn upkeep and hands the
 * turn back. Callers loop until `phase` is no longer `enemyTurn`.
 */
export function stepEnemyTurn(state: CombatState, content: CombatContent): CombatState {
  if (state.phase !== 'enemyTurn') return state;

  const next = cloneState(state);
  const enemyId = next.enemyQueue.shift();

  if (enemyId === undefined) return finishEnemyTurn(next);

  const enemy = next.combatants[enemyId];
  if (!enemy || !canAct(enemy)) {
    // Downed or exhausted since the queue was built. Skip without consuming a
    // random roll, so replays stay deterministic.
    return next.enemyQueue.length === 0 ? finishEnemyTurn(next) : next;
  }

  const actions = content.enemyActions[enemy.archetype ?? enemyId] ?? [];
  const available = actions.filter((action) => hasTargets(next, action, enemyId));

  if (available.length > 0) {
    const pick = weightedPick(available, next.seed);
    next.seed = pick.seed;

    if (pick.picked) {
      const action = pick.picked;
      log(next, `${enemy.name} uses ${action.name}.`);

      applyStaminaCost(next, enemy, enemyStaminaCost(action));
      applyEffects(
        next,
        content,
        action.effects,
        enemyId,
        enemyTargets(next, content, action, enemyId)
      );
    }
  }

  checkBattleEnd(next);
  if (next.phase === 'victory' || next.phase === 'defeat') return next;

  return next.enemyQueue.length === 0 ? finishEnemyTurn(next) : next;
}

/** Enemy upkeep, then the turn passes back to the player. */
function finishEnemyTurn(state: CombatState): CombatState {
  // The round closes here, so this is where both sides' statuses tick and where
  // anyone exhausted on the player's turn finally wakes.
  runStatusUpkeep(state);
  runRecovery(state);
  checkBattleEnd(state);

  if (state.phase === 'victory' || state.phase === 'defeat') return state;

  state.round += 1;
  state.activeTeam = 'player';
  state.phase = 'selectCard';
  state.enemyQueue = [];
  runTurnStart(state, 'player');

  return state;
}

/**
 * Runs the enemy turn to completion in one call.
 *
 * For tests and the balance probe, which have no interest in pacing. The UI
 * uses `stepEnemyTurn` so it can animate between actions.
 */
export function resolveEnemyTurn(state: CombatState, content: CombatContent): CombatState {
  let current = state;
  let guard = 0;

  while (current.phase === 'enemyTurn' && guard++ < 100) {
    current = stepEnemyTurn(current, content);
  }

  return current;
}

/**
 * Enemy actions cost a flat share of stamina, so heavy hitters also tire.
 *
 * Exported because the move sheet prints it: an Ogre that has to rest after two
 * Smashes is telling the player something, and the number on screen has to be
 * the one the turn actually spends rather than the UI's guess at it.
 */
export function enemyStaminaCost(action: EnemyAction): number {
  let power = 0;

  for (const effect of action.effects) {
    switch (effect.type) {
      case 'damage':
        power += effect.power;
        break;

      // A chain is priced off one hit: how many it actually makes is a roll,
      // and a cost that depended on it would be unknowable before the fact —
      // including to the move sheet, which prints this number.
      case 'chainDamage':
        power += effect.power;
        break;

      // Everything else is support: shields, buffs, curses, drains, summons.
      // Pricing these at zero is what let a support enemy act forever without
      // tiring, which quietly made it immune to the entire stamina axis — the
      // one thing Cask and Lyra are built to do.
      default:
        power += SUPPORT_EFFECT_POWER;
        break;
    }
  }

  return Math.round(power / ENEMY_POWER_PER_STAMINA);
}

/**
 * Everyone an enemy action could legally hit, without choosing between them.
 *
 * Targeting is from the enemy's point of view: their "allies" are the enemy
 * team and their "enemies" are the player's characters.
 *
 * Kept free of randomness on purpose — `hasTargets` calls this to filter the
 * action list, and a check that quietly advanced the seed would make the
 * enemy's eventual choice depend on how many actions were rejected, breaking
 * replay determinism.
 */
function enemyTargetPool(
  state: CombatState,
  action: EnemyAction,
  enemyId: CombatantId
): CombatantId[] {
  switch (action.target) {
    case 'oneEnemy':
    case 'allEnemies':
      return teamMembers(state, 'player')
        .filter((c) => !c.downed)
        .map((c) => c.id);
    case 'oneAlly':
    case 'allAllies':
      return teamMembers(state, 'enemy')
        .filter((c) => !c.downed)
        .map((c) => c.id);
    // The acting enemy, mirroring how a card resolves `self` to its owner. An
    // empty pool here would make every enemy self-buff a silent dead turn: the
    // action still rolls, still logs, still pays stamina, and then lands on
    // nobody.
    case 'self':
      return [enemyId];
    case 'none':
      return [];
  }
}

/**
 * Each target's share of a single-target enemy move, in order, summing to 1.
 *
 * Three things raise a share: looking sturdy (max health over mitigation,
 * against the group's average, clamped), resting, and being badly hurt. The
 * first means the tank really does draw fire without a Taunt; the other two mean
 * a bad spot gets worse. `focus` scales the whole lean, from 0 (an even roll) to
 * 1, which is what lets a Ratkin hunt while an Ogre swings at whoever is there.
 *
 * Capped at `TARGET_SHARE_CAP` times an even share, so however bad a spot is it
 * is never a certainty. Pure, and rolls nothing: the caller still makes exactly
 * one roll per pick, so replays match however the weights come out.
 */
export function targetWeights(targets: readonly Combatant[], focus: number): number[] {
  if (targets.length === 0) return [];

  const lean = Math.min(1, Math.max(0, focus));
  const sturdiness = targets.map((c) => c.maxHealth / mitigation(effectiveDefense(c)));
  const mean = sturdiness.reduce((sum, value) => sum + value, 0) / targets.length;

  const weights = targets.map((target, index) => {
    const relative = mean > 0 ? (sturdiness[index] ?? mean) / mean : 1;
    let weight = Math.min(TARGET_STURDINESS_MAX, Math.max(TARGET_STURDINESS_MIN, relative));
    if (target.resting) weight *= RESTING_TARGET_WEIGHT;
    if (target.health < target.maxHealth * WOUNDED_TARGET_THRESHOLD) {
      weight *= WOUNDED_TARGET_WEIGHT;
    }
    return 1 + (weight - 1) * lean;
  });

  return capShares(weights, Math.min(1, TARGET_SHARE_CAP / targets.length));
}

/**
 * Normalises weights to shares, then pins any share above `cap` and hands the
 * excess to the rest in proportion. That can lift someone else over, so it
 * repeats — at most once per entry, since each pass pins at least one.
 */
function capShares(weights: readonly number[], cap: number): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return weights.map(() => 1 / weights.length);

  const shares = weights.map((weight) => weight / total);
  const pinned = shares.map(() => false);

  for (let pass = 0; pass < shares.length; pass++) {
    let excess = 0;
    shares.forEach((share, index) => {
      if (!pinned[index] && share > cap + 1e-12) {
        excess += share - cap;
        shares[index] = cap;
        pinned[index] = true;
      }
    });
    if (excess <= 0) break;

    const free = shares.reduce((sum, share, index) => (pinned[index] ? sum : sum + share), 0);
    if (free <= 0) break;

    shares.forEach((share, index) => {
      if (!pinned[index]) shares[index] = share + excess * (share / free);
    });
  }

  return shares;
}

/** How hard this enemy leans, by archetype, falling back to the default. */
function targetingFocus(state: CombatState, content: CombatContent, enemyId: CombatantId): number {
  const key = state.combatants[enemyId]?.archetype ?? enemyId;
  return content.enemyTargeting?.[key]?.focus ?? DEFAULT_TARGET_FOCUS;
}

/** Resolves the pool down to actual targets, rolling only for single-target. */
function enemyTargets(
  state: CombatState,
  content: CombatContent,
  action: EnemyAction,
  enemyId: CombatantId
): CombatantId[] {
  const pool = enemyTargetPool(state, action, enemyId);

  if (action.target === 'allEnemies' && effectsAttack(action.effects)) {
    return redirectAreaForTaunt(state, 'player', pool);
  }

  if (action.target !== 'oneEnemy' && action.target !== 'oneAlly') return pool;

  const targets = pool
    .map((id) => state.combatants[id])
    .filter((c): c is Combatant => c !== undefined);
  if (targets.length === 0) return [];

  // Aimed at the party, the roll leans toward whoever looks worth hitting.
  // Aimed at its own side it stays even: support has nobody to read.
  const weights =
    action.target === 'oneEnemy'
      ? targetWeights(targets, targetingFocus(state, content, enemyId))
      : targets.map(() => 1);

  const pick = weightedPick(
    targets.map((target, index) => ({ id: target.id, weight: weights[index] ?? 0 })),
    state.seed
  );
  state.seed = pick.seed;
  if (!pick.picked) return [];

  // Roll first, then redirect: the roll must be consumed either way, or a
  // taunting defender would silently change the RNG stream and break replays.
  if (action.target === 'oneEnemy' && effectsAttack(action.effects)) {
    return [redirectForTaunt(state, 'player', pick.picked.id)];
  }

  return [pick.picked.id];
}

function hasTargets(state: CombatState, action: EnemyAction, enemyId: CombatantId): boolean {
  if (action.target === 'none' || action.target === 'self') return true;
  return enemyTargetPool(state, action, enemyId).length > 0;
}
