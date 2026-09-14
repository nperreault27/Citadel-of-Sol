import { describe, it } from 'vitest';
import { DEFAULT_ENCOUNTER } from '@/game/combat/content';
import { mean, runGrid, seedsFromEnv } from './sim/grid';
import { everyParty } from './sim/play';

/**
 * Balance probe — a tuning tool, not a test.
 *
 * Run with `npm run balance`. Named `.probe.ts` rather than `.test.ts` so it
 * stays out of the normal suite: it asserts nothing and would only be noise in
 * CI, but it answers the question you actually want answered after changing a
 * stat or a card — did that make the fight harder or easier, and by how much?
 *
 * Every party plays the arena twice over: once with the planner (see
 * `sim/planner.ts`), which searches its turn and imagines the enemy's reply,
 * and once with the old greedy AI. The planner's win rate is the one to read.
 * The greedy column is a ceiling on how easy the fight is, and the distance
 * between the two is how much the party rewards good play.
 *
 * `PROBE_SEEDS` overrides the seed count; see the README for the rest.
 */

const SEEDS = seedsFromEnv(10);

describe('balance probe', () => {
  it('reports outcomes for every party of three', async () => {
    const parties = everyParty();
    const cell = await runGrid(parties, [DEFAULT_ENCOUNTER], SEEDS, ['planner', 'greedy'], 'balance');

    const rows = parties.map((party, index) => {
      const planner = cell('planner', DEFAULT_ENCOUNTER, index);
      const greedy = cell('greedy', DEFAULT_ENCOUNTER, index);
      const rounds = planner.outcomes.map((o) => o.rounds).sort((a, b) => a - b);

      return {
        party: party.join(' + '),
        win: planner.rate,
        greedy: greedy.rate,
        median: rounds[Math.floor(rounds.length / 2)] ?? 0,
        survivors: mean(planner.outcomes.map((o) => o.survivors)),
      };
    });

    rows.sort((a, b) => b.win - a.win);

    console.log(`\n  ${SEEDS} seeds per party\n`);
    console.log('  party                       win%  greedy%   median rounds   survivors');
    for (const row of rows) {
      console.log(
        `  ${row.party.padEnd(24)}` +
          `${row.win.toFixed(1).padStart(7)}%` +
          `${row.greedy.toFixed(1).padStart(8)}%` +
          `${String(row.median).padStart(16)}` +
          `${row.survivors.toFixed(2).padStart(12)}`
      );
    }
    console.log('');
  });
});
