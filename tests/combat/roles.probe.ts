import { describe, it } from 'vitest';
import { ENEMY_TEAMS } from '@/game/combat/content';
import { mean, runGrid, seedsFromEnv } from './sim/grid';
import { everyParty } from './sim/play';
import { ROLES, composition, roleCount, type Role } from './sim/roles';

/**
 * Which roles the parties that beat each encounter are built from.
 *
 * The swing probe says which *characters* a fight favours. This asks the same
 * thing one level up: does a fight want two damage dealers, a sustain, a
 * support — or does it not care what the party is made of? A fight whose top
 * parties look like the field is not asking for a focused team.
 *
 * Roles are each character's primary role as written in their doc comment in
 * `content.ts`. They are not in the game data, so keep this table in step.
 *
 * Planner AI only. Asserts nothing. Run with:
 *   npx vitest run --config vitest.probe.config.ts tests/combat/roles.probe.ts
 */

/** Win rate at which a party counts as beating a fight consistently. */
const TOP = 80;

const SEEDS = seedsFromEnv(10);

describe('roles probe', () => {
  it('reports the role make-up of the parties that beat each encounter', async () => {
    const parties = everyParty();
    const teamIds = ENEMY_TEAMS.map((team) => team.id);
    const cell = await runGrid(parties, teamIds, SEEDS, ['planner'], 'roles');

    // The field's own make-up, which every top-party number is read against.
    const fieldShare = new Map<string, number>();
    for (const party of parties) {
      const key = composition(party);
      fieldShare.set(key, (fieldShare.get(key) ?? 0) + 1 / parties.length);
    }
    const fieldAvg = Object.fromEntries(
      ROLES.map((role) => [role, mean(parties.map((party) => roleCount(party, role)))])
    ) as Record<Role, number>;

    console.log(
      `\n  field: ${parties.length} parties, avg per party ` +
        ROLES.map((role) => `${role} ${fieldAvg[role].toFixed(2)}`).join('  ')
    );

    for (const team of ENEMY_TEAMS) {
      const rows = parties
        .map((party, index) => {
          const c = cell('planner', team.id, index);
          return { party, rate: c.rate, hp: c.hp ?? 0 };
        })
        // Ties broken on health left, so the order means something rather than
        // falling back to the order parties were generated in.
        .sort((a, b) => b.rate - a.rate || b.hp - a.hp);

      const top = rows.filter((row) => row.rate >= TOP);

      console.log(
        `\n  ${team.name} (tier ${team.tier}) — ${top.length} of ${parties.length} parties win >= ${TOP}%`
      );
      if (top.length === 0) continue;

      // Average of each role per top party, against the field.
      console.log(
        '    avg per party   ' +
          ROLES.map((role) => {
            const avg = mean(top.map((row) => roleCount(row.party, role)));
            const delta = avg - fieldAvg[role];
            return `${role} ${avg.toFixed(2)} (${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`;
          }).join('   ')
      );

      const withSustain = top.filter((row) => roleCount(row.party, 'SUS') > 0).length;
      const fieldSustain = parties.filter((party) => roleCount(party, 'SUS') > 0).length;
      console.log(
        `    has a sustain   ${((withSustain / top.length) * 100).toFixed(0)}% of top` +
          `   vs ${((fieldSustain / parties.length) * 100).toFixed(0)}% of field`
      );

      // Which compositions the top parties are made of, and how over-represented
      // each one is: lift 2.0 means twice as common among winners as in the field.
      const counts = new Map<string, number>();
      for (const row of top) {
        const key = composition(row.party);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const mixes = [...counts.entries()]
        .map(([key, count]) => {
          const share = count / top.length;
          return { key, count, share, lift: share / (fieldShare.get(key) ?? 1) };
        })
        .sort((a, b) => b.count - a.count);

      console.log('    compositions    ' + 'mix'.padEnd(14) + 'top'.padStart(5) + '  share   lift');
      for (const mix of mixes) {
        console.log(
          `${''.padEnd(20)}${mix.key.padEnd(14)}${String(mix.count).padStart(5)}` +
            `${`${(mix.share * 100).toFixed(0)}%`.padStart(7)}${mix.lift.toFixed(2).padStart(7)}`
        );
      }

      console.log(
        '    best five       ' +
          rows
            .slice(0, 5)
            .map((row) => `${row.party.join('+')} ${row.rate.toFixed(0)}%`)
            .join(', ')
      );
    }

    console.log('');
  });
});
