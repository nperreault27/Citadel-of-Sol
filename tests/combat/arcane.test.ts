import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  selectCard,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import { UNDYING_HEAL_FRACTION } from '@/game/combat/stats';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from '@/game/combat/types';

const PERMANENT: StatusDuration = { kind: 'permanent' };

function unit(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'caster',
    name: 'Caster',
    team: 'player',
    health: 200,
    maxHealth: 200,
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

function foe(overrides: Partial<Combatant> = {}): Combatant {
  return unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1, ...overrides });
}

const CARDS: Record<string, CardDefinition> = {
  arc: {
    id: 'arc',
    tier: 'basic',
    name: 'Arc',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 2,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'chainDamage', power: 20, continueChance: 0.8, maxHits: 50 }],
  },
  arcOnce: {
    id: 'arcOnce',
    tier: 'basic',
    name: 'Arc Once',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 2,
    staminaCost: 10,
    target: 'oneEnemy',
    // Never continues, so the chain is exactly one hit.
    effects: [{ type: 'chainDamage', power: 20, continueChance: 0, maxHits: 50 }],
  },
  arcAlways: {
    id: 'arcAlways',
    tier: 'basic',
    name: 'Arc Always',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 2,
    staminaCost: 10,
    target: 'oneEnemy',
    // Always continues, so only maxHits or a lack of targets can stop it.
    effects: [{ type: 'chainDamage', power: 5, continueChance: 1, maxHits: 6 }],
  },
  reserve: {
    id: 'reserve',
    tier: 'basic',
    name: 'Reserve',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 1,
    staminaCost: 5,
    target: 'oneAlly',
    effects: [{ type: 'restoreStamina', amount: 40 }],
  },
  bloodlet: {
    id: 'bloodlet',
    tier: 'basic',
    name: 'Bloodlet',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    healthCostFraction: 0.15,
    effects: [{ type: 'damage', power: 85 }],
  },
  siphon: {
    id: 'siphon',
    tier: 'basic',
    name: 'Siphon',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60, lifesteal: 0.5 }],
  },
  undying: {
    id: 'undying',
    tier: 'basic',
    name: 'Undying',
    description: '',
    brief: '',
    ownerId: 'caster',
    energyCost: 2,
    staminaCost: 10,
    target: 'self',
    effects: [{ type: 'status', kind: 'undying', stacks: 1, duration: PERMANENT }],
  },
  finisher: {
    id: 'finisher',
    tier: 'basic',
    name: 'Finisher',
    description: '',
    brief: '',
    ownerId: 'ally',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 500 }],
  },
};

function battle(options: {
  combatants?: Combatant[];
  deck?: string[];
  enemyActions?: Record<string, EnemyAction[]>;
}) {
  const combatants = options.combatants ?? [unit(), foe()];
  const enemyActions: Record<string, EnemyAction[]> = options.enemyActions ?? {};
  for (const c of combatants) {
    if (c.team === 'enemy' && !enemyActions[c.id]) enemyActions[c.id] = [];
  }

  const state = createCombat({
    combatants,
    deck: options.deck ?? Array.from({ length: 12 }, () => 'arc'),
    seed: 42,
  });

  return { state, content: { cardDefs: CARDS, enemyActions } satisfies CombatContent };
}

function findInHand(state: CombatState, definitionId: string): string {
  const found = state.hand.find((id) => state.cards[id]?.definitionId === definitionId);
  if (!found) throw new Error('card not in hand: ' + definitionId);
  return found;
}

function play(state: CombatState, content: CombatContent, def: string, target?: string) {
  const card = findInHand(state, def);
  const mid = selectCard(state, content, card);
  return target ? chooseTarget(mid, content, target) : mid;
}

function totalEnemyDamage(before: CombatState, after: CombatState): number {
  return before.enemyOrder.reduce((sum, id) => {
    const was = before.combatants[id]?.health ?? 0;
    const now = after.combatants[id]?.health ?? 0;
    return sum + (was - now);
  }, 0);
}

// ── Chain lightning ─────────────────────────────────────────────────────────

