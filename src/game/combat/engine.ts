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

import { drawCards, discardFromHand, refillHandTo, type Piles } from './deck';
import { shuffle, weightedPick } from './rng';
import {
  applyStatus,
  consumeBleedStack,
  consumeOnAttacked,
  extendPoisonDuration,
  stacksOf,
  tickStatuses,
} from './status';
import {
  BLEED_MULTIPLIER,
  computeDamage,
  decideFirstTeam,
  missingStaminaBonus,
  poisonTickDamage,
  staminaDrainFromDamage,
} from './stats';
import type {
  CardDefinition,
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

export const DEFAULT_MAX_ENERGY = 5;
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
    cards: { ...state.cards },
    enemyQueue: [...state.enemyQueue],
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

function teamMembers(state: CombatState, team: Team): Combatant[] {
  const order = team === 'player' ? state.playerOrder : state.enemyOrder;
  return order.map((id) => state.combatants[id]).filter((c): c is Combatant => c !== undefined);
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
  maxEnergy?: number;
  handLimit?: number;
}

export function createCombat(options: CreateCombatOptions): CombatState {
  const { combatants, deck, seed = 1, maxEnergy = DEFAULT_MAX_ENERGY } = options;
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
    energy: maxEnergy,
    maxEnergy,
    cards,
    drawPile,
    hand: [],
    discardPile: [],
    handLimit,
    phase: first === 'player' ? 'selectCard' : 'enemyTurn',
    pendingCard: null,
    seed,
    enemyQueue: [],
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

  return state;
}

// ── Targeting ───────────────────────────────────────────────────────────────

function effectsHeal(effects: readonly CardEffect[]): boolean {
  return effects.some((effect) => effect.type === 'heal');
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
  if (state.phase !== 'selectCard' && state.phase !== 'selectTarget') {
    return { ok: false, reason: 'Not your turn' };
  }

  const def = cardDefOf(state, content, instanceId);
  if (!def) return { ok: false, reason: 'Unknown card' };
  if (!state.hand.includes(instanceId)) return { ok: false, reason: 'Card is not in hand' };
  if (state.energy < def.energyCost) return { ok: false, reason: 'Not enough energy' };

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
    case 'oneEnemy':
      return chosen ? [chosen] : [];
    case 'allAllies':
      return teamMembers(state, 'player')
        .filter((c) => !c.downed || effectsHeal(def.effects))
        .map((c) => c.id);
    case 'allEnemies':
      return teamMembers(state, 'enemy')
        .filter((c) => !c.downed)
        .map((c) => c.id);
    case 'none':
      return [];
  }
}

/** Applies one hit: bleed, damage, stamina drain, on-hit status expiry, downing. */
function dealDamage(
  state: CombatState,
  attacker: Combatant,
  target: Combatant,
  power: number
): void {
  if (target.downed) return;

  let damage = computeDamage(attacker, target, power);

  // Bleed is consumed a stack at a time and doubles the *final* damage, after
  // Attack and Defense have both been applied. An area attack therefore eats
  // one stack from each bleeding target it hits, not one stack in total.
  const bleed = consumeBleedStack(target.statuses);
  if (bleed.consumed) {
    target.statuses = bleed.statuses;
    damage *= BLEED_MULTIPLIER;
  }

  emit(state, {
    type: 'attack',
    sourceId: attacker.id,
    targetId: target.id,
    damage,
    bleed: bleed.consumed,
  });

  applyDirectDamage(state, target, damage, true);
  target.statuses = consumeOnAttacked(target.statuses);

  log(state, `${attacker.name} hits ${target.name} for ${damage}${bleed.consumed ? ' (bleed)' : ''}.`);
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
  drainsStamina: boolean
): void {
  if (target.downed || damage <= 0) return;

  target.health = Math.max(0, target.health - damage);

  if (drainsStamina) {
    applyStaminaCost(state, target, staminaDrainFromDamage(damage, target.maxHealth, target.maxStamina));
  }

  if (target.health === 0 && !target.downed) {
    target.downed = true;
    target.resting = false;
    emit(state, { type: 'downed', targetId: target.id });
    log(state, `${target.name} is down!`);
  }
}

