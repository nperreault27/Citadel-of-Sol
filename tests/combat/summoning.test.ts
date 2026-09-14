import { describe, expect, it } from 'vitest';
import { createCombat, resolveEnemyTurn, endPlayerTurn, canAct } from '@/game/combat/engine';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
} from '@/game/combat/types';

/**
 * Summoning: enemies that put more enemies on the board mid-fight.
 *
 * The rules under test are the three that make the Broodmother a fight rather
 * than an arithmetic problem — the cap, the turn of grace, and the brood
 * collapsing with its summoner — plus the determinism the balance probe rests
 * on.
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
    defense: 30,
    speed: 1,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

const MINION: Combatant = {
  ...unit({ id: 'minion', name: 'Minion', team: 'enemy' }),
  archetype: 'minion',
  health: 40,
  maxHealth: 40,
  attack: 90,
  defense: 5,
  speed: 20,
};

const SUMMONER: Combatant = {
  ...unit({ id: 'boss', name: 'Boss', team: 'enemy' }),
  archetype: 'boss',
  health: 300,
  maxHealth: 300,
  // High enough that summoning never benches it mid-test.
  stamina: 900,
  maxStamina: 900,
  attack: 40,
  speed: 2,
};

const CALL: EnemyAction = {
  id: 'boss.call',
  name: 'Call',
  description: 'Call in 2 Minions.',
  weight: 1,
  target: 'none',
  effects: [{ type: 'summon', archetype: 'minion', count: 2, max: 4 }],
};

const SAVAGE: EnemyAction = {
  id: 'minion.savage',
  name: 'Savage',
  description: 'Deal damage to one of your party.',
  weight: 1,
  target: 'oneEnemy',
  effects: [{ type: 'damage', power: 90 }],
};

/** A single no-op card, so the deck has something legal in it. */
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

function content(overrides: Partial<CombatContent> = {}): CombatContent {
  return {
    cardDefs: CARDS,
    summonable: { minion: MINION },
    enemyActions: { boss: [CALL], minion: [SAVAGE] },
    ...overrides,
  };
}

function battle(combatants: Combatant[], seed = 1): CombatState {
  return createCombat({
    combatants,
    deck: Array.from({ length: 10 }, () => 'wait'),
    seed,
  });
}

/** Runs `rounds` full enemy turns, passing immediately each player turn. */
function passRounds(state: CombatState, c: CombatContent, rounds: number): CombatState {
  let current = state;
  for (let i = 0; i < rounds; i += 1) {
    if (current.phase === 'victory' || current.phase === 'defeat') break;
    if (current.activeTeam === 'player') current = endPlayerTurn(current, c);
    current = resolveEnemyTurn(current, c);
  }
  return current;
}

const enemiesOf = (state: CombatState) => state.enemyOrder.map((id) => state.combatants[id]!);
const minionsOf = (state: CombatState) => enemiesOf(state).filter((c) => c.archetype === 'minion');

