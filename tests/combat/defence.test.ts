import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  selectCard,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import { COUNTER_ATTACK_POWER } from '@/game/combat/stats';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from '@/game/combat/types';

const PERMANENT: StatusDuration = { kind: 'permanent' };
const PER_TURN_STACK: StatusDuration = { kind: 'perTurnStack' };
const UNTIL_NEXT_TURN: StatusDuration = { kind: 'untilNextTurn' };
const POISON_2: StatusDuration = { kind: 'turns', remaining: 2 };

function unit(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'tank',
    name: 'Tank',
    team: 'player',
    health: 400,
    maxHealth: 400,
    stamina: 120,
    maxStamina: 120,
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

function ally(overrides: Partial<Combatant> = {}): Combatant {
  return unit({ id: 'ally', name: 'Ally', ...overrides });
}

function foe(overrides: Partial<Combatant> = {}): Combatant {
  return unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1, ...overrides });
}

const CARDS: Record<string, CardDefinition> = {
  goad: {
    id: 'goad',
    tier: 'basic',
    name: 'Goad',
    description: '',
    brief: '',
    ownerId: 'tank',
    energyCost: 1,
    staminaCost: 10,
    target: 'self',
    effects: [{ type: 'status', kind: 'taunt', stacks: 1, duration: PER_TURN_STACK }],
  },
  rebound: {
    id: 'rebound',
    tier: 'basic',
    name: 'Rebound',
    description: '',
    brief: '',
    ownerId: 'tank',
    energyCost: 1,
    staminaCost: 10,
    target: 'self',
    effects: [{ type: 'status', kind: 'counter', stacks: 3, duration: PERMANENT }],
  },
  ironclad: {
    id: 'ironclad',
    tier: 'basic',
    name: 'Ironclad',
    description: '',
    brief: '',
    ownerId: 'tank',
    energyCost: 3,
    staminaCost: 10,
    target: 'self',
    effects: [{ type: 'status', kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN }],
  },
  strike: {
    id: 'strike',
    tier: 'basic',
    name: 'Strike',
    description: '',
    brief: '',
    ownerId: 'tank',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 50 }],
  },
  hex: {
    id: 'hex',
    tier: 'basic',
    name: 'Hex',
    description: '',
    brief: '',
    ownerId: 'tank',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'weakness', stacks: 1, duration: PERMANENT }],
  },
};