describe('chain damage', () => {
  it('always hits the chosen target at least once', () => {
    const { state, content } = battle({
      combatants: [unit(), foe({ id: 'a' }), foe({ id: 'b' })],
      deck: Array.from({ length: 12 }, () => 'arcOnce'),
    });

    const after = play(state, content, 'arcOnce', 'b');

    expect(after.combatants['b']?.health).toBe(180);
    expect(after.combatants['a']?.health).toBe(200);
  });

  it('spreads its hits across the living enemies', () => {
    const before = battle({
      combatants: [unit(), foe({ id: 'a' }), foe({ id: 'b' })],
      deck: Array.from({ length: 12 }, () => 'arcAlways'),
    });

    const after = play(before.state, before.content, 'arcAlways', 'a');

    // 6 hits at power 5, wherever they land.
    expect(totalEnemyDamage(before.state, after)).toBe(30);
    expect(after.combatants['a']!.health).toBeLessThan(200);
  });

  it('keeps striking a lone enemy rather than fizzling', () => {
    // The chain may re-hit the enemy it just struck, so a single target is a
    // fine place to cast it — otherwise the card would be one hit for two
    // energy exactly when you are finishing someone off.
    const { state, content } = battle({
      combatants: [unit(), foe({ id: 'a' })],
      deck: Array.from({ length: 12 }, () => 'arcAlways'),
    });

    // All 6 hits land on the only enemy there is.
    expect(play(state, content, 'arcAlways', 'a').combatants['a']?.health).toBe(170);
  });

  it('is worth casting into one target as well as many', () => {
    // Same seed, same card: the lone-enemy case should now be in the same
    // ballpark as the crowded one rather than a fraction of it.
    const solo = battle({
      combatants: [unit(), foe({ id: 'a' })],
      deck: Array.from({ length: 12 }, () => 'arc'),
    });
    const crowd = battle({
      combatants: [unit(), foe({ id: 'a' }), foe({ id: 'b' })],
      deck: Array.from({ length: 12 }, () => 'arc'),
    });

    const soloDamage = totalEnemyDamage(solo.state, play(solo.state, solo.content, 'arc', 'a'));
    const crowdDamage = totalEnemyDamage(crowd.state, play(crowd.state, crowd.content, 'arc', 'a'));

    expect(soloDamage).toBeGreaterThan(0);
    expect(soloDamage).toBe(crowdDamage);
  });

  it('respects the safety cap when it always continues', () => {
    const { state, content } = battle({
      combatants: [unit(), foe({ id: 'a' }), foe({ id: 'b' })],
      deck: Array.from({ length: 12 }, () => 'arcAlways'),
    });

    const before = state;
    const after = play(state, content, 'arcAlways', 'a');

    // maxHits 6 at power 5 against 100 attack, no mitigation.
    expect(totalEnemyDamage(before, after)).toBe(30);
  });

  it('is deterministic for a given seed', () => {
    const a = battle({ combatants: [unit(), foe({ id: 'a' }), foe({ id: 'b' })] });
    const b = battle({ combatants: [unit(), foe({ id: 'a' }), foe({ id: 'b' })] });

    const left = play(a.state, a.content, 'arc', 'a');
    const right = play(b.state, b.content, 'arc', 'a');

    expect(totalEnemyDamage(a.state, left)).toBe(totalEnemyDamage(b.state, right));
  });

  it('produces different chains from different seeds', () => {
    const results = new Set<number>();

    for (let seed = 1; seed <= 30; seed++) {
      const combatants = [unit(), foe({ id: 'a' }), foe({ id: 'b' })];
      const state = createCombat({
        combatants,
        deck: Array.from({ length: 12 }, () => 'arc'),
        seed,
      });
      const content: CombatContent = { cardDefs: CARDS, enemyActions: { a: [], b: [] } };

      results.add(totalEnemyDamage(state, play(state, content, 'arc', 'a')));
    }

    // A chain that always dealt the same total would not be a chain.
    expect(results.size).toBeGreaterThan(1);
  });

  it('stops arcing once the remaining enemies are down', () => {
    const { state, content } = battle({
      combatants: [unit(), foe({ id: 'a', health: 1 }), foe({ id: 'b', downed: true, health: 0 })],
      deck: Array.from({ length: 12 }, () => 'arcAlways'),
    });

    const after = play(state, content, 'arcAlways', 'a');
    expect(after.combatants['a']?.downed).toBe(true);
    expect(after.combatants['b']?.health).toBe(0);
  });
});

// ── Reserve ─────────────────────────────────────────────────────────────────

