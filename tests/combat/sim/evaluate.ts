import { cardDefOf } from '@/game/combat/engine';
import {
  BLEED_MULTIPLIER,
  COUNTER_ATTACK_POWER,
  UNDYING_HEAL_FRACTION,
  effectiveAttack,
  effectiveDefense,
  mitigation,
  poisonTickDamage,
} from '@/game/combat/stats';
import { stacksOf } from '@/game/combat/status';
import type {
  CardInstanceId,
  Combatant,
  CombatContent,
  CombatState,
} from '@/game/combat/types';
import { threatOf } from './threat';

/**
 * How good a battle state is for the party, as one number.
 *
 * The model is a race. The party has a damage output per turn and a pool of
 * health; the enemies have a threat per turn and a pool of effective health.
 * Killing them in the best order (highest threat per point of health first —
 * Smith's rule), the score is the party's health minus the damage it expects to
 * take before the last enemy falls.
 *
 * Almost every mechanic lands in that sum without a special case:
 *   - Strength on an ally raises party output, so the fight ends sooner.
 *   - Weakness or Fatigue on an enemy lowers its threat.
 *   - Poison and Bleed are damage already banked against enemy health.
 *   - Shields and Defense Up are health, or mitigation, on whichever side.
 *   - A downed ally takes their health *and* their output out of the race.
 *   - Focus fire and "kill the Acolyte first" fall out of the kill order.
 *
 * What the sum cannot see — Taunt, Immunity, a Goad that saves a dying Emrys —
 * the planner sees by playing the enemy's turn out before it scores.
 */

/** Result for a won battle; always beats any unfinished state. */
const VICTORY = 1000;

/** Result for a lost battle. */
const DEFEAT = -1000;

/**
 * Card power the party throws per turn, shared across its members.
 *
 * About five cards a turn at sixty power each. Split evenly, so a downed ally
 * removes their share: their cards sit dead in the deck.
 */
const PARTY_POWER_PER_TURN = 300;

/** A resting ally still holds cards, but plays none of them this turn. */
const RESTING_OUTPUT = 0.5;

/** Typical card power, for pricing Bleed and Counter against the average hit. */
const TYPICAL_POWER = 60;

/** Odds an Undying stack pays out before the fight ends. */
const UNDYING_ODDS = 0.5;

/**
 * Weight of keeping each character standing, beyond their health.
 *
 * The race counts health as a pool, but a party of one full-health tank and two
 * corpses plays far worse than three people at a third each. This is what
 * makes the planner spread protection and revive allies.
 */
const ALIVE_WEIGHT = 0.5;

/** Output lost per downed ally is already in the race; this discourages a slow bleed-out too. */
const LOW_HEALTH_SHARE = 0.5;

/**
 * Threat assumed for every enemy when none of them has any.
 *
 * The race scores a state by the damage the party expects to take before the
 * last enemy falls, so a field of enemies that threaten nothing scores the same
 * however much health they have left — and the planner stops attacking. That
 * only happens against a probe's inert target (every real archetype has a move
 * that hits), where the point is to kill it as fast as possible. A nominal
 * threat turns the race back on without touching any real fight's score, and
 * without making Weakness or Fatigue look useful against something harmless.
 */
const INERT_THREAT = 100;

/** What a point of stamina is worth when comparing cards to throw away. */
const CARD_STAMINA_PRICE = 1;

function members(state: CombatState, order: readonly string[]): Combatant[] {
  return order
    .map((id) => state.combatants[id])
    .filter((c): c is Combatant => c !== undefined);
}

/** Poison still to tick on this combatant, in health. */
function pendingPoison(combatant: Combatant): number {
  let total = 0;
  for (const entry of combatant.statuses) {
    if (entry.kind !== 'poison' || entry.duration.kind !== 'turns') continue;
    total += poisonTickDamage(entry.stacks, combatant.maxHealth) * entry.duration.remaining;
  }
  return total;
}

interface EnemyEntry {
  enemy: Combatant;
  threat: number;
  /** Raw Attack-scaled damage still needed to put it down. */
  rawHealth: number;
}

