import { describe, expect, it } from 'vitest';
import {
  createCombat,
  resolveEnemyTurn,
  targetWeights,
} from '@/game/combat/engine';
import { TARGET_SHARE_CAP } from '@/game/combat/stats';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  EnemyAction,
} from '@/game/combat/types';

/**
 * Who an enemy's single-target move lands on.
 *
 * Still a roll, but a leaning one: sturdier-looking characters, resting ones
 * and badly hurt ones draw more of it, by as much as the archetype's focus says,
 * and never past the share cap. These pin the rule, not how often anyone wins.
 */

function unit(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero',
    name: 'Hero',
    team: 'player',
    health: 400,
    maxHealth: 400,
    stamina: 100,
    maxStamina: 100,
    attack: 100,
    defense: 30,
    speed: 1,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

const sum = (xs: readonly number[]) => xs.reduce((total, x) => total + x, 0);

describe('targetWeights', () => {
  it('rolls evenly at focus 0, whatever state the targets are in', () => {
    const shares = targetWeights(
      [
        unit({ id: 'a', maxHealth: 2000, health: 100, resting: true }),
        unit({ id: 'b' }),
        unit({ id: 'c' }),
      ],
      0
    );

    for (const share of shares) expect(share).toBeCloseTo(1 / 3);
  });

  it('always sums to one', () => {
    const shares = targetWeights(
      [unit({ id: 'a', resting: true }), unit({ id: 'b', health: 50 }), unit({ id: 'c' })],
      1
    );

    expect(sum(shares)).toBeCloseTo(1);
  });

  it('leans toward the sturdier target, clamped so the gap is at most double', () => {
    // A hundredfold difference in bulk still only buys the clamp band: 1.4 against 0.7.
    const [tank, glass] = targetWeights(
      [unit({ id: 'tank', maxHealth: 10000, health: 10000 }), unit({ id: 'glass', maxHealth: 100, health: 100 })],
      1
    );

    expect(tank! / glass!).toBeCloseTo(2);
  });

  it('counts Defense as well as health toward looking sturdy', () => {
    const [armoured, bare] = targetWeights(
      [unit({ id: 'armoured', defense: 60 }), unit({ id: 'bare', defense: 0 })],
      1
    );

    expect(armoured!).toBeGreaterThan(bare!);
  });

  it('leans toward a resting target', () => {
    const [resting, standing] = targetWeights(
      [unit({ id: 'resting', resting: true }), unit({ id: 'standing' })],
      1
    );

    expect(resting! / standing!).toBeCloseTo(1.5);
  });

  it('leans toward a target under half health', () => {
    const [hurt, fine] = targetWeights([unit({ id: 'hurt', health: 150 }), unit({ id: 'fine' })], 1);

    expect(hurt! / fine!).toBeCloseTo(1.25);
  });

  it('scales the lean with focus', () => {
    const targets = [unit({ id: 'resting', resting: true }), unit({ id: 'standing' })];

    const half = targetWeights(targets, 0.5)[0]!;
    const full = targetWeights(targets, 1)[0]!;

    expect(half).toBeGreaterThan(0.5);
    expect(full).toBeGreaterThan(half);
  });

  it('never gives one of three more than the cap, however bad their spot', () => {
    const shares = targetWeights(
      [
        unit({ id: 'doomed', maxHealth: 5000, health: 10, resting: true }),
        unit({ id: 'b', maxHealth: 100, health: 100 }),
        unit({ id: 'c', maxHealth: 100, health: 100 }),
      ],
      1
    );

    expect(shares[0]).toBeCloseTo(TARGET_SHARE_CAP / 3);
    expect(sum(shares)).toBeCloseTo(1);
  });

  it('lets the cap loosen as the party thins, rather than forcing an even split', () => {
    const [doomed, other] = targetWeights(
      [
        unit({ id: 'doomed', maxHealth: 5000, health: 10, resting: true }),
        unit({ id: 'other', maxHealth: 100, health: 100 }),
      ],
      1
    );

    expect(doomed!).toBeGreaterThan(0.5);
    expect(doomed!).toBeLessThanOrEqual(TARGET_SHARE_CAP / 2 + 1e-9);
    expect(doomed! + other!).toBeCloseTo(1);
  });
});

describe('an enemy picking a target', () => {
  const CARDS: Record<string, CardDefinition> = {
    wait: {
      id: 'wait',
      tier: 'basic',
      name: 'Wait',
      description: 'Do nothing.',
      brief: 'Nothing',
      ownerId: null,
      staminaCost: 0,
      target: 'none',
      effects: [],
    },
  };

  const BITE: EnemyAction = {
    id: 'foe.bite',
    name: 'Bite',
    description: 'Bite one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 10 }],
  };

  const foe = { ...unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 99 }), archetype: 'foe' };

  /** The easy mark: bulky enough to hit the clamp, resting, and badly hurt. */
  const mark = () =>
    unit({ id: 'mark', name: 'Mark', maxHealth: 5000, health: 100, resting: true });
  const other = () => unit({ id: 'other', name: 'Other', maxHealth: 100, health: 100 });

  function content(focus: number | undefined): CombatContent {
    return {
      cardDefs: CARDS,
      enemyActions: { foe: [BITE] },
      ...(focus === undefined ? {} : { enemyTargeting: { foe: { focus } } }),
    };
  }

  /** Which of the two was hit on one enemy turn, from one seed. */
  function victim(seed: number, rules: CombatContent): string {
    const state = createCombat({
      combatants: [mark(), other(), foe],
      deck: Array.from({ length: 10 }, () => 'wait'),
      seed,
    });
    const after = resolveEnemyTurn(state, rules);
    return after.combatants['mark']!.health < 100 ? 'mark' : 'other';
  }

  function markShare(rules: CombatContent): number {
    let hits = 0;
    for (let seed = 1; seed <= 400; seed++) if (victim(seed, rules) === 'mark') hits++;
    return hits / 400;
  }

  it('hits the easy mark far more often when the archetype hunts', () => {
    // Capped at three in four with two targets, against a coin flip at focus 0.
    expect(markShare(content(1))).toBeGreaterThan(0.65);
    expect(markShare(content(0))).toBeLessThan(0.6);
  });

  it('picks the same target from the same seed', () => {
    const rules = content(undefined);
    for (const seed of [3, 17, 91]) expect(victim(seed, rules)).toBe(victim(seed, rules));
  });

  it('still sends every single-target attack to a taunting defender', () => {
    const taunting = unit({
      id: 'other',
      name: 'Other',
      maxHealth: 100,
      health: 100,
      statuses: [{ kind: 'taunt', stacks: 1, duration: { kind: 'perTurnStack' } }],
    });

    for (let seed = 1; seed <= 20; seed++) {
      const state = createCombat({
        combatants: [mark(), taunting, foe],
        deck: Array.from({ length: 10 }, () => 'wait'),
        seed,
      });
      const after = resolveEnemyTurn(state, content(1));
      expect(after.combatants['mark']!.health).toBe(100);
    }
  });
});