describe('restoreStamina', () => {
  it('gives stamina back', () => {
    const { state, content } = battle({
      combatants: [unit({ stamina: 30 }), foe()],
      deck: Array.from({ length: 12 }, () => 'reserve'),
    });

    // 30, minus the card's own 5, plus 40.
    expect(play(state, content, 'reserve', 'caster').combatants['caster']?.stamina).toBe(65);
  });

  it('never exceeds the maximum', () => {
    const { state, content } = battle({
      combatants: [unit({ stamina: 100 }), foe()],
      deck: Array.from({ length: 12 }, () => 'reserve'),
    });

    expect(play(state, content, 'reserve', 'caster').combatants['caster']?.stamina).toBe(100);
  });

  it('puts an exhausted ally back on their feet', () => {
    // A deliberate exception to "must rest for a turn" — it is what the card is
    // worth an energy for.
    const { state, content } = battle({
      combatants: [unit(), unit({ id: 'ally', stamina: 0, resting: true }), foe()],
      deck: Array.from({ length: 12 }, () => 'reserve'),
    });

    const after = play(state, content, 'reserve', 'ally');

    expect(after.combatants['ally']?.resting).toBe(false);
    expect(after.combatants['ally']?.stamina).toBe(40);
  });

  it('is not amplified by Fatigue, which only touches losses', () => {
    const { state, content } = battle({
      combatants: [
        unit({ stamina: 30, statuses: [{ kind: 'fatigue', stacks: 3, duration: { kind: 'untilRest' } }] }),
        foe(),
      ],
      deck: Array.from({ length: 12 }, () => 'reserve'),
    });

    // The 5 stamina cost is amplified to 9; the 40 restored is not touched.
    expect(play(state, content, 'reserve', 'caster').combatants['caster']?.stamina).toBe(61);
  });
});

// ── Vesper ──────────────────────────────────────────────────────────────────

describe('health as a cost', () => {
  it('pays a fraction of max health to strike', () => {
    const { state, content } = battle({
      combatants: [unit({ maxHealth: 200, health: 200 }), foe()],
      deck: Array.from({ length: 12 }, () => 'bloodlet'),
    });

    const after = play(state, content, 'bloodlet', 'foe');

    expect(after.combatants['caster']?.health).toBe(170);
    expect(after.combatants['foe']?.health).toBe(115);
  });

  it('is never lethal', () => {
    // Paying a cost should never be how you lose the game.
    const { state, content } = battle({
      combatants: [unit({ health: 5 }), foe()],
      deck: Array.from({ length: 12 }, () => 'bloodlet'),
    });

    const after = play(state, content, 'bloodlet', 'foe');

    expect(after.combatants['caster']?.health).toBe(1);
    expect(after.combatants['caster']?.downed).toBe(false);
  });

  it('does not drain stamina, since a cost is not damage', () => {
    const { state, content } = battle({
      combatants: [unit(), foe()],
      deck: Array.from({ length: 12 }, () => 'bloodlet'),
    });

    // Only the card's own 10 stamina.
    expect(play(state, content, 'bloodlet', 'foe').combatants['caster']?.stamina).toBe(90);
  });
});

describe('lifesteal', () => {
  it('heals for half the damage dealt', () => {
    const { state, content } = battle({
      combatants: [unit({ health: 100 }), foe()],
      deck: Array.from({ length: 12 }, () => 'siphon'),
    });

    const after = play(state, content, 'siphon', 'foe');

    expect(after.combatants['foe']?.health).toBe(140);
    expect(after.combatants['caster']?.health).toBe(130);
  });

  it('scales with the damage actually dealt, not the card power', () => {
    // Mitigation cuts the hit, so it should cut the healing too.
    const { state, content } = battle({
      combatants: [unit({ health: 100 }), foe({ defense: 50 })],
      deck: Array.from({ length: 12 }, () => 'siphon'),
    });

    const after = play(state, content, 'siphon', 'foe');
    const dealt = 200 - (after.combatants['foe']?.health ?? 0);

    expect(after.combatants['caster']?.health).toBe(100 + Math.round(dealt * 0.5));
  });

  it('heals nothing against an immune target', () => {
    const { state, content } = battle({
      combatants: [
        unit({ health: 100 }),
        foe({ statuses: [{ kind: 'immunity', stacks: 1, duration: { kind: 'untilNextTurn' } }] }),
      ],
      deck: Array.from({ length: 12 }, () => 'siphon'),
    });

    const after = play(state, content, 'siphon', 'foe');

    expect(after.combatants['foe']?.health).toBe(200);
    expect(after.combatants['caster']?.health).toBe(100);
  });

  it('never overheals', () => {
    const { state, content } = battle({
      combatants: [unit({ health: 200, maxHealth: 200 }), foe()],
      deck: Array.from({ length: 12 }, () => 'siphon'),
    });

    expect(play(state, content, 'siphon', 'foe').combatants['caster']?.health).toBe(200);
  });
});

