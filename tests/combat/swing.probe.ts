import { describe, it } from 'vitest';
import { ENEMY_TEAMS, ROSTER } from '@/game/combat/content';
import { mean, runGrid, seedsFromEnv } from './sim/grid';
import { everyParty } from './sim/play';

/**
 * Who is carrying, character by character and fight by fight.
 *
 * The encounter probe next door asks whether each *team* poses a different
 * question, and prints only the three characters who answer it best and the
 * three who answer it worst. This prints the whole grid, because the rows it
 * leaves out are where a character quietly doing nothing hides: a roster where
 * six of nine sit between -1 and +1 is flat, and no top-three list will say so.
 *
 * Each cell is that character's swing under the planner AI: the average win
 * rate of the 28 parties containing them, as a difference from that fight's
 * average across all 84. So `+15` reads as "bring them and you win fifteen
 * points more often than the field does". The columns after the grid:
 *
 *   MEAN    the row's average swing.
 *   win%    the raw planner win rate the swing is measured from.
 *   greedy  the same battles played by the old first-card-first-target AI.
 *   gap     win% minus greedy — how much this character rewards good play. A
 *           big gap is a setup or sequencing kit the greedy numbers undersold.
 *   hp±     swing in party health left on the fights they win. Separates
 *           characters on fights nearly everyone wins, where win% cannot.
 *
 * Read the shape, not the digits. Two useful shapes:
 *   - a high MEAN with a flat row is a character who is simply better, and
 *   - a low MEAN with one big cell is a specialist, which is the good kind of
 *     outlier — it means that fight has an answer rather than a difficulty.
 *
 * Asserts nothing. Run with `npm run swing`, or `npm run balance` for this and
 * the other two probes together. `PROBE_SEEDS` overrides the seed count.
 */

const SEEDS = seedsFromEnv(10);

const signed = (x: number, digits = 0) => `${x >= 0 ? '+' : ''}${x.toFixed(digits)}`;

describe('swing probe', () => {
  it('reports every character against every team', async () => {
    const parties = everyParty();
    const ids = ROSTER.map((c) => c.id);
    const teamIds = ENEMY_TEAMS.map((team) => team.id);
    const cell = await runGrid(parties, teamIds, SEEDS, ['planner', 'greedy'], 'swing');

    const swing: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
    const planner: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
    const greedy: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
    const hp: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));

    for (const teamId of teamIds) {
      const rows = parties.map((party, index) => ({
        party,
        rate: cell('planner', teamId, index).rate,
        greedy: cell('greedy', teamId, index).rate,
        hp: cell('planner', teamId, index).hp,
      }));

      const overall = mean(rows.map((row) => row.rate));
      const hpRows = rows.flatMap((row) => (row.hp === null ? [] : [row.hp]));
      const overallHp = mean(hpRows);

      for (const id of ids) {
        const withThem = rows.filter((row) => row.party.includes(id));
        const rate = mean(withThem.map((row) => row.rate));

        swing[id]?.push(rate - overall);
        planner[id]?.push(rate);
        greedy[id]?.push(mean(withThem.map((row) => row.greedy)));

        const theirHp = withThem.flatMap((row) => (row.hp === null ? [] : [row.hp]));
        if (theirHp.length > 0 && hpRows.length > 0) hp[id]?.push(mean(theirHp) - overallHp);
      }
    }

    console.log('');

    // Four characters of each team name, with a leading "The" dropped first —
    // six of the nine teams have one, and abbreviating those to "The" names
    // nothing. Short enough that the grid fits a terminal without wrapping.
    const head = ENEMY_TEAMS.map((team) =>
      team.name.replace(/^The /, '').slice(0, 4).padStart(6)
    ).join('');
    console.log(
      `  ${'char'.padEnd(8)}${head}` +
        `${'MEAN'.padStart(8)}${'win%'.padStart(8)}${'greedy'.padStart(8)}` +
        `${'gap'.padStart(7)}${'hp±'.padStart(7)}`
    );

    const of = (table: Record<string, number[]>, id: string) => table[id] ?? [];
    const ranked = [...ids].sort((a, b) => mean(of(swing, b)) - mean(of(swing, a)));

    for (const id of ranked) {
      const cells = of(swing, id)
        .map((delta) => signed(delta).padStart(6))
        .join('');
      const win = mean(of(planner, id));
      const base = mean(of(greedy, id));

      console.log(
        `  ${id.padEnd(8)}${cells}` +
          signed(mean(of(swing, id)), 1).padStart(8) +
          `${win.toFixed(1)}%`.padStart(8) +
          `${base.toFixed(1)}%`.padStart(8) +
          signed(win - base).padStart(7) +
          signed(mean(of(hp, id))).padStart(7)
      );
    }

    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    if (top && bottom) {
      const spread = mean(of(swing, top)) - mean(of(swing, bottom));
      console.log(`\n  top to bottom: ${spread.toFixed(1)} points\n`);
    }
  });
});