/**
 * Spends stamina, forcing a rest when it bottoms out.
 *
 * Overspending is allowed — a heavy card can be played with only a sliver of
 * stamina left, which zeroes the bar and benches that character for the rest of
 * the turn. That's the interesting decision the resource is there to create.
 */
function applyStaminaCost(state: CombatState, combatant: Combatant, cost: number): void {
  if (cost <= 0 || combatant.downed) return;

  combatant.stamina = Math.max(0, combatant.stamina - cost);

  if (combatant.stamina === 0 && !combatant.resting) {
    combatant.resting = true;
    log(state, `${combatant.name} is exhausted and must rest.`);
  }
}

function applyEffects(
  state: CombatState,
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

          dealDamage(state, source, target, effect.power + bonus);
        }
        break;
      }

      case 'drainStamina': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target || target.downed) continue;

          const amount = effect.amount === 'all' ? target.stamina : effect.amount;
          applyStaminaCost(state, target, amount);
          emit(state, {
            type: 'drain',
            targetId: target.id,
            amount: Math.round(amount),
            emptied: target.stamina === 0,
          });
          log(state, `${target.name} loses ${Math.round(amount)} stamina.`);
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

      case 'heal': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target) continue;

          const wasDowned = target.downed;
          target.health = Math.min(target.maxHealth, target.health + effect.amount);

          emit(state, {
            type: 'heal',
            targetId: target.id,
            amount: effect.amount,
            revived: wasDowned && target.health > 0,
          });

          if (wasDowned && target.health > 0) {
            target.downed = false;
            log(state, `${target.name} is back on their feet.`);
          } else {
            log(state, `${target.name} recovers ${effect.amount} health.`);
          }
        }
        break;
      }

      case 'status': {
        for (const id of targetIds) {
          const target = state.combatants[id];
          if (!target || target.downed) continue;

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

function checkBattleEnd(state: CombatState): void {
  if (state.phase === 'victory' || state.phase === 'defeat') return;

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
  next.energy -= def.energyCost;

  if (def.ownerId) {
    const owner = next.combatants[def.ownerId];
    if (owner) {
      log(next, `${owner.name} plays ${def.name}.`);
      applyStaminaCost(next, owner, def.staminaCost);
    }
  } else {
    log(next, `Team plays ${def.name}.`);
  }

  // The card leaves the hand before its effects run, so a draw effect can't
  // pull the card that is currently resolving back into hand — and Saber's
  // discard-everything effect sees exactly the cards being given up.
  withPiles(next, discardFromHand(pilesOf(next), instanceId));

  const affected = resolveTargets(next, def, targetId);
  const staminaBefore = new Map(affected.map((id) => [id, next.combatants[id]?.stamina ?? 0]));

  applyEffects(next, def.effects, def.ownerId, affected);

  // Overdraw's refund: pays back energy if the card left anyone empty. Checked
  // against the before-state so a target who was already at zero doesn't
  // hand out free energy every turn.
  const refund = def.energyOnStaminaEmpty ?? 0;
  if (refund > 0) {
    const emptied = affected.some((id) => {
      const before = staminaBefore.get(id) ?? 0;
      return before > 0 && next.combatants[id]?.stamina === 0;
    });
    if (emptied) {
      next.energy += refund;
      log(next, `${def.name} refunds ${refund} energy.`);
    }
  }

  next.pendingCard = null;
  next.phase = 'selectCard';
  checkBattleEnd(next);

  return next;
}

// ── Turn transitions ────────────────────────────────────────────────────────

/**
 * End-of-turn upkeep for one team: statuses tick, exhausted characters recover.
 *
 * Stamina refills completely rather than partially, which is what makes a
 * forced rest cost exactly one turn of actions and nothing more.
 */
function runUpkeep(state: CombatState, team: Team): void {
  for (const combatant of teamMembers(state, team)) {
    // Poison resolves before the timers tick, so a 2-turn stack deals damage on
    // both of the turns it is alive rather than being cut short on the second.
    if (!combatant.downed) {
      const stacks = stacksOf(combatant.statuses, 'poison');
      if (stacks > 0) {
        const damage = poisonTickDamage(stacks, combatant.maxHealth);
        emit(state, { type: 'poison', targetId: combatant.id, damage });
        applyDirectDamage(state, combatant, damage, false);
        log(state, `${combatant.name} takes ${damage} from poison.`);
      }
    }

    combatant.statuses = tickStatuses(combatant.statuses);

    if (combatant.downed) continue;

    if (combatant.resting) {
      combatant.resting = false;
      combatant.stamina = combatant.maxStamina;
      log(state, `${combatant.name} has recovered.`);
    }
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

  runUpkeep(next, 'player');

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
  checkBattleEnd(state);
  if (state.phase === 'victory' || state.phase === 'defeat') return state;

  state.activeTeam = 'enemy';
  state.phase = 'enemyTurn';
  state.enemyQueue = teamMembers(state, 'enemy')
    .filter((enemy) => !enemy.downed)
    .map((enemy) => enemy.id);

  return state;
}

/**
 * Resolves exactly one enemy's action and returns.
 *
 * Enemies have no deck and no energy — each picks one action from a weighted
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

  const actions = content.enemyActions[enemyId] ?? [];
  const available = actions.filter((action) => hasTargets(next, action));

  if (available.length > 0) {
    const pick = weightedPick(available, next.seed);
    next.seed = pick.seed;

    if (pick.picked) {
      const action = pick.picked;
      log(next, `${enemy.name} uses ${action.name}.`);

      applyStaminaCost(next, enemy, enemyStaminaCost(action));
      applyEffects(next, action.effects, enemyId, enemyTargets(next, action));
    }
  }

  checkBattleEnd(next);
  if (next.phase === 'victory' || next.phase === 'defeat') return next;

  return next.enemyQueue.length === 0 ? finishEnemyTurn(next) : next;
}

/** Enemy upkeep, then the turn passes back to the player. */
function finishEnemyTurn(state: CombatState): CombatState {
  runUpkeep(state, 'enemy');
  checkBattleEnd(state);

  if (state.phase === 'victory' || state.phase === 'defeat') return state;

  state.round += 1;
  state.activeTeam = 'player';
  state.phase = 'selectCard';
  state.energy = state.maxEnergy;
  state.enemyQueue = [];

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

/** Enemy actions cost a flat share of stamina, so heavy hitters also tire. */
function enemyStaminaCost(action: EnemyAction): number {
  const power = action.effects.reduce(
    (sum, effect) => (effect.type === 'damage' ? sum + effect.power : sum),
    0
  );
  return Math.round(power / 4);
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
function enemyTargetPool(state: CombatState, action: EnemyAction): CombatantId[] {
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
    case 'self':
    case 'none':
      return [];
  }
}

/** Resolves the pool down to actual targets, rolling only for single-target. */
function enemyTargets(state: CombatState, action: EnemyAction): CombatantId[] {
  const pool = enemyTargetPool(state, action);

  if (action.target !== 'oneEnemy' && action.target !== 'oneAlly') return pool;
  if (pool.length === 0) return [];

  const pick = weightedPick(
    pool.map((id) => ({ id, weight: 1 })),
    state.seed
  );
  state.seed = pick.seed;
  return pick.picked ? [pick.picked.id] : [];
}

function hasTargets(state: CombatState, action: EnemyAction): boolean {
  if (action.target === 'none' || action.target === 'self') return true;
  return enemyTargetPool(state, action).length > 0;
}
