/**
 * Deterministic RNG.
 *
 * The seed lives in `CombatState` and every random draw returns a new seed
 * alongside its value, so nothing in the engine reads hidden global state. That
 * makes battles replayable, tests reproducible without stubbing `Math.random`,
 * and a future "same seed" debug mode free.
 */

/** mulberry32 — small, fast, and good enough for shuffling a deck. */
export function nextRandom(seed: number): { value: number; seed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  const nextSeed = t;

  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;

  return { value, seed: nextSeed };
}

/** Integer in [0, max). */
export function nextInt(seed: number, max: number): { value: number; seed: number } {
  const result = nextRandom(seed);
  return { value: Math.floor(result.value * max), seed: result.seed };
}

/** Fisher–Yates. Returns a new array; the input is not mutated. */
export function shuffle<T>(items: readonly T[], seed: number): { items: T[]; seed: number } {
  const result = [...items];
  let currentSeed = seed;

  for (let i = result.length - 1; i > 0; i--) {
    const roll = nextInt(currentSeed, i + 1);
    currentSeed = roll.seed;

    const j = roll.value;
    // Non-null assertions are safe: i and j are both within bounds by
    // construction, but `noUncheckedIndexedAccess` can't see that.
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }

  return { items: result, seed: currentSeed };
}

/** Picks one entry, with probability proportional to its weight. */
export function weightedPick<T extends { weight: number }>(
  options: readonly T[],
  seed: number
): { picked: T | null; seed: number } {
  const total = options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
  if (total <= 0) return { picked: null, seed };

  const roll = nextRandom(seed);
  let threshold = roll.value * total;

  for (const option of options) {
    threshold -= Math.max(0, option.weight);
    if (threshold <= 0) return { picked: option, seed: roll.seed };
  }

  // Only reachable through floating-point drift at the very top of the range.
  return { picked: options[options.length - 1] ?? null, seed: roll.seed };
}
