/**
 * Combat formulas. Pure functions over numbers — no state, no side effects.
 *
 * Kept in one file so every tuning constant in the game is visible at once.
 */

import type { Combatant, StatusEntry } from './types';

// ── Tuning constants ────────────────────────────────────────────────────────

/**
 * Mitigation is K / (K + defense). At K = 50, Defense 50 halves incoming
 * damage and Defense 100 cuts it to a third — Defense is a strong stat and
 * Defense debuffs are correspondingly valuable.
 */
export const DEFENSE_K = 50;

/** Each net Strength stack multiplies Attack by this, compounding. */
export const STRENGTH_MULTIPLIER = 1.3;

/** Each net Weakness stack multiplies Attack by this, compounding. */
export const WEAKNESS_MULTIPLIER = 0.7;

/** Each Poison stack deals this fraction of the victim's max health per tick. */
export const POISON_TICK_FRACTION = 0.04;

/** Turns a Poison application lasts, so each stack ticks twice. */
export const POISON_DURATION_TURNS = 2;

/** Multiplier applied to an attack that consumes a Bleed stack. */
export const BLEED_MULTIPLIER = 2;

/**
 * Multiplier applied to an attack on a resting character.
 *
 * Resting is already a turn spent doing nothing; this makes it a turn spent
 * being hit harder as well, so draining a character to zero is worth more than
 * the tempo it buys. It is what makes Cask's whole plan pay.
 */
export const RESTING_DAMAGE_MULTIPLIER = 1.5;

/**
 * Fraction of max stamina a standing combatant gets back as their team's turn
 * opens.
 *
 * Stamina is the only thing rationing what anyone does, so this is the pace of
 * the whole game: spend more than this a turn and you are running down, spend
 * less and you are banking. Resting characters get nothing from it — they are
 * refilled in full when they wake instead.
 */
export const STAMINA_REGEN_FRACTION = 0.4;

/**
 * Each Fatigue stack multiplies stamina loss by this, compounding.
 *
 * Compounding rather than additive so the game has one stacking rule: Strength
 * and Weakness already work this way.
 */
export const FATIGUE_MULTIPLIER = 1.2;

/**
 * Power a Counter Attack fires at.
 *
 * Matches Hollis's basic, and still scales with the counter-attacker's own
 * Attack stat through `computeDamage` — so it is their basic attack in every
 * way that currently varies. If a second character ever gains Counter, this
 * should move onto the combatant so each one counters with their own.
 */
export const COUNTER_ATTACK_POWER = 52;

/** Health an Undying stack restores when an enemy falls. */
export const UNDYING_HEAL_FRACTION = 0.5;

/**
 * What one non-damage effect on an enemy action costs, priced as attack power.
 *
 * Enemies have no deck, so stamina is the only thing rationing what they do. Pricing support at zero — which is what happened when the cost
 * counted damage alone — let a shielder or a curse-thrower act every turn
 * forever, and so made it immune to Cask and Lyra by accident.
 *
 * Set a little under a typical attack: supporting should tire an enemy slightly
 * less than swinging does, not cost it nothing.
 */
export const SUPPORT_EFFECT_POWER = 46;

/**
 * Power an enemy spends per point of stamina.
 *
 * What matters here is how many moves an enemy gets before it has to rest —
 * three Smashes and the Ogre is winded — and that number is a pacing decision,
 * not a consequence of how the moves happen to be numbered. So when every power
 * in the game went up 15%, this went up with them, from 4 to 4.6: a Smash at 92
 * costs the same 20 it cost at 80.
 *
 * Change it to make enemies tire faster or slower. Changing power alone no
 * longer does that, which is the point.
 */
export const ENEMY_POWER_PER_STAMINA = 4.6;

/** Damage equal to this fraction of max health drains the maximum stamina. */
export const STAMINA_DRAIN_PIVOT = 0.25;

/** Stamina drained, as a fraction of max stamina, at or above the pivot. */
export const STAMINA_DRAIN_CAP = 0.5;

/**
 * Enemy targeting. A single-target enemy move is still a roll, but not an even
 * one: the sturdier-looking party member draws more of them, and so does anyone
 * caught resting or already badly hurt.
 *
 * Sturdiness is max health over mitigation, relative to the party's average and
 * clamped to this band, so Hollis draws about twice what Emrys does and no more.
 */
