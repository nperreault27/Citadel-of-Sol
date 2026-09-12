import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  selectCard,
} from '@/game/combat/engine';
import { effectiveDefense, mitigation } from '@/game/combat/stats';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from '@/game/combat/types';

const PERMANENT: StatusDuration = { kind: 'permanent' };
const POISON_2: StatusDuration = { kind: 'turns', remaining: 2 };

function unit(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'thane',
    name: 'Thane',
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
  ward: {
    id: 'ward',
    tier: 'basic',
    name: 'Ward',
    description: '',
    brief: '',
    ownerId: 'thane',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneAlly',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.25 }],
  },
  cover: {
    id: 'cover',
    tier: 'basic',
    name: 'Cover',
    description: '',
    brief: '',
    ownerId: 'thane',
    energyCost: 2,
    staminaCost: 10,
    target: 'allAllies',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.45, split: true }],
  },
  brace: {
    id: 'brace',
    tier: 'basic',
    name: 'Brace',
    description: '',
    brief: '',
    ownerId: 'thane',
    energyCost: 0,
    staminaCost: 10,
    target: 'oneAlly',
    effects: [{ type: 'status', kind: 'defenseUp', stacks: 1, duration: PERMANENT }],
  },
};

const BITE: EnemyAction[] = [
  { id: 'bite', name: 'Bite', description: 'Bite one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'damage', power: 50 }] },
];

function battle(options: {
  combatants?: Combatant[];
  deck?: string[];
  enemyActions?: Record<string, EnemyAction[]>;
}) {
  const combatants = options.combatants ?? [unit(), foe()];
  const state = createCombat({
    combatants,
    deck: options.deck ?? Array.from({ length: 12 }, () => 'ward'),
    seed: 42,
  });

  const enemyActions: Record<string, EnemyAction[]> = options.enemyActions ?? {};
  for (const c of combatants) {
    if (c.team === 'enemy' && !enemyActions[c.id]) enemyActions[c.id] = [];
  }

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

function passTurn(state: CombatState, content: CombatContent): CombatState {
  return resolveEnemyTurn(endPlayerTurn(state, content), content);
}

// ── Granting shields ────────────────────────────────────────────────────────

describe('granting a shield', () => {
  it('sizes the shield from the caster, not the target', () => {
    // The same 50 whoever receives it: Thane's bulk is the resource.
    const { state, content } = battle({
      combatants: [unit({ maxHealth: 200 }), unit({ id: 'small', maxHealth: 80 }), foe()],
    });

    const after = play(state, content, 'ward', 'small');
    expect(after.combatants['small']?.shield).toBe(50);
  });

  it('splits the pool between living allies', () => {
    const { state, content } = battle({
      combatants: [unit(), unit({ id: 'a' }), unit({ id: 'b' }), foe()],
      deck: Array.from({ length: 12 }, () => 'cover'),
    });

    // 45% of 200 is 90, split three ways.
    const after = play(state, content, 'cover');
    expect(after.combatants['thane']?.shield).toBe(30);
    expect(after.combatants['a']?.shield).toBe(30);
    expect(after.combatants['b']?.shield).toBe(30);
  });

  it('gives a lone survivor the whole pool', () => {
    const { state, content } = battle({
      combatants: [unit(), foe()],
      deck: Array.from({ length: 12 }, () => 'cover'),
    });

    expect(play(state, content, 'cover').combatants['thane']?.shield).toBe(90);
  });

  it('refreshes rather than stacking', () => {
    const { state, content } = battle({
      combatants: [unit(), unit({ id: 'a' }), foe()],
    });

    let current = play(state, content, 'ward', 'a');
    current = play(current, content, 'ward', 'a');

    expect(current.combatants['a']?.shield).toBe(50);
  });

  it('never downgrades an existing larger shield', () => {
    const { state, content } = battle({
      combatants: [unit(), unit({ id: 'a', shield: 80 }), foe()],
    });

    expect(play(state, content, 'ward', 'a').combatants['a']?.shield).toBe(80);
  });

  it('skips a downed ally', () => {
    const { state, content } = battle({
      combatants: [unit(), unit({ id: 'a' }), unit({ id: 'b', downed: true, health: 0 }), foe()],
      deck: Array.from({ length: 12 }, () => 'cover'),
    });

    const after = play(state, content, 'cover');
    expect(after.combatants['b']?.shield).toBe(0);
    // And the pool splits between the two who are actually standing.
    expect(after.combatants['a']?.shield).toBe(45);
  });
});

// ── Absorbing damage ────────────────────────────────────────────────────────

describe('absorbing damage', () => {
  it('takes the hit instead of health', () => {
    const { state, content } = battle({
      combatants: [unit({ shield: 100 }), foe()],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    expect(after.combatants['thane']?.health).toBe(200);
    expect(after.combatants['thane']?.shield).toBe(50);
  });

  it('lets the overflow through to health', () => {
    const { state, content } = battle({
      combatants: [unit({ shield: 20 }), foe()],
      enemyActions: { foe: BITE },
    });

    // A 50 hit against a 20 shield: 20 absorbed, 30 reaches health.
    const after = passTurn(state, content);

    expect(after.combatants['thane']?.shield).toBe(0);
    expect(after.combatants['thane']?.health).toBe(170);
  });

  it('protects stamina as well as health', () => {
    // A blocked blow does not tire you — the damage never reaches you at all.
    const { state, content } = battle({
      combatants: [unit({ shield: 100 }), foe()],
      enemyActions: { foe: BITE },
    });

    expect(passTurn(state, content).combatants['thane']?.stamina).toBe(100);
  });

  it('drains stamina only for the overflow', () => {
    const shielded = battle({
      combatants: [unit({ shield: 30 }), foe()],
      enemyActions: { foe: BITE },
    });
    const bare = battle({
      combatants: [unit(), foe()],
      enemyActions: { foe: BITE },
    });

    const withShield = 100 - (passTurn(shielded.state, shielded.content).combatants['thane']?.stamina ?? 0);
    const without = 100 - (passTurn(bare.state, bare.content).combatants['thane']?.stamina ?? 0);

    expect(withShield).toBeGreaterThan(0);
    expect(withShield).toBeLessThan(without);
  });

  it('is bypassed by poison', () => {
    // The counter to shielding: damage over time eats health directly, however
    // much protection is stacked up.
    const { state, content } = battle({
      combatants: [
        unit({ shield: 500, statuses: [{ kind: 'poison', stacks: 2, duration: POISON_2 }] }),
        foe(),
      ],
    });

    const after = passTurn(state, content);

    expect(after.combatants['thane']?.shield).toBe(500);
    // 2 stacks at 5% of 200.
    expect(after.combatants['thane']?.health).toBe(180);
  });

  it('absorbs a bleed-doubled hit at its doubled size', () => {
    // Bleed doubles the damage first; the shield then eats the bigger number.
    const { state, content } = battle({
      combatants: [
        unit({ shield: 200, statuses: [{ kind: 'bleed', stacks: 1, duration: PERMANENT }] }),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    expect(after.combatants['thane']?.health).toBe(200);
    expect(after.combatants['thane']?.shield).toBe(100);
  });

  it('cannot stop a hit once it is spent', () => {
    const { state, content } = battle({
      combatants: [unit({ shield: 10 }), foe()],
      enemyActions: { foe: BITE },
    });

    let current = passTurn(state, content);
    expect(current.combatants['thane']?.shield).toBe(0);

    const before = current.combatants['thane']?.health ?? 0;
    current = passTurn(current, content);

    expect(current.combatants['thane']!.health).toBeLessThan(before);
  });

  it('persists across turns until something breaks it', () => {
    const { state, content } = battle({ combatants: [unit({ shield: 60 }), foe()] });

    let current = state;
    for (let i = 0; i < 4; i++) current = passTurn(current, content);

    expect(current.combatants['thane']?.shield).toBe(60);
  });
});

// ── Defense Up ──────────────────────────────────────────────────────────────

describe('defense up', () => {
  it('compounds like Strength', () => {
    const base = unit({ defense: 50 });

    expect(effectiveDefense(base)).toBe(50);
    expect(
      effectiveDefense(unit({ defense: 50, statuses: [{ kind: 'defenseUp', stacks: 1, duration: PERMANENT }] }))
    ).toBeCloseTo(65, 6);
    expect(
      effectiveDefense(unit({ defense: 50, statuses: [{ kind: 'defenseUp', stacks: 2, duration: PERMANENT }] }))
    ).toBeCloseTo(84.5, 6);
  });

  it('reduces incoming damage through the mitigation curve', () => {
    const plain = battle({ combatants: [unit({ defense: 50 }), foe()], enemyActions: { foe: BITE } });
    const braced = battle({
      combatants: [
        unit({ defense: 50, statuses: [{ kind: 'defenseUp', stacks: 2, duration: PERMANENT }] }),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const tookPlain = 200 - (passTurn(plain.state, plain.content).combatants['thane']?.health ?? 0);
    const tookBraced = 200 - (passTurn(braced.state, braced.content).combatants['thane']?.health ?? 0);

    expect(tookBraced).toBeLessThan(tookPlain);
  });

  it('has diminishing returns, because mitigation already curves', () => {
    // Worth flagging: the raw stat goes up 30% but the damage reduction is far
    // smaller, and smaller still on an already-tanky character.
    const oneStack = mitigation(effectiveDefense(unit({ defense: 50, statuses: [{ kind: 'defenseUp', stacks: 1, duration: PERMANENT }] })));
    const bare = mitigation(50);

    const reduction = 1 - oneStack / bare;
    expect(reduction).toBeGreaterThan(0.1);
    expect(reduction).toBeLessThan(0.3);
  });

  it('does not touch Attack', () => {
    const { state, content } = battle({
      combatants: [unit({ statuses: [{ kind: 'defenseUp', stacks: 3, duration: PERMANENT }] }), foe()],
      deck: Array.from({ length: 12 }, () => 'brace'),
    });

    // Applying Brace should change nothing about what Thane hits for.
    const after = play(state, content, 'brace', 'thane');
    expect(after.combatants['foe']?.health).toBe(200);
  });

  it('applies through the card', () => {
    const { state, content } = battle({
      combatants: [unit(), unit({ id: 'a' }), foe()],
      deck: Array.from({ length: 12 }, () => 'brace'),
    });

    const after = play(state, content, 'brace', 'a');
    expect(after.combatants['a']?.statuses.some((e) => e.kind === 'defenseUp')).toBe(true);
  });
});
