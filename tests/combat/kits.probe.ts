import { describe, it } from 'vitest';
import { CARD_DEFS, ENEMY_TEAMS, ROSTER, defaultDeck } from '@/game/combat/content';
import type { DeckList } from '@/game/combat/deckbuilding';
import { mean, seedsFromEnv } from './sim/grid';
import type { CardOverride, Job, Outcome } from './sim/jobs';
import { everyParty } from './sim/play';
import { runBattles } from './sim/runner';

/**
 * What a character actually does in a fight, and which build of them is best.
 *
 * The swing probe says whether bringing someone wins more. This says why: how
 * much of the party's damage they deal, how often they go down, which of their
 * cards the planner reaches for — and, for a kit with real choices in it, how
 * the same character performs under different decks and card costs.
 *
 * Planner AI only. Asserts nothing. Opt-in: run with `npm run kits`, which
 * `npm run balance` deliberately leaves out. `PROBE_SEEDS` overrides the seed count.
 */

const SEEDS = seedsFromEnv(4);
const VARIANT_SEEDS = seedsFromEnv(6);
const TEAM_IDS = ENEMY_TEAMS.map((team) => team.id);

const pct = (x: number) => `${x.toFixed(1)}%`.padStart(7);

interface Variant {
  name: string;
  /** This character's cards; everyone else keeps their default. */
  cards?: DeckList;
  cardOverrides?: Record<string, CardOverride>;
}

/** The party's default deck with one character's cards swapped for `cards`. */
function deckWith(party: readonly string[], characterId: string, cards: DeckList): DeckList {
  const deck = defaultDeck(party);
  for (const cardId of Object.keys(deck)) {
    if (CARD_DEFS[cardId]?.ownerId === characterId) delete deck[cardId];
  }
  return { ...deck, ...cards };
}

async function compareVariants(characterId: string, variants: Variant[], field: Record<string, number>) {
  const parties = everyParty().filter((party) => party.includes(characterId));
  const jobs: Job[] = [];

  for (const variant of variants) {
    for (const teamId of TEAM_IDS) {
      for (const party of parties) {
        for (let seed = 1; seed <= VARIANT_SEEDS; seed++) {
          jobs.push({
            party,
            teamId,
            seed,
            ai: 'planner',
            detail: true,
            ...(variant.cards ? { deck: deckWith(party, characterId, variant.cards) } : {}),
            ...(variant.cardOverrides ? { cardOverrides: variant.cardOverrides } : {}),
          });
        }
      }
    }
  }

  const outcomes = await runBattles(jobs, `${characterId} variants`);
  const perVariant = TEAM_IDS.length * parties.length * VARIANT_SEEDS;

  console.log(`\n  ${characterId}: ${parties.length} parties x ${TEAM_IDS.length} teams x ${VARIANT_SEEDS} seeds per build`);
  console.log(
    `  ${'build'.padEnd(26)}` +
      TEAM_IDS.map((id) => id.slice(0, 5).padStart(7)).join('') +
      `${'ALL'.padStart(8)}${'field'.padStart(8)}${'dmg%'.padStart(7)}${'downs'.padStart(7)}   plays/battle`
  );

  variants.forEach((variant, v) => {
    const slice = outcomes.slice(v * perVariant, (v + 1) * perVariant);
    const perTeam = TEAM_IDS.map((_, t) => {
      const cell = slice.slice(t * parties.length * VARIANT_SEEDS, (t + 1) * parties.length * VARIANT_SEEDS);
      return (cell.filter((o) => o.win).length / cell.length) * 100;
    });

    const share = mean(slice.map((o) => damageShare(o, characterId)));
    const downs = mean(slice.map((o) => o.detail?.downs[characterId] ?? 0));
    const plays = playsOf(slice, characterId);

    console.log(
      `  ${variant.name.padEnd(26)}` +
        perTeam.map((rate) => rate.toFixed(0).padStart(7)).join('') +
        pct(mean(perTeam)).padStart(8) +
        pct(mean(TEAM_IDS.map((id) => field[id] ?? 0))).padStart(8) +
        pct(share) +
        downs.toFixed(2).padStart(7) +
        `   ${plays}`
    );
  });
}

function damageShare(outcome: Outcome, id: string): number {
  const damage = outcome.detail?.damage ?? {};
  const total = Object.values(damage).reduce((sum, x) => sum + x, 0);
  return total > 0 ? ((damage[id] ?? 0) / total) * 100 : 0;
}

