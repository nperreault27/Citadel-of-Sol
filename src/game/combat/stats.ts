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
export const POISON_TICK_FRACTION = 0.05;

/** Turns a Poison application lasts, so each stack ticks twice. */
export const POISON_DURATION_TURNS = 2;

/** Multiplier applied to an attack that consumes a Bleed stack. */
export const BLEED_MULTIPLIER = 2;

/** Damage equal to this fraction of max health drains the maximum stamina. */
export const STAMINA_DRAIN_PIVOT = 0.25;

/** Stamina drained, as a fraction of max stamina, at or above the pivot. */
export const STAMINA_DRAIN_CAP = 0.5;

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

/** Attack after Strength/Weakness are applied. */
export function effectiveAttack(combatant: Combatant): number {
  return combatant.attack * stackMultiplier(netStrengthStacks(combatant.statuses));
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
 */
export function computeDamage(attacker: Combatant, target: Combatant, power: number): number {
  const raw = effectiveAttack(attacker) * (power / 100);
  const mitigated = raw * mitigation(target.defense);
  return Math.max(1, Math.round(mitigated));
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
