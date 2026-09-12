import { describe, expect, it } from 'vitest';
import {
  createCombat,
  endPlayerTurn,
  enemyStaminaCost,
  resolveEnemyTurn,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
} from '@/game/combat/types';

/**
 * How enemies spend a turn: what they can aim at, and what it costs them.
 *
 * These cover the three things that were quietly wrong — an enemy could not
 * target itself, supporting cost it nothing, and winning initiative cost it a
 * turn — each of which looked like it worked from the outside.
 */

const PERMANENT = { kind: 'permanent' } as const;

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
    speed: 10,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

const CARDS: Record<string, CardDefinition> = {
  wait: {
    id: 'wait',
    tier: 'basic',
    name: 'Wait',
    description: 'Do nothing.',
    brief: 'Nothing',
    ownerId: null,
    energyCost: 0,
    staminaCost: 0,
    target: 'none',
    effects: [],
  },
};

function battle(combatants: Combatant[], actions: Record<string, EnemyAction[]>) {
  const state = createCombat({
    combatants,
    deck: Array.from({ length: 10 }, () => 'wait'),
    seed: 1,
  });
  const content: CombatContent = { cardDefs: CARDS, enemyActions: actions };
  return { state, content };
}

/** One full enemy turn, however initiative fell. */
function oneEnemyTurn(state: CombatState, content: CombatContent): CombatState {
  const opened = state.activeTeam === 'player' ? endPlayerTurn(state, content) : state;
  return resolveEnemyTurn(opened, content);
}

describe('an enemy targeting itself', () => {
  const GUARD: EnemyAction = {
    id: 'foe.guard',
    name: 'Guard',
    description: 'The enemy gains 1 Defense Up.',
    weight: 1,
    target: 'self',
    effects: [{ type: 'status', kind: 'defenseUp', stacks: 1, duration: PERMANENT }],
  };

  it('applies the status to the enemy that acted', () => {
    const foe = { ...unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1 }), archetype: 'foe' };
    const { state, content } = battle([unit(), foe], { foe: [GUARD] });

    const after = oneEnemyTurn(state, content);

    expect(stacksOf(after.combatants['foe']!.statuses, 'defenseUp')).toBe(1);
  });

  it('does not put the buff on the player instead', () => {
    const foe = { ...unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1 }), archetype: 'foe' };
    const { state, content } = battle([unit(), foe], { foe: [GUARD] });

    const after = oneEnemyTurn(state, content);

    expect(after.combatants['hero']!.statuses).toHaveLength(0);
  });

  it('picks the acting enemy, not whichever one it happens to find', () => {
    // Two enemies with the same move: each must buff itself, so after a turn in
    // which both act they hold one stack each rather than one holding two.
    const one = { ...unit({ id: 'a', name: 'A', team: 'enemy', speed: 1 }), archetype: 'foe' };
    const two = { ...unit({ id: 'b', name: 'B', team: 'enemy', speed: 1 }), archetype: 'foe' };
    const { state, content } = battle([unit(), one, two], { foe: [GUARD] });

    const after = oneEnemyTurn(state, content);

    expect(stacksOf(after.combatants['a']!.statuses, 'defenseUp')).toBe(1);
    expect(stacksOf(after.combatants['b']!.statuses, 'defenseUp')).toBe(1);
  });
});

describe('what an enemy action costs', () => {
  it('prices an attack off its power', () => {
    const smash: EnemyAction = {
      id: 'foe.smash',
      name: 'Smash',
      description: 'Hit hard.',
      weight: 1,
      target: 'oneEnemy',
      effects: [{ type: 'damage', power: 92 }],
    };

    // The Ogre's Smash, at its real power: three of them and it is winded.
    expect(enemyStaminaCost(smash)).toBe(20);
  });

  it('charges a support move rather than letting it be free', () => {
    const hymn: EnemyAction = {
      id: 'foe.hymn',
      name: 'Hymn',
      description: 'Shield the team.',
      weight: 1,
      target: 'allAllies',
      effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.3 }],
    };

    // The point is only that it is not zero: a support enemy that never tires
    // can never be worn down, which would make it immune to the whole stamina
    // axis of the game by accident.
    expect(enemyStaminaCost(hymn)).toBeGreaterThan(0);
  });

  it('actually drains a support-only enemy over a fight', () => {
    const hymn: EnemyAction = {
      id: 'foe.hymn',
      name: 'Hymn',
      description: 'Shield the team.',
      weight: 1,
      target: 'allAllies',
      effects: [{ type: 'status', kind: 'strength', stacks: 1, duration: PERMANENT }],
    };

    const foe = {
      ...unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1 }),
      archetype: 'foe',
    };
    const { state, content } = battle([unit(), foe], { foe: [hymn] });

    const after = oneEnemyTurn(state, content);

    expect(after.combatants['foe']!.stamina).toBeLessThan(foe.maxStamina);
  });

  it('prices a chain off one hit, since the rest is a roll', () => {
    const arc: EnemyAction = {
      id: 'foe.arc',
      name: 'Arc',
      description: 'Chain lightning.',
      weight: 1,
      target: 'oneEnemy',
      effects: [
        { type: 'chainDamage', power: 46, continueChance: 0.8, redirectChance: 0.85, maxHits: 50 },
      ],
    };

    // A cost that scaled with the roll could not be printed on the move sheet
    // before the move was made.
    expect(enemyStaminaCost(arc)).toBe(10);
  });
});

describe('initiative', () => {
  const BITE: EnemyAction = {
    id: 'foe.bite',
    name: 'Bite',
    description: 'Bite one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60 }],
  };

  it('lets the faster enemy team act before the player does', () => {
    const foe = {
      ...unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 99 }),
      archetype: 'foe',
    };
    const { state, content } = battle([unit({ speed: 1 }), foe], { foe: [BITE] });

    expect(state.activeTeam).toBe('enemy');

    // Winning initiative has to mean acting, not merely being named first. The
    // queue is what `stepEnemyTurn` consumes, and an empty one would hand the
    // turn straight back with nothing done.
    const after = resolveEnemyTurn(state, content);
    expect(after.combatants['hero']!.health).toBeLessThan(400);
  });

  it('still opens on the player when the party is faster', () => {
    const foe = {
      ...unit({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1 }),
      archetype: 'foe',
    };
    const { state } = battle([unit({ speed: 99 }), foe], { foe: [BITE] });

    expect(state.activeTeam).toBe('player');
    expect(state.phase).toBe('selectCard');
    expect(state.combatants['hero']!.health).toBe(400);
  });
});