export function evaluate(state: CombatState, content: CombatContent): number {
  const party = members(state, state.playerOrder);
  const living = party.filter((c) => !c.downed);
  const maxPartyHealth = party.reduce((sum, c) => sum + c.maxHealth, 0) || 1;
  const partyHealth = living.reduce((sum, c) => sum + c.health + c.shield, 0);

  if (state.phase === 'victory') return VICTORY + partyHealth / maxPartyHealth;
  if (state.phase === 'defeat' || living.length === 0) return DEFEAT;

  const share = PARTY_POWER_PER_TURN / 100 / Math.max(1, party.length);
  const output = Math.max(
    1,
    living.reduce(
      (sum, c) => sum + effectiveAttack(c) * share * (c.resting ? RESTING_OUTPUT : 1),
      0
    )
  );
  const meanAttack = living.reduce((sum, c) => sum + effectiveAttack(c), 0) / living.length;
  const partyMitigation =
    living.reduce((sum, c) => sum + mitigation(effectiveDefense(c)), 0) / living.length;

  const enemies: EnemyEntry[] = members(state, state.enemyOrder)
    .filter((enemy) => !enemy.downed)
    .map((enemy) => {
      const mit = mitigation(effectiveDefense(enemy));
      let rawHealth = (enemy.health + enemy.shield) / mit;
      rawHealth -= pendingPoison(enemy) / mit;
      rawHealth -=
        stacksOf(enemy.statuses, 'bleed') *
        (BLEED_MULTIPLIER - 1) *
        meanAttack *
        (TYPICAL_POWER / 100);
      rawHealth +=
        (stacksOf(enemy.statuses, 'undying') * UNDYING_HEAL_FRACTION * enemy.maxHealth * UNDYING_ODDS) /
        mit;

      return { enemy, threat: threatOf(state, content, enemy), rawHealth: Math.max(1, rawHealth) };
    });

  if (enemies.length > 0 && enemies.every((entry) => entry.threat === 0)) {
    for (const entry of enemies) entry.threat = INERT_THREAT;
  }

  // A summoner takes its brood down with it, so its kill priority carries theirs.
  const broodThreat = (id: string) =>
    enemies
      .filter((entry) => entry.enemy.summonedBy === id)
      .reduce((sum, entry) => sum + entry.threat, 0);

  const ordered = [...enemies].sort(
    (a, b) =>
      (b.threat + broodThreat(b.enemy.id)) / b.rawHealth -
      (a.threat + broodThreat(a.enemy.id)) / a.rawHealth
  );

  const finished = new Set<string>();
  let elapsed = 0;
  let exposure = 0;

  for (const entry of ordered) {
    if (finished.has(entry.enemy.id)) continue;

    elapsed += entry.rawHealth;
    finished.add(entry.enemy.id);
    exposure += entry.threat * elapsed;

    for (const other of enemies) {
      if (other.enemy.summonedBy !== entry.enemy.id || finished.has(other.enemy.id)) continue;
      finished.add(other.enemy.id);
      exposure += other.threat * elapsed;
    }
  }

  let incoming = (exposure / output) * partyMitigation;

  for (const { enemy } of enemies) {
    incoming +=
      stacksOf(enemy.statuses, 'counter') *
      effectiveAttack(enemy) *
      (COUNTER_ATTACK_POWER / 100) *
      partyMitigation;
  }

  const standing =
    party.reduce(
      (sum, c) =>
        c.downed ? sum : sum + (1 - LOW_HEALTH_SHARE) + LOW_HEALTH_SHARE * (c.health / c.maxHealth),
      0
    ) / party.length;

  return (partyHealth - incoming) / maxPartyHealth + ALIVE_WEIGHT * standing;
}

/**
 * A rough standalone worth for one card in hand.
 *
 * Only used where the planner must throw cards away without searching every
 * combination — discarding down to the hand limit. A card whose owner is down
 * is worth nothing, which is the one thing that has to be right.
 */
export function cardValue(
  state: CombatState,
  content: CombatContent,
  instanceId: CardInstanceId
): number {
  const def = cardDefOf(state, content, instanceId);
  if (!def) return 0;

  const owner = def.ownerId ? state.combatants[def.ownerId] : undefined;
  if (def.ownerId && (!owner || owner.downed)) return 0;

  const attack = owner ? effectiveAttack(owner) : 100;
  const enemies = members(state, state.enemyOrder).filter((c) => !c.downed).length;
  const spread = def.target === 'allEnemies' ? enemies : 1;

  let value = 0;
  for (const effect of def.effects) {
    switch (effect.type) {
      case 'damage':
        value += effect.power * (attack / 100) * spread;
        break;
      case 'chainDamage':
      case 'discardHandAndAttack':
        value += effect.power * (attack / 100) * 3;
        break;
      case 'shield':
        value += (owner?.maxHealth ?? 0) * effect.fractionOfSourceMaxHealth;
        break;
      case 'status':
      case 'focusedStatus':
        value += 40 * spread;
        break;
      case 'draw':
        value += 30 * effect.count;
        break;
      case 'extendPoison':
        value += 20;
        break;
      case 'castCopiesFromDrawPile': {
        // Worth each cast's damage, and the casts are whatever copies are still
        // waiting in the draw pile plus the free one.
        const cast = content.cardDefs[effect.cardId];
        if (!cast) break;
        const copies = state.drawPile.filter(
          (id) => state.cards[id]?.definitionId === effect.cardId
        ).length;
        const castSpread = cast.target === 'allEnemies' ? enemies : 1;
        for (const castEffect of cast.effects) {
          if (castEffect.type !== 'damage') continue;
          value += castEffect.power * (attack / 100) * castSpread * (copies + effect.extra);
        }
        break;
      }
      default:
        value += 30;
        break;
    }
  }

  return value - CARD_STAMINA_PRICE * def.staminaCost;
}