export const TARGET_STURDINESS_MIN = 0.7;
export const TARGET_STURDINESS_MAX = 1.4;

/** Weight multiplier on a resting target. */
export const RESTING_TARGET_WEIGHT = 1.5;

/** Weight multiplier on a target below `WOUNDED_TARGET_THRESHOLD` of max health. */
export const WOUNDED_TARGET_WEIGHT = 1.25;
export const WOUNDED_TARGET_THRESHOLD = 0.5;

/** How far an archetype with no stated preference leans, 0 to 1. */
export const DEFAULT_TARGET_FOCUS = 0.5;

/**
 * The most any one target's share may be, as a multiple of an even share.
 *
 * At 1.5 that is half the hits against a full party of three, and three in four
 * against two. The lean should make a bad spot worse, never turn it into a
 * certainty: an enemy that always finds the resting character reads as the game
 * cheating rather than the enemy being clever.
 */
export const TARGET_SHARE_CAP = 1.5;

// ── Statuses → effective stats ──────────────────────────────────────────────

/**
 * Net Strength stacks: Strength minus Weakness across every entry.
 *
 * A stack of Weakness cancels a stack of Strength, so the two are collapsed to
 * a single signed number *before* any multiplier is applied. That matters —
 * multiplying 1.3 x 0.7 gives 0.91, so cancelling at the multiplier level would
 * leave a character permanently worse off after a buff and a debuff that were
 * meant to annul each other.
 */
export function netStrengthStacks(statuses: readonly StatusEntry[]): number {
  let net = 0;
  for (const entry of statuses) {
    // Only these two kinds affect Attack. Treating every non-Strength entry as
    // Weakness would make Poison and Bleed quietly weaken their bearer.
    if (entry.kind === 'strength') net += entry.stacks;
    else if (entry.kind === 'weakness') net -= entry.stacks;
  }
  return net;
}

/**
 * The multiplier net stacks apply to Attack, compounding per stack.
 *
 *   +1 → 1.30    +2 → 1.69    +3 → 2.197
 *   −1 → 0.70    −2 → 0.49    −3 → 0.343
 *
 * Uncapped in both directions, by design. Weakness approaches zero damage
 * asymptotically without ever quite reaching it.
 */
export function stackMultiplier(netStacks: number): number {
  if (netStacks === 0) return 1;
  return netStacks > 0
    ? STRENGTH_MULTIPLIER ** netStacks
    : WEAKNESS_MULTIPLIER ** -netStacks;
}

/**
 * Defence after Defense Up is applied.
 *
 * Uses the same compounding curve as Strength, per the design. Note that the
 * mitigation formula already has diminishing returns, so a stack of Defense Up
 * is worth much less on a high-Defense character than the raw multiplier looks:
 * DEF 65 to 84.5 moves mitigation from 0.435 to 0.372, about 14% less damage.
 */
export function effectiveDefense(combatant: Combatant): number {
  // Defense Down is the mirror of Defense Up exactly as Weakness is of
  // Strength: the two net out to one signed count before any multiplier.
  let stacks = 0;
  for (const entry of combatant.statuses) {
    if (entry.kind === 'defenseUp') stacks += entry.stacks;
    else if (entry.kind === 'defenseDown') stacks -= entry.stacks;
  }
  return stacks === 0 ? combatant.defense : combatant.defense * stackMultiplier(stacks);
}

/** Attack after Strength/Weakness are applied. */
export function effectiveAttack(combatant: Combatant): number {
  return combatant.attack * stackMultiplier(netStrengthStacks(combatant.statuses));
}

/**
 * How much Fatigue amplifies stamina loss.
 *
 * Applies to *every* source — damage drain, the cost of playing a card, and
 * direct drains like Buckshot. A Fatigued character tires faster at everything
 * they do and everything done to them.
 */
export function fatigueMultiplier(statuses: readonly StatusEntry[]): number {
  let stacks = 0;
  for (const entry of statuses) {
    if (entry.kind === 'fatigue') stacks += entry.stacks;
  }
  return stacks === 0 ? 1 : FATIGUE_MULTIPLIER ** stacks;
}