const BITE: EnemyAction[] = [
  { id: 'bite', name: 'Bite', description: 'Bite one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'damage', power: 50 }] },
];

const SWEEP: EnemyAction[] = [
  { id: 'sweep', name: 'Sweep', description: 'Claw your whole party.', weight: 1, target: 'allEnemies', effects: [{ type: 'damage', power: 50 }] },
];

const JINX: EnemyAction[] = [
  {
    id: 'jinx',
    name: 'Jinx',
    description: 'Apply 1 Weakness to one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'weakness', stacks: 1, duration: PERMANENT }],
  },
];

function battle(options: {
  combatants?: Combatant[];
  deck?: string[];
  enemyActions?: Record<string, EnemyAction[]>;
}) {
  const combatants = options.combatants ?? [unit(), foe()];
  const state = createCombat({
    combatants,
    deck: options.deck ?? Array.from({ length: 12 }, () => 'strike'),
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

// ── Taunt ───────────────────────────────────────────────────────────────────

describe('taunt', () => {
  it('redirects a single-target enemy attack onto the taunter', () => {
    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'taunt', stacks: 2, duration: PER_TURN_STACK }] }),
        ally(),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    expect(after.combatants['ally']?.health).toBe(400);
    expect(after.combatants['tank']!.health).toBeLessThan(400);
  });

  it('is bypassed by an area attack', () => {
    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'taunt', stacks: 2, duration: PER_TURN_STACK }] }),
        ally(),
        foe(),
      ],
      enemyActions: { foe: SWEEP },
    });

    const after = passTurn(state, content);
    expect(after.combatants['ally']!.health).toBeLessThan(400);
  });

  it('draws blows but not curses', () => {
    // "Main target for an attack" — a debuff is not an attack, so Jinx still
    // picks its own target.
    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'taunt', stacks: 2, duration: PER_TURN_STACK }] }),
        ally(),
        foe(),
      ],
      enemyActions: { foe: JINX },
    });

    const after = passTurn(state, content);
    const weakened =
      stacksOf(after.combatants['tank']?.statuses ?? [], 'weakness') +
      stacksOf(after.combatants['ally']?.statuses ?? [], 'weakness');

    expect(weakened).toBe(1);
  });

  it('loses one stack per turn', () => {
    const { state, content } = battle({
      combatants: [unit({ statuses: [{ kind: 'taunt', stacks: 2, duration: PER_TURN_STACK }] }), foe()],
    });

    const one = passTurn(state, content);
    expect(stacksOf(one.combatants['tank']?.statuses ?? [], 'taunt')).toBe(1);

    const two = passTurn(one, content);
    expect(stacksOf(two.combatants['tank']?.statuses ?? [], 'taunt')).toBe(0);
  });

  it('is still up while the enemies choose their targets', () => {
    // Goad is played on the player's turn and is only a taunt if it survives the
    // player's own end of turn — otherwise it expires before anyone can be drawn
    // onto the tank, which is the whole card.
    const { state, content } = battle({
      combatants: [unit(), ally(), foe()],
      deck: Array.from({ length: 12 }, () => 'goad'),
      enemyActions: { foe: BITE },
    });

    const queued = endPlayerTurn(play(state, content, 'goad'), content);
    expect(stacksOf(queued.combatants['tank']?.statuses ?? [], 'taunt')).toBe(1);

    const after = resolveEnemyTurn(queued, content);
    expect(after.combatants['ally']?.health).toBe(400);
    expect(after.combatants['tank']?.health).toBeLessThan(400);
    // One stack bought exactly one enemy turn, and is gone as it closes.
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'taunt')).toBe(0);
  });

  it('stacks up when applied repeatedly', () => {
    const { state, content } = battle({
      deck: Array.from({ length: 12 }, () => 'goad'),
    });

    let current = play(state, content, 'goad');
    current = play(current, content, 'goad');

    expect(stacksOf(current.combatants['tank']?.statuses ?? [], 'taunt')).toBe(2);
  });

  it('makes the player hit a taunting enemy instead of their chosen target', () => {
    // Symmetric by design — the rule is about attacks, not about which side.
    const { state, content } = battle({
      combatants: [
        unit(),
        foe({ id: 'a', statuses: [{ kind: 'taunt', stacks: 1, duration: PER_TURN_STACK }] }),
        foe({ id: 'b' }),
      ],
    });

    const after = play(state, content, 'strike', 'b');

    expect(after.combatants['b']?.health).toBe(400);
    expect(after.combatants['a']!.health).toBeLessThan(400);
  });

  it('does not redirect a debuff aimed at a specific enemy', () => {
    const { state, content } = battle({
      combatants: [
        unit(),
        foe({ id: 'a', statuses: [{ kind: 'taunt', stacks: 1, duration: PER_TURN_STACK }] }),
        foe({ id: 'b' }),
      ],
      deck: Array.from({ length: 12 }, () => 'hex'),
    });

    const after = play(state, content, 'hex', 'b');
    expect(stacksOf(after.combatants['b']?.statuses ?? [], 'weakness')).toBe(1);
  });

  it('is ignored once the taunter is down', () => {
    const { state, content } = battle({
      combatants: [
        unit({ downed: true, health: 0, statuses: [{ kind: 'taunt', stacks: 3, duration: PER_TURN_STACK }] }),
        ally(),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);
    expect(after.combatants['ally']!.health).toBeLessThan(400);
  });
});

// ── Counter Attack ──────────────────────────────────────────────────────────

describe('counter attack', () => {
  it('strikes back and spends a stack', () => {
    const { state, content } = battle({
      combatants: [unit({ statuses: [{ kind: 'counter', stacks: 3, duration: PERMANENT }] }), foe()],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    expect(after.combatants['foe']!.health).toBeLessThan(400);
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'counter')).toBe(2);
  });

  it('fires at the counter power, scaled by the defender Attack', () => {
    const { state, content } = battle({
      combatants: [unit({ statuses: [{ kind: 'counter', stacks: 1, duration: PERMANENT }] }), foe()],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);
    // 100 attack x COUNTER_ATTACK_POWER%, no mitigation.
    expect(400 - (after.combatants['foe']?.health ?? 0)).toBe(COUNTER_ATTACK_POWER);
  });

  it('triggers on an area attack too', () => {
    const { state, content } = battle({
      combatants: [unit({ statuses: [{ kind: 'counter', stacks: 1, duration: PERMANENT }] }), foe()],
      enemyActions: { foe: SWEEP },
    });

    const after = passTurn(state, content);
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'counter')).toBe(0);
    expect(after.combatants['foe']!.health).toBeLessThan(400);
  });

  it('never chains, even when both sides hold stacks', () => {
    // The whole reason for the recursion guard: without it, two counter-holders
    // volley until a stack runs out — or forever if either could regain one.
    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'counter', stacks: 5, duration: PERMANENT }] }),
        foe({ statuses: [{ kind: 'counter', stacks: 5, duration: PERMANENT }] }),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    // The bite spends one of the tank's stacks; the tank's counter must not
    // spend one of the enemy's.
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'counter')).toBe(4);
    expect(stacksOf(after.combatants['foe']?.statuses ?? [], 'counter')).toBe(5);
  });

  it('does nothing with no stacks left', () => {
    const { state, content } = battle({
      combatants: [unit(), foe()],
      enemyActions: { foe: BITE },
    });

    expect(passTurn(state, content).combatants['foe']?.health).toBe(400);
  });

  it('does not fire if the hit downs the defender', () => {
    const { state, content } = battle({
      combatants: [
        unit({ health: 1, maxHealth: 1, statuses: [{ kind: 'counter', stacks: 3, duration: PERMANENT }] }),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);
    expect(after.combatants['tank']?.downed).toBe(true);
    expect(after.combatants['foe']?.health).toBe(400);
  });

  it('has no timer — it waits for an attack', () => {
    const { state, content } = battle({
      combatants: [unit({ statuses: [{ kind: 'counter', stacks: 2, duration: PERMANENT }] }), foe()],
    });

    let current = state;
    for (let i = 0; i < 4; i++) current = passTurn(current, content);

    expect(stacksOf(current.combatants['tank']?.statuses ?? [], 'counter')).toBe(2);
  });
});

