import { describe, expect, it } from 'vitest';
import {
  computeDamage,
  DEFENSE_K,
  decideFirstTeam,
  effectiveAttack,
  mitigation,
  netStrengthStacks,
  stackMultiplier,
  staminaDrainFromDamage,
} from '@/game/combat/stats';
import type { Combatant, StatusEntry } from '@/game/combat/types';

const PERMANENT = { kind: 'permanent' } as const;

function combatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'test',
    name: 'Test',
    team: 'player',
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    attack: 100,
    defense: 0,
    speed: 10,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

const strength = (stacks: number): StatusEntry => ({ kind: 'strength', stacks, duration: PERMANENT });
const weakness = (stacks: number): StatusEntry => ({ kind: 'weakness', stacks, duration: PERMANENT });

describe('stackMultiplier', () => {
  it('compounds 30% per Strength stack rather than adding', () => {
    expect(stackMultiplier(1)).toBeCloseTo(1.3, 10);
    expect(stackMultiplier(2)).toBeCloseTo(1.69, 10);
    expect(stackMultiplier(3)).toBeCloseTo(2.197, 10);
  });

  it('compounds 30% down per Weakness stack', () => {
    expect(stackMultiplier(-1)).toBeCloseTo(0.7, 10);
    expect(stackMultiplier(-2)).toBeCloseTo(0.49, 10);
    expect(stackMultiplier(-3)).toBeCloseTo(0.343, 10);
  });

  it('is neutral at zero', () => {
    expect(stackMultiplier(0)).toBe(1);
  });

  it('is uncapped in both directions', () => {
    expect(stackMultiplier(10)).toBeGreaterThan(13);
    expect(stackMultiplier(-10)).toBeLessThan(0.03);
    expect(stackMultiplier(-10)).toBeGreaterThan(0);
  });
});

describe('netStrengthStacks', () => {
  it('nets Strength against Weakness', () => {
    expect(netStrengthStacks([strength(3), weakness(1)])).toBe(2);
    expect(netStrengthStacks([weakness(2), strength(1)])).toBe(-1);
  });

  it('returns zero for equal opposing stacks', () => {
    expect(netStrengthStacks([strength(2), weakness(2)])).toBe(0);
  });
});

describe('effectiveAttack', () => {
  it('leaves Attack alone with no statuses', () => {
    expect(effectiveAttack(combatant({ attack: 120 }))).toBe(120);
  });

  it('nets stacks before applying the multiplier, so a buff and debuff truly cancel', () => {
    // The bug this guards: applying 1.3 then 0.7 as separate multipliers gives
    // 0.91, leaving a character permanently worse off after a Strength and a
    // Weakness that were meant to annul each other.
    const unit = combatant({ attack: 100, statuses: [strength(1), weakness(1)] });
    expect(effectiveAttack(unit)).toBe(100);
  });

  it('applies compounded Strength', () => {
    const unit = combatant({ attack: 100, statuses: [strength(2)] });
    expect(effectiveAttack(unit)).toBeCloseTo(169, 6);
  });
});

describe('mitigation', () => {
  // Written against K rather than its current value: the curve is the rule, the
  // number is a dial, and a tuning pass should not have to edit this.
  it('is K/(K+DEF)', () => {
    expect(mitigation(0)).toBe(1);
    expect(mitigation(DEFENSE_K)).toBeCloseTo(0.5, 10);
    expect(mitigation(DEFENSE_K * 2)).toBeCloseTo(1 / 3, 10);
    expect(mitigation(DEFENSE_K * 3)).toBeCloseTo(0.25, 10);
  });

  it('never fully negates a hit', () => {
    expect(mitigation(100000)).toBeGreaterThan(0);
  });

  it('treats negative Defense as zero', () => {
    expect(mitigation(-50)).toBe(1);
  });
});

describe('computeDamage', () => {
  it('treats card power as a percentage of the attacker Attack', () => {
    const attacker = combatant({ attack: 100 });
    const target = combatant({ defense: 0 });

    expect(computeDamage(attacker, target, 60)).toBe(60);
    expect(computeDamage(attacker, target, 100)).toBe(100);
  });

  it('scales with the attacker Attack stat', () => {
    const target = combatant({ defense: 0 });
    expect(computeDamage(combatant({ attack: 120 }), target, 50)).toBe(60);
  });

  it('applies the mitigation curve', () => {
    // 100 attack x 70% power = 70 raw, halved by Defense equal to K.
    const attacker = combatant({ attack: 100 });
    expect(computeDamage(attacker, combatant({ defense: DEFENSE_K }), 70)).toBe(35);
  });

  it('combines Strength with mitigation', () => {
    // 100 x 1.3 = 130 attack, x 70% = 91 raw, halved = 45.5 → 46.
    const attacker = combatant({ attack: 100, statuses: [strength(1)] });
    expect(computeDamage(attacker, combatant({ defense: DEFENSE_K }), 70)).toBe(46);
  });

  it('always does at least 1', () => {
    const attacker = combatant({ attack: 1, statuses: [weakness(10)] });
    expect(computeDamage(attacker, combatant({ defense: 5000 }), 1)).toBe(1);
  });
});

describe('staminaDrainFromDamage', () => {
  it('drains half the bar at exactly 25% of max health', () => {
    expect(staminaDrainFromDamage(50, 200, 100)).toBe(50);
  });

  it('caps at half the bar for anything bigger', () => {
    expect(staminaDrainFromDamage(100, 200, 100)).toBe(50);
    expect(staminaDrainFromDamage(200, 200, 100)).toBe(50);
  });

  it('scales quadratically below the pivot', () => {
    // Half the pivot damage should cost a quarter of the drain.
    expect(staminaDrainFromDamage(25, 200, 100)).toBe(13); // 12.5 rounded
    expect(staminaDrainFromDamage(20, 200, 100)).toBe(8); // 10% of maxHP
  });

  it('barely touches stamina for chip damage', () => {
    expect(staminaDrainFromDamage(4, 200, 100)).toBe(0);
  });

  it('staggers high-health characters less for the same absolute damage', () => {
    const squishy = staminaDrainFromDamage(40, 200, 100);
    const tanky = staminaDrainFromDamage(40, 800, 100);
    expect(tanky).toBeLessThan(squishy);
  });

  it('scales to the character max stamina', () => {
    expect(staminaDrainFromDamage(50, 200, 140)).toBe(70);
  });

  it('is zero for no damage', () => {
    expect(staminaDrainFromDamage(0, 200, 100)).toBe(0);
  });
});

describe('decideFirstTeam', () => {
  it('gives the turn to the higher speed total', () => {
    const units = [
      combatant({ id: 'a', team: 'player', speed: 10 }),
      combatant({ id: 'b', team: 'player', speed: 10 }),
      combatant({ id: 'c', team: 'enemy', speed: 25 }),
    ];
    expect(decideFirstTeam(units)).toBe('enemy');
  });

  it('breaks ties for the player', () => {
    const units = [
      combatant({ id: 'a', team: 'player', speed: 10 }),
      combatant({ id: 'c', team: 'enemy', speed: 10 }),
    ];
    expect(decideFirstTeam(units)).toBe('player');
  });

  it('ignores downed combatants', () => {
    const units = [
      combatant({ id: 'a', team: 'player', speed: 10 }),
      combatant({ id: 'c', team: 'enemy', speed: 50, downed: true }),
    ];
    expect(decideFirstTeam(units)).toBe('player');
  });
});
