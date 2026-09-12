import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  selectCard,
  stepEnemyTurn,
} from '@/game/combat/engine';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
} from '@/game/combat/types';

/**
 * The enemy turn resolves one enemy per call so the UI can animate each attack.
 * These pin that stepping, and the event stream the arena animates from.
 */

function unit(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero',
    name: 'Hero',
    team: 'player',
    health: 500,
    maxHealth: 500,
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

const CARDS: Record<string, CardDefinition> = {
  strike: {
    id: 'strike',
    tier: 'basic',
    name: 'Strike',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 20 }],
  },
};

const BITE: EnemyAction[] = [
  {
    id: 'bite',
    name: 'Bite',
    description: 'Bite one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 30 }],
  },
];

function threeEnemyBattle() {
  const combatants = [
    unit(),
    unit({ id: 'e1', name: 'E1', team: 'enemy', speed: 1 }),
    unit({ id: 'e2', name: 'E2', team: 'enemy', speed: 1 }),
    unit({ id: 'e3', name: 'E3', team: 'enemy', speed: 1 }),
  ];

  const state = createCombat({
    combatants,
    deck: Array.from({ length: 12 }, () => 'strike'),
    seed: 5,
  });

  const content: CombatContent = {
    cardDefs: CARDS,
    enemyActions: { e1: BITE, e2: BITE, e3: BITE },
  };

  return { state, content };
}

function findInHand(state: CombatState, definitionId: string): string {
  const found = state.hand.find((id) => state.cards[id]?.definitionId === definitionId);
  if (!found) throw new Error('card not in hand: ' + definitionId);
  return found;
}

describe('endPlayerTurn', () => {
  it('queues the enemies instead of resolving them', () => {
    const { state, content } = threeEnemyBattle();
    const next = endPlayerTurn(state, content);

    expect(next.phase).toBe('enemyTurn');
    expect(next.enemyQueue).toEqual(['e1', 'e2', 'e3']);
    // Nothing has happened to the player yet.
    expect(next.combatants['hero']?.health).toBe(500);
  });

  it('leaves downed enemies out of the queue', () => {
    const combatants = [
      unit(),
      unit({ id: 'e1', name: 'E1', team: 'enemy', speed: 1 }),
      unit({ id: 'e2', name: 'E2', team: 'enemy', speed: 1, downed: true, health: 0 }),
    ];
    const state = createCombat({ combatants, deck: ['strike'], seed: 1 });
    const content: CombatContent = { cardDefs: CARDS, enemyActions: { e1: BITE, e2: BITE } };

    expect(endPlayerTurn(state, content).enemyQueue).toEqual(['e1']);
  });
});