// ── Immunity ────────────────────────────────────────────────────────────────

describe('immunity', () => {
  it('blocks all damage and the stamina it would drain', () => {
    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN }] }),
        foe({ attack: 400 }),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    expect(after.combatants['tank']?.health).toBe(400);
    expect(after.combatants['tank']?.stamina).toBe(120);
  });

  it('blocks poison ticks', () => {
    const { state, content } = battle({
      combatants: [
        unit({
          statuses: [
            { kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN },
            { kind: 'poison', stacks: 3, duration: POISON_2 },
          ],
        }),
        foe(),
      ],
    });

    expect(passTurn(state, content).combatants['tank']?.health).toBe(400);
  });

  it('still lets debuffs land', () => {
    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN }] }),
        foe(),
      ],
      enemyActions: { foe: JINX },
    });

    const after = passTurn(state, content);
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'weakness')).toBe(1);
  });

  it('still triggers a counter attack', () => {
    const { state, content } = battle({
      combatants: [
        unit({
          statuses: [
            { kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN },
            { kind: 'counter', stacks: 2, duration: PERMANENT },
          ],
        }),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);

    expect(after.combatants['tank']?.health).toBe(400);
    expect(after.combatants['foe']!.health).toBeLessThan(400);
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'counter')).toBe(1);
  });

  it('still spends a bleed stack on a blocked attack', () => {
    const { state, content } = battle({
      combatants: [
        unit({
          statuses: [
            { kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN },
            { kind: 'bleed', stacks: 2, duration: PERMANENT },
          ],
        }),
        foe(),
      ],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(state, content);
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'bleed')).toBe(1);
  });

  it('does not stop a direct stamina drain', () => {
    const drainer: EnemyAction[] = [
      { id: 'sap', name: 'Sap', description: 'Drain the stamina of one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'drainStamina', amount: 40 }] },
    ];

    const { state, content } = battle({
      combatants: [
        unit({ statuses: [{ kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN }] }),
        foe(),
      ],
      enemyActions: { foe: drainer },
    });

    expect(passTurn(state, content).combatants['tank']?.stamina).toBe(80);
  });

  it('survives its own end-of-turn tick to cover the enemy turn', () => {
    const { state, content } = battle({
      deck: Array.from({ length: 12 }, () => 'ironclad'),
      combatants: [unit(), foe({ attack: 400 })],
      enemyActions: { foe: BITE },
    });

    const shielded = play(state, content, 'ironclad');
    const queued = endPlayerTurn(shielded, content);

    // Still up as the enemy begins to act — this is the case a plain 1-turn
    // countdown would get wrong, expiring before it ever did anything.
    expect(stacksOf(queued.combatants['tank']?.statuses ?? [], 'immunity')).toBe(1);

    const after = resolveEnemyTurn(queued, content);
    expect(after.combatants['tank']?.health).toBe(400);
  });

  it('is gone by the start of the next player turn', () => {
    const { state, content } = battle({
      deck: Array.from({ length: 12 }, () => 'ironclad'),
      combatants: [unit(), foe({ attack: 400 })],
      enemyActions: { foe: BITE },
    });

    const after = passTurn(play(state, content, 'ironclad'), content);
    expect(stacksOf(after.combatants['tank']?.statuses ?? [], 'immunity')).toBe(0);
  });

  it('protects for exactly one enemy turn', () => {
    const { state, content } = battle({
      deck: Array.from({ length: 12 }, () => 'ironclad'),
      combatants: [unit(), foe({ attack: 400 })],
      enemyActions: { foe: BITE },
    });

    const first = passTurn(play(state, content, 'ironclad'), content);
    expect(first.combatants['tank']?.health).toBe(400);

    const second = passTurn(first, content);
    expect(second.combatants['tank']!.health).toBeLessThan(400);
  });
});
