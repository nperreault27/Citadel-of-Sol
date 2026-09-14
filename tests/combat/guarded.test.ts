import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  selectCard,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import type { CardDefinition, Combatant, CombatContent, CombatState } from '@/game/combat/types';

/**
 * `damageTakenWithAllies`: the Broodmother's guard. Attacks on her are cut while
 * anyone else on her side stands, and land in full once she is alone. Poison is
 * not an attack and ignores it.
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
    defense: 0,
    speed: 10,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

const boss = (overrides: Partial<Combatant> = {}) =>
  unit({ id: 'boss', name: 'Boss', team: 'enemy', speed: 1, damageTakenWithAllies: 0.5, ...overrides });

const brood = (overrides: Partial<Combatant> = {}) =>
  unit({ id: 'brood', name: 'Brood', team: 'enemy', speed: 1, ...overrides });

const CARDS: Record<string, CardDefinition> = {
  strike: {
    id: 'strike',
    tier: 'basic',
    name: 'Strike',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 50 }],
  },
};

const CONTENT: CombatContent = { cardDefs: CARDS, enemyActions: {} };

function battle(combatants: Combatant[]): CombatState {
  return createCombat({
    combatants,
    deck: Array.from({ length: 10 }, () => 'strike'),
    seed: 42,
  });
}

function strike(state: CombatState, target: string): CombatState {
  const card = state.hand.find((id) => state.cards[id]?.definitionId === 'strike');
  if (!card) throw new Error('no strike in hand');
  return chooseTarget(selectCard(state, CONTENT, card), CONTENT, target);
}

describe('damage taken while allies stand', () => {
  it('cuts an attack while another enemy is standing', () => {
    // Attack 100 at power 50 into Defense 0 is 50, halved to 25.
    const after = strike(battle([unit(), boss(), brood()]), 'boss');
    expect(after.combatants['boss']!.health).toBe(375);
  });

  it('lets the attack land in full once the rest of the side is down', () => {
    const after = strike(battle([unit(), boss(), brood({ health: 0, downed: true })]), 'boss');
    expect(after.combatants['boss']!.health).toBe(350);
  });

  it('protects only the combatant that has it', () => {
    const after = strike(battle([unit(), boss(), brood()]), 'brood');
    expect(after.combatants['brood']!.health).toBe(350);
  });

  it('does not touch poison', () => {
    // One stack ticks 4% of max health: 16 of 400, guard or no guard.
    const poisoned = boss({
      statuses: [{ kind: 'poison', stacks: 1, duration: { kind: 'turns', remaining: 2 } }],
    });
    const state = battle([unit(), poisoned, brood()]);

    const after = resolveEnemyTurn(endPlayerTurn(state, CONTENT), CONTENT);
    expect(after.combatants['boss']!.health).toBe(384);
  });
});

describe('poison immunity', () => {
  const INJECT: Record<string, CardDefinition> = {
    inject: {
      id: 'inject',
      tier: 'basic',
      name: 'Inject',
      description: '',
      brief: '',
      ownerId: 'hero',
      staminaCost: 10,
      target: 'oneEnemy',
      effects: [{ type: 'status', kind: 'poison', stacks: 2, duration: { kind: 'turns', remaining: 2 } }],
    },
  };
  const content: CombatContent = { cardDefs: INJECT, enemyActions: {} };

  function injected(target: Combatant): CombatState {
    const state = createCombat({
      combatants: [unit(), target],
      deck: Array.from({ length: 10 }, () => 'inject'),
      seed: 42,
    });
    const card = state.hand.find((id) => state.cards[id]?.definitionId === 'inject');
    if (!card) throw new Error('no inject in hand');
    return chooseTarget(selectCard(state, content, card), content, target.id);
  }

  it('never takes a poison stack', () => {
    const after = injected(brood({ poisonImmune: true }));
    expect(stacksOf(after.combatants['brood']!.statuses, 'poison')).toBe(0);
  });

  it('never takes poison damage, even carrying a stack from before', () => {
    const carrying = brood({
      poisonImmune: true,
      statuses: [{ kind: 'poison', stacks: 3, duration: { kind: 'turns', remaining: 2 } }],
    });
    const state = createCombat({ combatants: [unit(), carrying], deck: [], seed: 42 });

    const after = resolveEnemyTurn(endPlayerTurn(state, content), content);
    expect(after.combatants['brood']!.health).toBe(400);
  });

  it('leaves everyone else poisonable', () => {
    const after = injected(brood());
    expect(stacksOf(after.combatants['brood']!.statuses, 'poison')).toBe(2);
  });
});