function playsOf(outcomes: readonly Outcome[], characterId: string): string {
  const names = Object.values(CARD_DEFS)
    .filter((card) => card.ownerId === characterId)
    .map((card) => card.name);
  return names
    .map((name) => `${name} ${mean(outcomes.map((o) => o.detail?.plays[name] ?? 0)).toFixed(1)}`)
    .join(', ');
}

describe('kits probe', () => {
  it('breaks down every character, then compares builds of the new ones', async () => {
    // ── Every character, default decks ──
    const parties = everyParty();
    const jobs: Job[] = [];
    for (const teamId of TEAM_IDS) {
      for (const party of parties) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          jobs.push({ party, teamId, seed, ai: 'planner', detail: true });
        }
      }
    }

    const outcomes = await runBattles(jobs, 'roster');
    const at = (t: number, p: number) =>
      outcomes.slice((t * parties.length + p) * SEEDS, (t * parties.length + p + 1) * SEEDS);

    const field: Record<string, number> = {};
    TEAM_IDS.forEach((teamId, t) => {
      const all = parties.flatMap((_, p) => at(t, p));
      field[teamId] = (all.filter((o) => o.win).length / all.length) * 100;
    });

    console.log(`\n  Every character: ${parties.length} parties x ${TEAM_IDS.length} teams x ${SEEDS} seeds, default decks`);
    console.log(
      `  ${'char'.padEnd(8)}${'win%'.padStart(7)}${'dmg%'.padStart(7)}${'dmg/btl'.padStart(9)}` +
        `${'downs'.padStart(7)}${'hp left'.padStart(9)}   worst team / best team`
    );

    for (const character of ROSTER) {
      const mine = TEAM_IDS.map((teamId, t) => ({
        teamId,
        outcomes: parties.flatMap((party, p) => (party.includes(character.id) ? at(t, p) : [])),
      }));
      const flat = mine.flatMap((row) => row.outcomes);
      const rates = mine.map((row) => ({
        teamId: row.teamId,
        swing: (row.outcomes.filter((o) => o.win).length / row.outcomes.length) * 100 - (field[row.teamId] ?? 0),
      }));
      rates.sort((a, b) => a.swing - b.swing);
      const worst = rates[0]!;
      const best = rates[rates.length - 1]!;
      const wins = flat.filter((o) => o.win);

      console.log(
        `  ${character.id.padEnd(8)}` +
          pct((wins.length / flat.length) * 100) +
          pct(mean(flat.map((o) => damageShare(o, character.id)))) +
          mean(flat.map((o) => o.detail?.damage[character.id] ?? 0)).toFixed(0).padStart(9) +
          mean(flat.map((o) => o.detail?.downs[character.id] ?? 0)).toFixed(2).padStart(7) +
          pct(mean(wins.map((o) => o.hpLeft * 100))).padStart(9) +
          `   ${worst.teamId} ${worst.swing.toFixed(0)} / ${best.teamId} +${best.swing.toFixed(0)}` +
          `\n${''.padEnd(12)}plays: ${playsOf(flat, character.id)}`
      );
    }

    // ── Marlo ──
    await compareVariants(
      'marlo',
      [
        { name: 'default' },
        { name: 'debuffs', cards: { 'marlo.demoralize': 2, 'marlo.expose': 2, 'marlo.resupply': 1, 'marlo.rally': 1, 'marlo.fortify': 1 } },
        { name: 'buffs', cards: { 'marlo.rally': 3, 'marlo.fortify': 2, 'marlo.expose': 1, 'marlo.resupply': 1 } },
        { name: 'balanced', cards: { 'marlo.rally': 2, 'marlo.fortify': 1, 'marlo.demoralize': 1, 'marlo.expose': 2, 'marlo.resupply': 1 } },
        { name: 'debuffs, Resupply at 40', cards: { 'marlo.demoralize': 2, 'marlo.expose': 2, 'marlo.resupply': 1, 'marlo.rally': 1, 'marlo.fortify': 1 }, cardOverrides: { 'marlo.resupply': { staminaCost: 40 } } },
      ],
      field
    );

    // ── Ignis ──
    await compareVariants(
      'ignis',
      [
        { name: 'default' },
        { name: 'no Barrage', cards: { 'ignis.fireball': 4, 'ignis.firebolt': 2 } },
        { name: 'Barrage at 40', cardOverrides: { 'ignis.barrage': { staminaCost: 40 } } },
      ],
      field
    );

    console.log('');
  });
});
