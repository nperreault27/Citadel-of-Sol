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
  PARTY_SIZE,
  ROSTER,
  characterById,
  defaultDeck,
} from '@/game/combat/content';
import type { Combatant, CombatState } from '@/game/combat/types';

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
 * Same greedy AI as the other probe, so the same caveat: it plays the first
 * affordable card at the first legal target, and its win rate is a *ceiling on
 * how easy* a fight is rather than a measure of how hard.
 *
 * Asserts nothing. Run with `npm run balance`.
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

    // selectCard: the first card that can be paid for, else pass.
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

  return parties.filter((p) => p.length === PARTY_SIZE);
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

describe('encounter probe', () => {
  it('reports how much the party matters, team by team', () => {
    const parties = everyParty();

    console.log(`\n  ${parties.length} parties x ${SEEDS} seeds per team\n`);
    console.log(
      '  team                  tier    win%    spread   best party                 worst party'
    );

    for (const team of ENEMY_TEAMS) {
      const scored = parties.map((party) => {
        let wins = 0;
        for (let seed = 1; seed <= SEEDS; seed++) {
          if (playOut(fight(party, team.members, seed)).phase === 'victory') wins++;
        }
        return { party: party.join('+'), rate: (wins / SEEDS) * 100 };
      });

      scored.sort((a, b) => b.rate - a.rate);

      const best = scored[0]!;
      const worst = scored[scored.length - 1]!;
      const overall = scored.reduce((sum, row) => sum + row.rate, 0) / scored.length;

      console.log(
        `  ${team.name.padEnd(22)}${String(team.tier).padEnd(6)}` +
          `${overall.toFixed(1).padStart(6)}%` +
          `${(best.rate - worst.rate).toFixed(1).padStart(9)}   ` +
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
        const mean = rows.reduce((sum, row) => sum + row.rate, 0) / rows.length;
        return { id: character.id, delta: mean - overall };
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
