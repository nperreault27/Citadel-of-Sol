import { describe, it } from 'vitest';
import {
  canPlayCard,
  cardDefOf,
  createCombat,
  endPlayerTurn,
  legalTargets,
  resolveEnemyTurn,
  resolveSelection,
  selectCard,
  chooseTarget,
  confirmDiscard,
} from '@/game/combat/engine';
import { expandDeck } from '@/game/combat/deckbuilding';
import {
  COMBAT_CONTENT,
  ENEMY_TEAMS,
  ROSTER,
  characterById,
  defaultDeck,
} from '@/game/combat/content';
import type { Combatant, CombatState } from '@/game/combat/types';

/**
 * Who is carrying, character by character and fight by fight.
 *
 * The encounter probe next door asks whether each *team* poses a different
 * question, and prints only the three characters who answer it best and the
 * three who answer it worst. This prints the whole grid, because the rows it
 * leaves out are where a character quietly doing nothing hides: a roster where
 * six of nine sit between -1 and +1 is flat, and no top-three list will say so.
 *
 * Each cell is that character's swing: the average win rate of the 28 parties
 * containing them, as a difference from that fight's average across all 84. So
 * `+15` reads as "bring them and you win fifteen points more often than the
 * field does". MEAN averages the row; win% is the raw average the swing is
 * measured from, for when the absolute number matters more than the gap.
 *
 * Read the shape, not the digits. Two useful shapes:
 *   - a high MEAN with a flat row is a character who is simply better, and
 *   - a low MEAN with one big cell is a specialist, which is the good kind of
 *     outlier — it means that fight has an answer rather than a difficulty.
 *
 * Same greedy AI as the other probes: it plays the first affordable card at the
 * first legal target. That systematically undersells anyone whose value is in
 * sequencing — buff first, then hit — so treat the bottom of the table as a
 * ceiling on how bad those characters are, not a measurement.
 *
 * Asserts nothing. Run with `npm run swing`, or `npm run balance` for this and
 * the other two probes together.
 */

const SEEDS = 30;

function playOut(state: CombatState): CombatState {
  let current = state;

  for (let i = 0; i < 300; i++) {
    if (current.phase === 'victory' || current.phase === 'defeat') break;

    if (current.phase === 'selecting') {
      const choice = current.selection?.cards[0];
      if (!choice) break;
      current = resolveSelection(current, choice);
      continue;
    }

    if (current.phase === 'discarding') {
      const toss = current.hand.slice(0, Math.max(1, current.hand.length - current.handLimit));
      current = confirmDiscard(current, COMBAT_CONTENT, toss);
      continue;
    }

    if (current.phase === 'enemyTurn') {
      current = resolveEnemyTurn(current, COMBAT_CONTENT);
      continue;
    }

    if (current.phase === 'selectTarget') {
      const targets = current.pendingCard
        ? legalTargets(current, COMBAT_CONTENT, current.pendingCard)
        : [];
      const first = targets[0];
      current = first
        ? chooseTarget(current, COMBAT_CONTENT, first)
        : endPlayerTurn(current, COMBAT_CONTENT);
      continue;
    }

    const playable = current.hand.find(
      (id) => cardDefOf(current, COMBAT_CONTENT, id) && canPlayCard(current, COMBAT_CONTENT, id).ok
    );

    current = playable
      ? selectCard(current, COMBAT_CONTENT, playable)
      : endPlayerTurn(current, COMBAT_CONTENT);
  }

  return current;
}

function everyParty(): string[][] {
  const parties: string[][] = [];
  const ids = ROSTER.map((c) => c.id);

  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      for (let c = b + 1; c < ids.length; c++) {
        parties.push([ids[a]!, ids[b]!, ids[c]!]);
      }
    }
  }

  return parties;
}

/** A battle between one party and one team, bypassing the hardcoded arena. */
function fight(party: string[], enemies: Combatant[], seed: number): CombatState {
  const roster = party
    .map(characterById)
    .filter((character): character is Combatant => character !== undefined);

  return createCombat({
    combatants: [...roster, ...enemies],
    deck: expandDeck(defaultDeck(party)),
    seed,
  });
}

const mean = (xs: readonly number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(0)}`;

describe('swing probe', () => {
  it('reports every character against every team', () => {
    const parties = everyParty();
    const ids = ROSTER.map((c) => c.id);

    const swing: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
    const absolute: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));

    for (const team of ENEMY_TEAMS) {
      const scored = parties.map((party) => {
        let wins = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
          if (playOut(fight(party, team.members, seed)).phase === 'victory') wins++;
        }
        return { party, rate: (wins / SEEDS) * 100 };
      });

      const overall = mean(scored.map((row) => row.rate));

      for (const id of ids) {
        const withThem = mean(scored.filter((row) => row.party.includes(id)).map((row) => row.rate));
        swing[id]!.push(withThem - overall);
        absolute[id]!.push(withThem);
      }
    }

    console.log(`\n  ${parties.length} parties x ${SEEDS} seeds per team\n`);

    // Four characters of each team name, with a leading "The" dropped first —
    // six of the nine teams have one, and abbreviating those to "The" names
    // nothing. Short enough that the grid fits a terminal without wrapping.
    const head = ENEMY_TEAMS.map((team) =>
      team.name.replace(/^The /, '').slice(0, 4).padStart(6)
    ).join('');
    console.log(`  ${'char'.padEnd(8)}${head}${'MEAN'.padStart(8)}${'win%'.padStart(8)}`);

    const ranked = [...ids].sort((a, b) => mean(swing[b]!) - mean(swing[a]!));

    for (const id of ranked) {
      const cells = swing[id]!.map((delta) => signed(delta).padStart(6)).join('');
      const row = mean(swing[id]!);

      console.log(
        `  ${id.padEnd(8)}${cells}` +
          `${row >= 0 ? '+' : ''}${row.toFixed(1)}`.padStart(8) +
          `${mean(absolute[id]!).toFixed(1)}%`.padStart(8)
      );
    }

    const spread = mean(swing[ranked[0]!]!) - mean(swing[ranked[ranked.length - 1]!]!);
    console.log(`\n  top to bottom: ${spread.toFixed(1)} points\n`);
  });
});
