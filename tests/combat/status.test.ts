import { describe, expect, it } from 'vitest';
import { applyStatus, consumeOnAttacked, stacksOf, tickStatuses } from '@/game/combat/status';
import type { StatusDuration, StatusEntry } from '@/game/combat/types';

const PERMANENT: StatusDuration = { kind: 'permanent' };
const turns = (remaining: number): StatusDuration => ({ kind: 'turns', remaining });
const UNTIL_ATTACKED: StatusDuration = { kind: 'untilAttacked' };

describe('applyStatus', () => {
  it('adds a status to an empty list', () => {
    const result = applyStatus([], 'strength', 2, PERMANENT);
    expect(result).toEqual([{ kind: 'strength', stacks: 2, duration: PERMANENT }]);
  });

  it('folds into an existing entry of the same kind and duration', () => {
    const start = applyStatus([], 'strength', 2, PERMANENT);
    const result = applyStatus(start, 'strength', 3, PERMANENT);

    expect(result).toHaveLength(1);
    expect(result[0]?.stacks).toBe(5);
  });

  it('cancels one stack of the opposite for each applied', () => {
    const start: StatusEntry[] = [{ kind: 'strength', stacks: 3, duration: PERMANENT }];
    const result = applyStatus(start, 'weakness', 2, PERMANENT);

    expect(stacksOf(result, 'strength')).toBe(1);
    expect(stacksOf(result, 'weakness')).toBe(0);
  });

  it('leaves nothing behind when stacks exactly annul', () => {
    const start: StatusEntry[] = [{ kind: 'strength', stacks: 2, duration: PERMANENT }];
    const result = applyStatus(start, 'weakness', 2, PERMANENT);

    expect(result).toEqual([]);
  });

  it('carries the surplus over when the opposite is outnumbered', () => {
    const start: StatusEntry[] = [{ kind: 'strength', stacks: 1, duration: PERMANENT }];
    const result = applyStatus(start, 'weakness', 3, PERMANENT);

    expect(stacksOf(result, 'strength')).toBe(0);
    expect(stacksOf(result, 'weakness')).toBe(2);
  });

  it('never lets opposing statuses coexist', () => {
    let statuses = applyStatus([], 'strength', 2, PERMANENT);
    statuses = applyStatus(statuses, 'weakness', 1, PERMANENT);

    expect(stacksOf(statuses, 'strength')).toBe(1);
    expect(stacksOf(statuses, 'weakness')).toBe(0);
  });

  it('keeps timed entries separate from permanent ones', () => {
    let statuses = applyStatus([], 'strength', 1, PERMANENT);
    statuses = applyStatus(statuses, 'strength', 1, turns(2));

    expect(statuses).toHaveLength(2);
    expect(stacksOf(statuses, 'strength')).toBe(2);
  });

  it('ignores a non-positive application', () => {
    expect(applyStatus([], 'strength', 0, PERMANENT)).toEqual([]);
  });

  it('does not mutate the input', () => {
    const start: StatusEntry[] = [{ kind: 'strength', stacks: 3, duration: PERMANENT }];
    applyStatus(start, 'weakness', 2, PERMANENT);

    expect(start[0]?.stacks).toBe(3);
  });
});

describe('tickStatuses', () => {
  it('leaves permanent statuses alone — Strength lasts all battle', () => {
    const start: StatusEntry[] = [{ kind: 'strength', stacks: 2, duration: PERMANENT }];

    let statuses = start;
    for (let i = 0; i < 20; i++) statuses = tickStatuses(statuses);

    expect(stacksOf(statuses, 'strength')).toBe(2);
  });

  it('counts timed statuses down', () => {
    const start: StatusEntry[] = [{ kind: 'weakness', stacks: 1, duration: turns(2) }];
    const once = tickStatuses(start);

    expect(once[0]?.duration).toEqual(turns(1));
  });

  it('drops a timed status when it expires', () => {
    const start: StatusEntry[] = [{ kind: 'weakness', stacks: 1, duration: turns(1) }];
    expect(tickStatuses(start)).toEqual([]);
  });

  it('leaves untilAttacked statuses to be consumed elsewhere', () => {
    const start: StatusEntry[] = [{ kind: 'strength', stacks: 1, duration: UNTIL_ATTACKED }];
    expect(tickStatuses(start)).toHaveLength(1);
  });
});

describe('consumeOnAttacked', () => {
  it('removes untilAttacked statuses', () => {
    const start: StatusEntry[] = [
      { kind: 'strength', stacks: 1, duration: UNTIL_ATTACKED },
      { kind: 'weakness', stacks: 1, duration: PERMANENT },
    ];

    const result = consumeOnAttacked(start);
    expect(result).toHaveLength(1);
    expect(result[0]?.duration).toEqual(PERMANENT);
  });

  it('leaves permanent and timed statuses in place', () => {
    const start: StatusEntry[] = [
      { kind: 'strength', stacks: 1, duration: PERMANENT },
      { kind: 'weakness', stacks: 1, duration: turns(3) },
    ];

    expect(consumeOnAttacked(start)).toHaveLength(2);
  });
});
