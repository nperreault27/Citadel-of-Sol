import type { AiKind, Job, Outcome } from './jobs';
import { runBattles } from './runner';

/**
 * Every AI × team × party × seed, run once and looked up by coordinate.
 *
 * All three probes want the same cube sliced differently, so the job ordering
 * and the index arithmetic live here rather than three times over.
 */

export const mean = (xs: readonly number[]) =>
  xs.length === 0 ? 0 : xs.reduce((sum, x) => sum + x, 0) / xs.length;

export function seedsFromEnv(fallback: number): number {
  const seeds = Number(process.env.PROBE_SEEDS);
  return Number.isFinite(seeds) && seeds > 0 ? Math.floor(seeds) : fallback;
}

export interface Cell {
  /** Win rate, 0–100. */
  rate: number;
  /** Mean party health left on the battles won, 0–100, or null with no wins. */
  hp: number | null;
  outcomes: Outcome[];
}

export type Lookup = (ai: AiKind, teamId: string, partyIndex: number) => Cell;

export async function runGrid(
  parties: readonly string[][],
  teamIds: readonly string[],
  seeds: number,
  ais: readonly AiKind[],
  label: string
): Promise<Lookup> {
  const jobs: Job[] = [];

  for (const ai of ais) {
    for (const teamId of teamIds) {
      for (const party of parties) {
        for (let seed = 1; seed <= seeds; seed++) jobs.push({ party, teamId, seed, ai });
      }
    }
  }

  const started = Date.now();
  const outcomes = await runBattles(jobs, label);
  console.log(
    `\n  ${jobs.length} battles in ${((Date.now() - started) / 1000).toFixed(0)}s` +
      ` (${parties.length} parties x ${teamIds.length} teams x ${seeds} seeds x ${ais.join('/')})`
  );

  return (ai, teamId, partyIndex) => {
    const offset =
      ((ais.indexOf(ai) * teamIds.length + teamIds.indexOf(teamId)) * parties.length + partyIndex) *
      seeds;
    const slice = outcomes.slice(offset, offset + seeds);
    const wins = slice.filter((o) => o.win);

    return {
      rate: (wins.length / seeds) * 100,
      hp: wins.length > 0 ? mean(wins.map((o) => o.hpLeft)) * 100 : null,
      outcomes: slice,
    };
  };
}
