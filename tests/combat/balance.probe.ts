import { describe, it } from 'vitest';
import { COMBAT_CONTENT, createArenaBattle } from '@/game/combat/content';
import {
  canPlayCard,
  cardDefOf,
  chooseTarget,
  confirmDiscard,
  endPlayerTurn,
  resolveEnemyTurn,
  legalTargets,
  selectCard,
} from '@/game/combat/engine';
import type { CombatState } from '@/game/combat/types';

/**
 * Balance probe — a tuning tool, not a test.
 *
 * Run with `npm run balance`. Named `.probe.ts` rather than `.test.ts` so it
 * stays out of the normal suite: it asserts nothing and would only be noise in
 * CI, but it answers the question you actually want answered after changing a
 * stat or a card — did that make the fight harder or easier, and by how much?
 *
 * The AI is deliberately greedy and stupid: it plays the first affordable card
 * at the first legal target. Treat its win rate as a *ceiling on how easy* the
 * encounter is. A greedy AI winning 99% means the fight is trivial; a greedy AI
 * losing does not prove the fight is hard, only that it isn't free.
 */

const SEEDS = 200;

function playOut(state: CombatState): CombatState {
  let current = state;

  for (let i = 0; i < 300; i++) {
    if (current.phase === 'victory' || current.phase === 'defeat') break;

    // The enemy turn is stepped for the UI's benefit; simulations resolve it
    // in one go.
    if (current.phase === 'enemyTurn') {
      current = resolveEnemyTurn(current, COMBAT_CONTENT);
      continue;
    }

    if (current.phase === 'discarding') {
      const excess = current.hand.length - current.handLimit;
      current = confirmDiscard(current, COMBAT_CONTENT, current.hand.slice(0, excess));
      continue;
    }

    let played = true;
    while (played && current.phase === 'selectCard') {
      played = false;

      for (const id of [...current.hand]) {
        if (!canPlayCard(current, COMBAT_CONTENT, id).ok) continue;
        if (!cardDefOf(current, COMBAT_CONTENT, id)) continue;

        const next = selectCard(current, COMBAT_CONTENT, id);

        if (next.phase === 'selectTarget') {
          const target = legalTargets(next, COMBAT_CONTENT, id)[0];
          if (!target) break;
          current = chooseTarget(next, COMBAT_CONTENT, target);
        } else {
          current = next;
        }

        played = true;
        break;
      }
    }

    if (current.phase === 'victory' || current.phase === 'defeat') break;
    current = resolveEnemyTurn(endPlayerTurn(current, COMBAT_CONTENT), COMBAT_CONTENT);
  }

  return current;
}

describe('balance probe', () => {
  it('reports outcomes across many seeds', () => {
    let wins = 0;
    const rounds: number[] = [];
    const survivors: number[] = [];

    for (let seed = 1; seed <= SEEDS; seed++) {
      const result = playOut(createArenaBattle(seed));
      if (result.phase === 'victory') wins++;
      rounds.push(result.round);
      survivors.push(result.playerOrder.filter((id) => !result.combatants[id]?.downed).length);
    }

    rounds.sort((a, b) => a - b);
    const median = rounds[Math.floor(rounds.length / 2)];
    const averageSurvivors = survivors.reduce((a, b) => a + b, 0) / survivors.length;

    console.log(`\n  seeds        ${SEEDS}`);
    console.log(`  win rate     ${((wins / SEEDS) * 100).toFixed(1)}%  (${wins} wins)`);
    console.log(`  rounds       min ${rounds[0]}  median ${median}  max ${rounds.at(-1)}`);
    console.log(`  survivors    ${averageSurvivors.toFixed(2)} of 3 on average\n`);
  });
});
