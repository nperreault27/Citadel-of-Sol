import {
  COMBAT_CONTENT,
  ROSTER,
  characterById,
  defaultDeck,
} from '@/game/combat/content';
import { expandDeck, type DeckList } from '@/game/combat/deckbuilding';
import {
  cancelCardSelection,
  confirmDiscard,
  createCombat,
  endPlayerTurn,
  resolveCard,
  resolveEnemyTurn,
  resolveSelection,
} from '@/game/combat/engine';
import type {
  CardInstanceId,
  Combatant,
  CombatantId,
  CombatState,
} from '@/game/combat/types';

/**
 * The shared loop every probe and AI plays battles through.
 *
 * A policy only ever answers "what now?" for a phase that belongs to the
 * player. The loop owns the enemy turn and the guards, so no AI can stall a
 * battle or skip a rule by accident.
 */

export type Action =
  | { type: 'play'; card: CardInstanceId; target: CombatantId | null }
  | { type: 'endTurn' }
  | { type: 'select'; card: CardInstanceId }
  | { type: 'discard'; cards: CardInstanceId[] };

export interface Policy {
  choose(state: CombatState): Action;
}

/** Past this, a battle is a stalemate and counts as not won. */
const MAX_ROUNDS = 100;

/** Belt and braces against a policy that keeps choosing no-ops. */
const MAX_STEPS = 5000;

export function applyAction(state: CombatState, action: Action): CombatState {
  switch (action.type) {
    case 'play':
      return resolveCard(state, COMBAT_CONTENT, action.card, action.target);
    case 'endTurn':
      return endPlayerTurn(state, COMBAT_CONTENT);
    case 'select':
      return resolveSelection(state, action.card);
    case 'discard':
      return confirmDiscard(state, COMBAT_CONTENT, action.cards);
  }
}

export function isOver(state: CombatState): boolean {
  return state.phase === 'victory' || state.phase === 'defeat';
}

/** What to do when a policy's choice changed nothing, so the loop always advances. */
function fallback(state: CombatState): CombatState {
  switch (state.phase) {
    case 'selecting': {
      const card = state.selection?.cards[0];
      return card ? resolveSelection(state, card) : state;
    }
    case 'discarding':
      return confirmDiscard(
        state,
        COMBAT_CONTENT,
        state.hand.slice(0, state.hand.length - state.handLimit)
      );
    default:
      return endPlayerTurn(state, COMBAT_CONTENT);
  }
}

/**
 * Plays a battle to its end, or until `maxRounds` have been played — at which
 * point it stops wherever it is, and the battle counts as not won.
 */
export function playOut(state: CombatState, policy: Policy, maxRounds = MAX_ROUNDS): CombatState {
  let current = state;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (isOver(current) || current.round > maxRounds) break;

    if (current.phase === 'enemyTurn') {
      current = resolveEnemyTurn(current, COMBAT_CONTENT);
      continue;
    }

    if (current.phase === 'selectTarget') {
      current = cancelCardSelection(current);
      continue;
    }

    let next = applyAction(current, policy.choose(current));
    if (next === current) next = fallback(current);
    if (next === current) break;

    current = next;
  }

  return current;
}

/** Every distinct party of three, so no combination hides a broken card. */
export function everyParty(): string[][] {
  const ids = ROSTER.map((character) => character.id);
  const parties: string[][] = [];

  ids.forEach((a, i) => {
    ids.slice(i + 1).forEach((b, j) => {
      ids.slice(i + j + 2).forEach((c) => parties.push([a, b, c]));
    });
  });

  return parties;
}

/** A battle between one party, with its default deck unless given one, and one team. */
export function fight(
  party: readonly string[],
  enemies: Combatant[],
  seed: number,
  deck: DeckList = defaultDeck(party)
): CombatState {
  const roster = party
    .map(characterById)
    .filter((character): character is Combatant => character !== undefined);

  return createCombat({
    combatants: [...roster, ...enemies],
    deck: expandDeck(deck),
    seed,
  });
}
