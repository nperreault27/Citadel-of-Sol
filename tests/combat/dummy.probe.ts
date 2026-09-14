import { describe, it } from 'vitest';
import { ROSTER } from '@/game/combat/content';
import type { Combatant } from '@/game/combat/types';
import { mean, seedsFromEnv } from './sim/grid';
import type { Job } from './sim/jobs';
import { everyParty } from './sim/play';
import { ROLE, ROLES, composition, roleCount } from './sim/roles';
import { runBattles } from './sim/runner';

/**
 * A pure damage check: how much can each party take off an armoured, bulky,
 * poison-immune boss that does nothing at all, before a round timer runs out?
 *
 * No enemy threat means Sustain has nothing to do and nothing to protect, and no
 * poison means Ivy's damage-over-time is off the table. What is left is how much
 * damage a party gets through high Defense, and how much a Support adds to it —
 * which is the question this exists to answer.
 *
 * The boss lives here, not in the game. Planner AI only. Asserts nothing.
 * Run with:
 *   npx vitest run --config vitest.probe.config.ts --reporter=verbose tests/combat/dummy.probe.ts
 */

const SEEDS = seedsFromEnv(10);

/** Rounds the party gets. Still standing after this, it has failed. */
const ROUNDS = 7;

const DUMMY: Combatant = {
  id: 'dummy',
  archetype: 'dummy',
  name: 'Training Dummy',
  team: 'enemy',
  health: 1500,
  maxHealth: 1500,
  // Normal stamina, so drain and Fatigue can still bench it and the resting
  // damage bonus still pays.
  stamina: 150,
  maxStamina: 150,
  attack: 0,
  defense: 80,
  speed: 0,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
  poisonImmune: true,
};

const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

describe('damage check probe', () => {
  it('reports how much of an inert, armoured, poison-immune boss each party clears in time', async () => {
    const parties = everyParty();
    const jobs: Job[] = parties.flatMap((party) =>
      Array.from({ length: SEEDS }, (_, i) => ({
        party,
        teamId: 'dummy',
        seed: i + 1,
        ai: 'planner' as const,
        enemies: [DUMMY],
        maxRounds: ROUNDS,
      }))
    );

    const outcomes = await runBattles(jobs, 'dummy');

    const rows = parties.map((party, p) => {
      const slice = outcomes.slice(p * SEEDS, (p + 1) * SEEDS);
      return {
        party,
        clear: (slice.filter((o) => o.win).length / SEEDS) * 100,
        removed: mean(slice.map((o) => (1 - o.enemyHpLeft) * 100)),
      };
    });

    const fieldClear = mean(rows.map((row) => row.clear));
    const fieldRemoved = mean(rows.map((row) => row.removed));

    console.log(
      `\n  ${DUMMY.name}: ${DUMMY.maxHealth} HP, DEF ${DUMMY.defense}, poison immune, ` +
        `${ROUNDS} rounds, ${parties.length} parties x ${SEEDS} seeds`
    );
    console.log(`  field: ${fieldClear.toFixed(1)}% clear, ${fieldRemoved.toFixed(1)}% of its health removed`);

    // ── By character ──
    console.log('\n  char     role   removed   swing    clear   swing');
    const byChar = ROSTER.map((character) => {
      const mine = rows.filter((row) => row.party.includes(character.id));
      return {
        id: character.id,
        removed: mean(mine.map((row) => row.removed)),
        clear: mean(mine.map((row) => row.clear)),
      };
    }).sort((a, b) => b.removed - a.removed);

    for (const row of byChar) {
      console.log(
        `  ${row.id.padEnd(9)}${(ROLE[row.id] ?? '?').padEnd(5)}` +
          `${`${row.removed.toFixed(1)}%`.padStart(9)}${signed(row.removed - fieldRemoved).padStart(8)}` +
          `${`${row.clear.toFixed(1)}%`.padStart(9)}${signed(row.clear - fieldClear).padStart(8)}`
      );
    }

    // ── By how many of a role the party brings ──
    console.log('\n  role   count  parties   removed    clear');
    for (const role of ROLES) {
      for (let count = 0; count <= 3; count++) {
        const mine = rows.filter((row) => roleCount(row.party, role) === count);
        if (mine.length === 0) continue;
        console.log(
          `  ${role.padEnd(7)}${String(count).padStart(5)}${String(mine.length).padStart(9)}` +
            `${`${mean(mine.map((row) => row.removed)).toFixed(1)}%`.padStart(10)}` +
            `${`${mean(mine.map((row) => row.clear)).toFixed(1)}%`.padStart(9)}`
        );
      }
    }

    // ── By composition ──
    console.log('\n  mix            parties   removed    clear');
    const mixes = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = composition(row.party);
      mixes.set(key, [...(mixes.get(key) ?? []), row]);
    }
    [...mixes.entries()]
      .map(([key, mine]) => ({
        key,
        count: mine.length,
        removed: mean(mine.map((row) => row.removed)),
        clear: mean(mine.map((row) => row.clear)),
      }))
      .sort((a, b) => b.removed - a.removed)
      .forEach((mix) => {
        console.log(
          `  ${mix.key.padEnd(15)}${String(mix.count).padStart(7)}` +
            `${`${mix.removed.toFixed(1)}%`.padStart(10)}${`${mix.clear.toFixed(1)}%`.padStart(9)}`
        );
      });

    // ── Best and worst parties ──
    const ranked = [...rows].sort((a, b) => b.removed - a.removed);
    const line = (row: (typeof rows)[number]) =>
      `    ${row.party.join('+').padEnd(24)}${composition(row.party).padEnd(14)}` +
      `${`${row.removed.toFixed(0)}%`.padStart(6)} removed${`${row.clear.toFixed(0)}%`.padStart(6)} clear`;

    console.log('\n  best ten');
    ranked.slice(0, 10).forEach((row) => console.log(line(row)));
    console.log('  worst ten');
    ranked.slice(-10).forEach((row) => console.log(line(row)));

    console.log('');
  });
});