describe('stepEnemyTurn', () => {
  it('resolves exactly one enemy per call', () => {
    const { state, content } = threeEnemyBattle();
    let current = endPlayerTurn(state, content);

    const healthAfter: number[] = [];
    for (let i = 0; i < 3; i++) {
      current = stepEnemyTurn(current, content);
      healthAfter.push(current.combatants['hero']?.health ?? 0);
    }

    // Three strictly decreasing values — one bite each, not all at once.
    expect(healthAfter[0]).toBeLessThan(500);
    expect(healthAfter[1]).toBeLessThan(healthAfter[0] ?? 0);
    expect(healthAfter[2]).toBeLessThan(healthAfter[1] ?? 0);
  });

  it('shortens the queue by one each step', () => {
    const { state, content } = threeEnemyBattle();
    let current = endPlayerTurn(state, content);

    expect(current.enemyQueue).toHaveLength(3);
    current = stepEnemyTurn(current, content);
    expect(current.enemyQueue).toHaveLength(2);
    current = stepEnemyTurn(current, content);
    expect(current.enemyQueue).toHaveLength(1);
  });

  it('hands the turn back once the queue empties', () => {
    const { state, content } = threeEnemyBattle();
    let current = endPlayerTurn(state, content);

    for (let i = 0; i < 3; i++) current = stepEnemyTurn(current, content);

    expect(current.phase).toBe('selectCard');
    expect(current.activeTeam).toBe('player');
    expect(current.energy).toBe(current.maxEnergy);
    expect(current.round).toBe(2);
    expect(current.enemyQueue).toEqual([]);
  });

  it('is a no-op outside the enemy turn', () => {
    const { state, content } = threeEnemyBattle();
    expect(stepEnemyTurn(state, content)).toBe(state);
  });

  it('does not mutate the state it was given', () => {
    const { state, content } = threeEnemyBattle();
    const queued = endPlayerTurn(state, content);
    const before = queued.combatants['hero']?.health;

    stepEnemyTurn(queued, content);

    expect(queued.combatants['hero']?.health).toBe(before);
    expect(queued.enemyQueue).toHaveLength(3);
  });

  it('reaches the same outcome as resolving in one go', () => {
    // Stepping must not change the rules, only their pacing.
    const a = threeEnemyBattle();
    const b = threeEnemyBattle();

    let stepped = endPlayerTurn(a.state, a.content);
    while (stepped.phase === 'enemyTurn') stepped = stepEnemyTurn(stepped, a.content);

    const atOnce = resolveEnemyTurn(endPlayerTurn(b.state, b.content), b.content);

    expect(stepped.combatants['hero']?.health).toBe(atOnce.combatants['hero']?.health);
    expect(stepped.seed).toBe(atOnce.seed);
    expect(stepped.round).toBe(atOnce.round);
  });

  it('stops stepping once the battle is decided', () => {
    const combatants = [
      unit({ health: 10, maxHealth: 10 }),
      unit({ id: 'e1', name: 'E1', team: 'enemy', speed: 1, attack: 1000 }),
      unit({ id: 'e2', name: 'E2', team: 'enemy', speed: 1, attack: 1000 }),
    ];
    const state = createCombat({ combatants, deck: ['strike'], seed: 1 });
    const content: CombatContent = { cardDefs: CARDS, enemyActions: { e1: BITE, e2: BITE } };

    const after = stepEnemyTurn(endPlayerTurn(state, content), content);
    expect(after.phase).toBe('defeat');
  });
});

describe('events', () => {
  it('records who attacked whom', () => {
    const { state, content } = threeEnemyBattle();
    const played = chooseTarget(
      selectCard(state, content, findInHand(state, 'strike')),
      content,
      'e1'
    );

    expect(played.events).toContainEqual({
      type: 'attack',
      sourceId: 'hero',
      targetId: 'e1',
      damage: 20,
      bleed: false,
    });
  });

  it('clears events on the next transition', () => {
    // Events describe only the step just taken. Carrying them forward would
    // make the arena replay the same hit on every subsequent update.
    const { state, content } = threeEnemyBattle();
    const played = chooseTarget(
      selectCard(state, content, findInHand(state, 'strike')),
      content,
      'e1'
    );
    expect(played.events.length).toBeGreaterThan(0);

    const queued = endPlayerTurn(played, content);
    expect(queued.events).toEqual([]);
  });

  it('emits one attack per enemy step, not three at once', () => {
    const { state, content } = threeEnemyBattle();
    let current = endPlayerTurn(state, content);

    for (let i = 0; i < 3; i++) {
      current = stepEnemyTurn(current, content);
      const attacks = current.events.filter((event) => event.type === 'attack');
      expect(attacks).toHaveLength(1);
    }
  });

  it('marks a downed combatant', () => {
    const combatants = [unit(), unit({ id: 'e1', name: 'E1', team: 'enemy', speed: 1, health: 1 })];
    const state = createCombat({
      combatants,
      deck: Array.from({ length: 6 }, () => 'strike'),
      seed: 1,
    });
    const content: CombatContent = { cardDefs: CARDS, enemyActions: { e1: BITE } };

    const played = chooseTarget(
      selectCard(state, content, findInHand(state, 'strike')),
      content,
      'e1'
    );

    expect(played.events).toContainEqual({ type: 'downed', targetId: 'e1' });
  });
});
