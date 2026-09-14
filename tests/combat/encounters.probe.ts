import { describe, it } from 'vitest';
import { ENEMY_TEAMS, ROSTER } from '@/game/combat/content';
import { mean, runGrid, seedsFromEnv } from './sim/grid';
import { everyParty } from './sim/play';

/**
 * Does each enemy team actually ask a different question?
 *
 * The per-party probe next door answers "how hard is the fight". This answers
 * the thing that matters once there is more than one fight: whether the choice
 * of party changes the outcome.
 *
 * The number to read is the **spread** — the gap between the best party's win
 * rate and the worst. A team every party clears, or none does, is not posing a
 * question; it is just a difficulty setting with extra steps. A wide spread
 * means some parties genuinely answer it and others genuinely don't, which is
 * the entire reason the roster has nine characters and the deck builder exists.
 *
 * Everything is measured with the planner AI. The `greedy%` column is the old
 * first-card-first-target AI on the same battles, kept as a baseline: it is a
 * ceiling on how easy a fight is, and a team where it sits far below the
 * planner is one that rewards thinking.
 *
 * Asserts nothing. Run with `npm run balance`; `PROBE_SEEDS` overrides seeds.
 */

const SEEDS = seedsFromEnv(10);

/** Win rate at which a party counts as beating a fight consistently. */
const CONSISTENT = 80;

/** The characters whose whole plan is to stall, so their fights run long on purpose. */
const TANKS = ['hollis', 'thane'];

/** Nearest-rank percentile of an ascending array, p in [0, 1]. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.round(p * (sorted.length - 1)))] ?? 0;
}

describe('encounter probe', () => {
  it('reports how much the party matters, team by team', async () => {
    const parties = everyParty();
    const teamIds = ENEMY_TEAMS.map((team) => team.id);
    const cell = await runGrid(parties, teamIds, SEEDS, ['planner', 'greedy'], 'encounters');

    // `spread` is the 90th-percentile party minus the 10th, so a single party
    // that cannot deal damage at all no longer sets it to 100 on every team.
    // `rounds` is the median battle length, all parties then tank-free ones.
    // `alive` is mean survivors on the battles the planner won.
    console.log(
      '\n  team                  tier    win%  greedy%  spread  >=80%  rounds  no-tank  alive' +
        '   best party                 worst party'
    );

    for (const team of ENEMY_TEAMS) {
      const scored = parties.map((party, index) => {
        const planner = cell('planner', team.id, index);
        return {
          party: party.join('+'),
          tank: party.some((id) => TANKS.includes(id)),
          rate: planner.rate,
          greedy: cell('greedy', team.id, index).rate,
          outcomes: planner.outcomes,
        };
      });

      const overall = mean(scored.map((row) => row.rate));
      const greedy = mean(scored.map((row) => row.greedy));

      const ranked = [...scored].sort((a, b) => b.rate - a.rate);
      const best = ranked[0];
      const worst = ranked[ranked.length - 1];
      if (!best || !worst) continue;

      const rates = scored.map((row) => row.rate).sort((a, b) => a - b);
      const spread = percentile(rates, 0.9) - percentile(rates, 0.1);
      const consistent = scored.filter((row) => row.rate >= CONSISTENT).length;

      const roundsOf = (rows: typeof scored) =>
        rows.flatMap((row) => row.outcomes.map((o) => o.rounds)).sort((a, b) => a - b);
      const rounds = percentile(roundsOf(scored), 0.5);
      const tankFree = percentile(roundsOf(scored.filter((row) => !row.tank)), 0.5);

      const alive = mean(
        scored.flatMap((row) => row.outcomes.filter((o) => o.win).map((o) => o.survivors))
      );

      console.log(
        `  ${team.name.padEnd(22)}${String(team.tier).padEnd(6)}` +
          `${overall.toFixed(1).padStart(6)}%` +
          `${greedy.toFixed(1).padStart(8)}%` +
          `${spread.toFixed(0).padStart(8)}` +
          `${String(consistent).padStart(7)}` +
          `${String(rounds).padStart(8)}` +
          `${String(tankFree).padStart(9)}` +
          `${alive.toFixed(2).padStart(7)}   ` +
          `${`${best.party} (${best.rate.toFixed(0)}%)`.padEnd(27)}` +
          `${worst.party} (${worst.rate.toFixed(0)}%)`
      );

      // Who this fight is actually for. Each character's number is the average
      // win rate of every party containing them, as a swing from this team's
      // overall average — so it reads as "brings Bruno, wins 12 points more
      // often than the field". This is where a team's question shows up or
      // fails to: if nobody swings, the fight has no opinion about the roster.
      const swing = ROSTER.map((character) => {
        const rows = scored.filter((row) => row.party.split('+').includes(character.id));
        return { id: character.id, delta: mean(rows.map((row) => row.rate)) - overall };
      }).sort((a, b) => b.delta - a.delta);

      const show = (entry: { id: string; delta: number }) =>
        `${entry.id} ${entry.delta >= 0 ? '+' : ''}${entry.delta.toFixed(0)}`;

      console.log(
        `${''.padEnd(24)}for: ${swing.slice(0, 3).map(show).join(', ')}` +
          `   against: ${swing.slice(-3).map(show).join(', ')}`
      );
    }

    console.log('');
  });
});