// ── Damage ──────────────────────────────────────────────────────────────────

/** Fraction of incoming damage that survives the target's Defense. */
export function mitigation(defense: number): number {
  return DEFENSE_K / (DEFENSE_K + Math.max(0, defense));
}

/**
 * Damage for one hit.
 *
 * Card power is a percentage of the attacker's effective Attack: power 60 lands
 * at 60% of their Attack, before the target's mitigation curve. Rounded to a
 * whole number, and never below 1 — a connecting hit should always do something.
 *
 * A resting target takes more. That is applied after mitigation rather than
 * before, so it is a flat increase to what actually lands: being caught
 * exhausted costs the same fraction of your health whether you are Hollis or
 * Emrys, which is not true of anything that goes in ahead of the Defense curve.
 *
 * Poison does not go through here and is untouched by this on purpose — it is a
 * clock running on its own, not a blow landing on a dropped guard.
 */
export function computeDamage(attacker: Combatant, target: Combatant, power: number): number {
  const raw = effectiveAttack(attacker) * (power / 100);
  const mitigated = raw * mitigation(effectiveDefense(target));
  const caught = target.resting ? mitigated * RESTING_DAMAGE_MULTIPLIER : mitigated;
  return Math.max(1, Math.round(caught));
}

/**
 * Damage from one Poison tick.
 *
 * Deliberately a flat percentage of the victim's max health, with no Attack and
 * no mitigation: Poison ignores Defense entirely. Routing it through the
 * mitigation curve would make Ivy near-useless against the tanky, high-Defense
 * targets she is specifically meant to grind down.
 */
export function poisonTickDamage(stacks: number, maxHealth: number): number {
  if (stacks <= 0) return 0;
  return Math.max(1, Math.round(maxHealth * POISON_TICK_FRACTION * stacks));
}

/**
 * Extra card power from the target's missing stamina.
 *
 * The exponent is what makes this a commitment rather than a freebie: at
 * exponent 2 a half-drained target yields only a quarter of the bonus, so the
 * card stays weak until the drain plan has actually done its work.
 */
export function missingStaminaBonus(
  target: Combatant,
  bonusPower: number,
  exponent: number
): number {
  if (target.maxStamina <= 0) return 0;

  const missing = 1 - target.stamina / target.maxStamina;
  return bonusPower * Math.max(0, missing) ** exponent;
}

// ── Stamina ─────────────────────────────────────────────────────────────────

/**
 * Stamina drained by taking a hit, scaling quadratically with the fraction of
 * max health the hit represents.
 *
 * Chip damage is close to free; a hit worth a quarter of max health drains half
 * the stamina bar and anything larger drains the same. Because it keys off a
 * *fraction* of max health, high-health characters stagger less from the same
 * absolute damage, which is what makes them feel tanky beyond the raw HP pool.
 *
 *    5% of max HP →  2 stamina     15% → 18
 *   10% of max HP →  8 stamina     25% → 50 (cap)
 */
export function staminaDrainFromDamage(
  damage: number,
  maxHealth: number,
  maxStamina: number
): number {
  if (damage <= 0 || maxHealth <= 0) return 0;

  const healthFraction = damage / maxHealth;
  const ratio = healthFraction / STAMINA_DRAIN_PIVOT;
  const drainFraction = Math.min(STAMINA_DRAIN_CAP, STAMINA_DRAIN_CAP * ratio ** 2);

  return Math.round(drainFraction * maxStamina);
}

// ── Team initiative ─────────────────────────────────────────────────────────

/**
 * Which team acts first, decided once at the start of the battle from the sum
 * of each side's Speed. Ties go to the player — a coin flip here would just
 * feel arbitrary at the moment the battle opens.
 */
export function decideFirstTeam(combatants: readonly Combatant[]): 'player' | 'enemy' {
  let playerSpeed = 0;
  let enemySpeed = 0;

  for (const combatant of combatants) {
    if (combatant.downed) continue;
    if (combatant.team === 'player') playerSpeed += combatant.speed;
    else enemySpeed += combatant.speed;
  }

  return enemySpeed > playerSpeed ? 'enemy' : 'player';
}
