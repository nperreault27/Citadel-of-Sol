import { describe, expect, it } from 'vitest';
import {
  BRUNO,
  CASK,
  COMBAT_CONTENT,
  EMRYS,
  HOLLIS,
  IMP,
  IVY,
  LYRA,
  OGRE,
  SABER,
  THANE,
  enemyTeamById,
} from '@/game/combat/content';
import { cardDefOf, createCombat } from '@/game/combat/engine';
import type { Combatant, CombatState } from '@/game/combat/types';
import { createGreedy } from './sim/greedy';
import { applyAction, fight, isOver, playOut, type Action, type Policy } from './sim/play';
import { createPlanner } from './sim/planner';

/**
 * The planner the balance probes rely on.
 *
 * Small hand-built positions where one move is clearly right, so a regression
 * in the evaluator shows up as a wrong move rather than as a quiet shift in a
 * probe table nobody is watching.
 */

/** Slow enough that the party always acts first. */
const sluggish = (enemy: Combatant, changes: Partial<Combatant> = {}): Combatant => ({
  ...enemy,
  speed: 0,
  ...changes,
});

/** A battle whose opening hand is exactly `hand` (a deck of five deals all five). */
function position(party: Combatant[], enemies: Combatant[], hand: string[]): CombatState {
  return createCombat({ combatants: [...party, ...enemies], deck: hand, seed: 1 });
}

/** The cards one turn plays, in order, as definition id and target. */
function playTurn(state: CombatState, policy: Policy): Array<{ card: string; target: string | null }> {
  const played: Array<{ card: string; target: string | null }> = [];
  let current = state;

  for (let i = 0; i < 20; i++) {
    if (current.phase !== 'selectCard' && current.phase !== 'selecting') break;

    const action: Action = policy.choose(current);
    if (action.type === 'endTurn') break;
    if (action.type === 'play') {
      played.push({
        card: cardDefOf(current, COMBAT_CONTENT, action.card)?.id ?? '?',
        target: action.target,
      });
    }
    current = applyAction(current, action);
  }

  return played;
}

function firstPlay(state: CombatState, policy: Policy) {
  return playTurn(state, policy)[0];
}

describe('planner', () => {
  it('buffs before it hits', () => {
    const state = position(
      [LYRA, BRUNO, THANE],
      [sluggish(OGRE, { health: 3000, maxHealth: 3000 })],
      ['lyra.refrain', 'bruno.hook', 'bruno.jab', 'bruno.jab', 'thane.ward']
    );

    const played = playTurn(state, createPlanner());
    const refrain = played.findIndex((p) => p.card === 'lyra.refrain');
    const hook = played.findIndex((p) => p.card === 'bruno.hook');

    expect(refrain).toBeGreaterThanOrEqual(0);
    expect(hook).toBeGreaterThan(refrain);
    expect(played[refrain]?.target).toBe('bruno');
  });

  it('finishes a nearly dead enemy rather than chipping the big one', () => {
    // A sliver of stamina, so Bruno has exactly one Jab in him and the choice
    // of where it goes is the whole test.
    const state = position(
      [{ ...BRUNO, stamina: 20 }, HOLLIS, THANE],
      [sluggish(OGRE), sluggish(IMP, { id: 'imp1', health: 10 })],
      ['bruno.jab', 'bruno.jab', 'bruno.jab', 'bruno.jab', 'bruno.jab']
    );

    expect(firstPlay(state, createPlanner())).toEqual({ card: 'bruno.jab', target: 'imp1' });
  });

  it('revives a downed ally', () => {
    const state = position(
      [IVY, { ...SABER, health: 0, downed: true }, CASK],
      [sluggish(OGRE)],
      ['team.poultice', 'ivy.inject', 'cask.buckshot', 'cask.buckshot', 'saber.sever']
    );

    const played = playTurn(state, createPlanner());
    expect(played).toContainEqual({ card: 'team.poultice', target: 'saber' });
  });

  it('taunts when a fragile ally would otherwise be killed', () => {
    const state = position(
      [HOLLIS, { ...EMRYS, health: 30 }, BRUNO],
      [sluggish(OGRE)],
      ['hollis.goad', 'hollis.strike', 'hollis.strike', 'hollis.strike', 'hollis.strike']
    );

    // Goad is free, so it may come before or after the Strike. What matters is
    // that the turn includes it.
    const played = playTurn(state, createPlanner({ samples: 16 })).map((p) => p.card);
    expect(played).toContain('hollis.goad');
  });

  it('decides without peeking at the draw order or the next roll', () => {
    const arena = enemyTeamById('arena')?.members ?? [];
    const state = fight(['ivy', 'saber', 'cask'], arena, 3);
    const shuffled = { ...state, drawPile: [...state.drawPile].reverse(), seed: 987654 };

    expect(createPlanner({ seed: 5 }).choose(shuffled)).toEqual(createPlanner({ seed: 5 }).choose(state));
  });

  it('plays whole battles to a finish', () => {
    const arena = enemyTeamById('arena')?.members ?? [];
    for (const seed of [1, 2]) {
      const result = playOut(fight(['bruno', 'lyra', 'hollis'], arena, seed), createPlanner({ seed }));
      expect(isOver(result)).toBe(true);
    }
  });

  it('beats the greedy AI', () => {
    const tyrant = enemyTeamById('tyrant')?.members ?? [];
    const parties = [
      ['bruno', 'lyra', 'hollis'],
      ['ivy', 'saber', 'cask'],
      ['thane', 'emrys', 'vesper'],
    ];

    let planner = 0;
    let greedy = 0;

    for (const party of parties) {
      for (let seed = 1; seed <= 6; seed++) {
        if (playOut(fight(party, tyrant, seed), createPlanner({ seed })).phase === 'victory') planner++;
        if (playOut(fight(party, tyrant, seed), createGreedy()).phase === 'victory') greedy++;
      }
    }

    expect(planner).toBeGreaterThan(greedy);
  }, 120_000);
});