// ── Undying ─────────────────────────────────────────────────────────────────

describe('undying', () => {
  it('heals when an enemy falls, while still alive', () => {
    const { state, content } = battle({
      combatants: [
        unit({ health: 40, statuses: [{ kind: 'undying', stacks: 1, duration: PERMANENT }] }),
        unit({ id: 'ally' }),
        foe({ health: 1 }),
      ],
      deck: Array.from({ length: 12 }, () => 'finisher'),
    });

    const after = play(state, content, 'finisher', 'foe');

    // 40 plus half of 200.
    expect(after.combatants['caster']?.health).toBe(40 + 200 * UNDYING_HEAL_FRACTION);
    expect(stacksOf(after.combatants['caster']?.statuses ?? [], 'undying')).toBe(0);
  });

  it('raises the holder if they were already down', () => {
    const { state, content } = battle({
      combatants: [
        unit({ health: 0, downed: true, statuses: [{ kind: 'undying', stacks: 1, duration: PERMANENT }] }),
        unit({ id: 'ally' }),
        foe({ health: 1 }),
      ],
      deck: Array.from({ length: 12 }, () => 'finisher'),
    });

    const after = play(state, content, 'finisher', 'foe');

    expect(after.combatants['caster']?.downed).toBe(false);
    expect(after.combatants['caster']?.health).toBe(100);
  });

  it('spends only one stack per enemy felled', () => {
    const { state, content } = battle({
      combatants: [
        unit({ health: 40, statuses: [{ kind: 'undying', stacks: 3, duration: PERMANENT }] }),
        unit({ id: 'ally' }),
        foe({ id: 'a', health: 1 }),
        foe({ id: 'b', health: 1 }),
      ],
      deck: Array.from({ length: 12 }, () => 'finisher'),
    });

    const after = play(state, content, 'finisher', 'a');
    expect(stacksOf(after.combatants['caster']?.statuses ?? [], 'undying')).toBe(2);
  });

  it('does nothing when the holder has no stacks', () => {
    const { state, content } = battle({
      combatants: [unit({ health: 40 }), unit({ id: 'ally' }), foe({ health: 1 })],
      deck: Array.from({ length: 12 }, () => 'finisher'),
    });

    expect(play(state, content, 'finisher', 'foe').combatants['caster']?.health).toBe(40);
  });

  it('cannot save the last ally standing', () => {
    // The known gap: the battle is decided the moment the last ally drops, so
    // no enemy is ever left to feed on. Pinned so it stays a known limitation
    // rather than becoming a surprise.
    const biter: EnemyAction[] = [
      { id: 'b', name: 'Bite', description: 'Bite one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'damage', power: 500 }] },
    ];

    const { state, content } = battle({
      combatants: [
        unit({ health: 10, maxHealth: 10, statuses: [{ kind: 'undying', stacks: 1, duration: PERMANENT }] }),
        foe({ attack: 400 }),
      ],
      enemyActions: { foe: biter },
    });

    const after = resolveEnemyTurn(endPlayerTurn(state, content), content);

    expect(after.phase).toBe('defeat');
    expect(after.combatants['caster']?.downed).toBe(true);
  });

  it('never exceeds max health when it heals', () => {
    const { state, content } = battle({
      combatants: [
        unit({ health: 190, statuses: [{ kind: 'undying', stacks: 1, duration: PERMANENT }] }),
        unit({ id: 'ally' }),
        foe({ health: 1 }),
      ],
      deck: Array.from({ length: 12 }, () => 'finisher'),
    });

    expect(play(state, content, 'finisher', 'foe').combatants['caster']?.health).toBe(200);
  });
});