describe('summoning', () => {
  it('puts new combatants on the summoner’s side', () => {
    const c = content();
    const after = passRounds(battle([unit(), SUMMONER]), c, 1);

    expect(minionsOf(after)).toHaveLength(2);

    // On the enemy team, not the summoner's target's team.
    for (const minion of minionsOf(after)) expect(minion.team).toBe('enemy');
  });

  it('stops at the cap however long the fight runs', () => {
    const c = content();
    const after = passRounds(battle([unit(), SUMMONER]), c, 8);

    // Four calls of two would be eight; the cap counts what is standing.
    expect(minionsOf(after).length).toBeLessThanOrEqual(4);
    expect(minionsOf(after)).toHaveLength(4);
  });

  it('refills the brood as it is cleared', () => {
    const c = content();
    let state = passRounds(battle([unit(), SUMMONER]), c, 2);
    expect(minionsOf(state)).toHaveLength(4);

    // Kill two outright, as a player's area card would.
    const doomed = minionsOf(state).slice(0, 2);
    state = {
      ...state,
      combatants: {
        ...state.combatants,
        ...Object.fromEntries(doomed.map((m) => [m.id, { ...m, health: 0, downed: true }])),
      },
    };

    state = passRounds(state, c, 1);

    // The two that fell are gone from the board rather than lying on it, and
    // the cap had room again.
    for (const dead of doomed) expect(state.combatants[dead.id]).toBeUndefined();
    expect(minionsOf(state)).toHaveLength(4);
  });

  it('does not let a summon act on the turn it arrives', () => {
    const c = content();
    const start = battle([unit(), SUMMONER]);
    const after = passRounds(start, c, 1);

    const hero = after.combatants['hero']!;

    // Minions hit for ~56 each and the Boss's only move is the summon, so any
    // damage at all this turn would mean a fresh minion had swung.
    expect(hero.health).toBe(hero.maxHealth);
    expect(minionsOf(after)).toHaveLength(2);

    // ...and they are genuinely able to act, so the turn of grace is about the
    // queue, not about them being newly-spawned and inert.
    for (const minion of minionsOf(after)) expect(canAct(minion)).toBe(true);
  });

  it('lets the brood act from the following turn', () => {
    const c = content();
    const after = passRounds(battle([unit(), SUMMONER]), c, 2);

    expect(after.combatants['hero']!.health).toBeLessThan(500);
  });

  it('collapses the brood when the summoner falls, and wins the battle', () => {
    const c = content();
    let state = passRounds(battle([unit(), SUMMONER]), c, 2);
    expect(minionsOf(state).length).toBeGreaterThan(0);

    const boss = state.combatants['boss']!;
    state = {
      ...state,
      combatants: { ...state.combatants, boss: { ...boss, health: 0, downed: true } },
    };

    state = passRounds(state, c, 1);

    // Nothing of the brood is left on the board, and the fight is over rather
    // than dragging into a mop-up of whatever she had out when she died.
    expect(minionsOf(state)).toHaveLength(0);
    expect(state.phase).toBe('victory');
  });

  it('leaves non-summoned enemies on the board when they fall', () => {
    const c = content({ enemyActions: { boss: [CALL], minion: [SAVAGE], ally: [SAVAGE] } });
    const bystander: Combatant = {
      ...unit({ id: 'ally', name: 'Bystander', team: 'enemy' }),
      archetype: 'ally',
      health: 0,
      downed: true,
    };

    const state = passRounds(battle([unit(), SUMMONER, bystander]), c, 1);

    // Only summons are swept; an ordinary downed enemy stays as a corpse, since
    // the player can still have reason to see it.
    expect(state.combatants['ally']).toBeDefined();
    expect(state.combatants['ally']!.downed).toBe(true);
  });

  it('replays identically from the same seed', () => {
    const c = content();
    const a = passRounds(battle([unit(), SUMMONER], 12345), c, 4);
    const b = passRounds(battle([unit(), SUMMONER], 12345), c, 4);

    // Ids included: a module-level counter or a timestamp would drift here, and
    // the balance probe's 16,800 reproducible battles rest on this.
    expect(a.enemyOrder).toEqual(b.enemyOrder);
    expect(a.log).toEqual(b.log);
    expect(a.nextSummon).toBe(b.nextSummon);
  });

  it('gives every summon an id of its own', () => {
    const c = content();
    const after = passRounds(battle([unit(), SUMMONER]), c, 6);
    const ids = after.enemyOrder;

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('summons nothing when the archetype is not in the bestiary', () => {
    const c = content({ summonable: {} });
    const after = passRounds(battle([unit(), SUMMONER]), c, 2);

    // A content error should be inert, not a crash mid-battle.
    expect(minionsOf(after)).toHaveLength(0);
    expect(after.phase).not.toBe('defeat');
  });
});
