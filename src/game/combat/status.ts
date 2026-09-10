/**
 * Status application and expiry. Pure — takes a status list, returns a new one.
 */

import type { StatusDuration, StatusEntry, StatusKind } from './types';

/**
 * Statuses that annul each other one stack at a time.
 *
 * Only Strength and Weakness pair up. Poison and Bleed have no opposite and are
 * absent here, so applying them skips cancellation entirely.
 */
const OPPOSITE: Partial<Record<StatusKind, StatusKind>> = {
  strength: 'weakness',
  weakness: 'strength',
};

function sameDuration(a: StatusDuration, b: StatusDuration): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'turns' && b.kind === 'turns') return a.remaining === b.remaining;
  return true;
}

/**
 * Applies stacks of a status, cancelling against its opposite first.
 *
 * A stack of Weakness annuls a stack of Strength, so applying 2 Weakness to a
 * character holding 3 Strength leaves 1 Strength — not 3 Strength and 2
 * Weakness sitting side by side. Cancellation happens here, at application
 * time, rather than being deferred to the damage formula, so what the player
 * sees in the status row is the real net state.
 *
 * Opposing stacks are consumed from the front of the list, which is oldest
 * first. With Strength and Weakness both permanent this is unobservable; it
 * only becomes visible once timed statuses join the roster, and consuming the
 * oldest is the least surprising rule then.
 */
export function applyStatus(
  statuses: readonly StatusEntry[],
  kind: StatusKind,
  stacks: number,
  duration: StatusDuration
): StatusEntry[] {
  if (stacks <= 0) return [...statuses];

  const opposite = OPPOSITE[kind];
  let remaining = stacks;

  const result: StatusEntry[] = [];
  for (const entry of statuses) {
    if (opposite !== undefined && remaining > 0 && entry.kind === opposite) {
      const cancelled = Math.min(remaining, entry.stacks);
      remaining -= cancelled;

      const left = entry.stacks - cancelled;
      if (left > 0) result.push({ ...entry, stacks: left });
      continue;
    }
    result.push({ ...entry });
  }

  if (remaining <= 0) return result;

  // Fold into an existing entry of the same kind and duration where possible,
  // so the status row shows "Strength 4" rather than four separate pips.
  const existing = result.find(
    (entry) => entry.kind === kind && sameDuration(entry.duration, duration)
  );

  if (existing) {
    existing.stacks += remaining;
    return result;
  }

  result.push({ kind, stacks: remaining, duration });
  return result;
}

/**
 * Ticks timed statuses at the end of the bearer's team turn.
 *
 * `permanent` entries — which is what Strength and Weakness are — never expire,
 * and `untilAttacked` entries are consumed elsewhere, on being hit.
 */
export function tickStatuses(statuses: readonly StatusEntry[]): StatusEntry[] {
  const result: StatusEntry[] = [];

  for (const entry of statuses) {
    if (entry.duration.kind !== 'turns') {
      result.push({ ...entry });
      continue;
    }

    const remaining = entry.duration.remaining - 1;
    if (remaining > 0) {
      result.push({ ...entry, duration: { kind: 'turns', remaining } });
    }
  }

  return result;
}

/** Drops `untilAttacked` statuses. Called when the bearer is hit. */
export function consumeOnAttacked(statuses: readonly StatusEntry[]): StatusEntry[] {
  return statuses.filter((entry) => entry.duration.kind !== 'untilAttacked').map((e) => ({ ...e }));
}

/** Total stacks of one kind, for display. */
export function stacksOf(statuses: readonly StatusEntry[], kind: StatusKind): number {
  return statuses.reduce((sum, entry) => (entry.kind === kind ? sum + entry.stacks : sum), 0);
}

/**
 * Removes one stack of Bleed.
 *
 * Bleed is consumed a stack at a time by attacks rather than by a timer, so it
 * can't ride on `tickStatuses` or `consumeOnAttacked` — those remove a whole
 * entry. Returns whether a stack was actually taken, since that decides whether
 * the attack is doubled.
 */
export function consumeBleedStack(statuses: readonly StatusEntry[]): {
  statuses: StatusEntry[];
  consumed: boolean;
} {
  const index = statuses.findIndex((entry) => entry.kind === 'bleed' && entry.stacks > 0);
  if (index === -1) return { statuses: statuses.map((entry) => ({ ...entry })), consumed: false };

  const result: StatusEntry[] = [];
  statuses.forEach((entry, i) => {
    if (i !== index) {
      result.push({ ...entry });
      return;
    }
    const left = entry.stacks - 1;
    if (left > 0) result.push({ ...entry, stacks: left });
  });

  return { statuses: result, consumed: true };
}

/**
 * Adds turns to every Poison countdown.
 *
 * Only `turns` entries can be extended — a permanent status has no clock to
 * push back. Entries are extended in place rather than merged, so stacks that
 * were already staggered stay staggered.
 */
export function extendPoisonDuration(
  statuses: readonly StatusEntry[],
  turns: number
): StatusEntry[] {
  if (turns <= 0) return statuses.map((entry) => ({ ...entry }));

  return statuses.map((entry) => {
    if (entry.kind !== 'poison' || entry.duration.kind !== 'turns') return { ...entry };
    return {
      ...entry,
      duration: { kind: 'turns', remaining: entry.duration.remaining + turns },
    };
  });
}
