import type { CardDefId, CardDefinition, CardTier, CombatantId } from './types';

/**
 * Deck construction rules. Pure — no Phaser, no React, no store, and crucially
 * no import from `content.ts`, which would be circular since content builds
 * battles from decks. Card definitions are passed in the same way the engine
 * takes its `CombatContent`.
 */

/** A deck as counts, which is what the builder edits and the save stores. */
export type DeckList = Record<CardDefId, number>;

export type CardDefs = Record<CardDefId, CardDefinition>;

/**
 * Copies of one card a deck may hold.
 *
 * For a character with three cards these sum to exactly CARDS_PER_CHARACTER, so
 * maxing everything is precisely spending the budget. Hollis, with four cards,
 * can reach nine and therefore has to cut — he is the only one who does.
 */
export const COPY_LIMITS: Record<CardTier, number> = {
  basic: 4,
  special: 2,
  unique: 1,
};

/** Cards any one character may contribute. */
export const CARDS_PER_CHARACTER = 7;

/** Smallest legal deck. There is deliberately no upper bound. */
export const MIN_DECK_SIZE = 20;

export function copyLimit(card: CardDefinition): number {
  return COPY_LIMITS[card.tier];
}

/**
 * Every card the player may currently put in a deck.
 *
 * This is the seam for the planned discovery system: today it returns
 * everything the equipped characters own plus the neutrals, and later it
 * intersects that with whatever has actually been found. Nothing else in the
 * codebase needs to know that changed.
 *
 * Ordered by party slot, then neutrals, so the builder renders in a stable
 * order rather than whatever order the record happens to enumerate in.
 */
export function availableCards(
  cardDefs: CardDefs,
  party: readonly CombatantId[]
): CardDefinition[] {
  const all = Object.values(cardDefs);
  const owned: CardDefinition[] = [];

  for (const characterId of party) {
    owned.push(...all.filter((card) => card.ownerId === characterId));
  }

  return [...owned, ...all.filter((card) => card.ownerId === null)];
}

export function deckSize(deck: DeckList): number {
  return Object.values(deck).reduce((sum, count) => sum + Math.max(0, count), 0);
}

/** Cards in the deck belonging to one character, against their 7 budget. */
export function countForCharacter(
  cardDefs: CardDefs,
  deck: DeckList,
  characterId: CombatantId
): number {
  let total = 0;
  for (const [cardId, count] of Object.entries(deck)) {
    if (cardDefs[cardId]?.ownerId === characterId) total += Math.max(0, count);
  }
  return total;
}

export interface AddCheck {
  ok: boolean;
  /**
   * Why not, as a tag rather than only prose.
   *
   * The two caps need different treatment in the UI: hitting a card's own copy
   * limit is a fact about that card and belongs on it, while spending a
   * character's budget is a fact about the character and belongs in their
   * section header. String-matching the message to tell them apart would be
   * fragile.
   */
  blockedBy?: 'copyLimit' | 'characterBudget' | 'notInParty' | 'unknownCard';
  reason?: string;
}

/**
 * Whether one more copy may be added, and if not, why.
 *
 * Returning the reason rather than a bare boolean is what lets the builder
 * disable a button *and* say what is blocking it, instead of going mysteriously
 * dead when a cap is hit.
 */
export function canAddCopy(
  cardDefs: CardDefs,
  deck: DeckList,
  party: readonly CombatantId[],
  cardId: CardDefId
): AddCheck {
  const card = cardDefs[cardId];
  if (!card) return { ok: false, blockedBy: 'unknownCard', reason: 'Unknown card' };

  if (card.ownerId !== null && !party.includes(card.ownerId)) {
    return { ok: false, blockedBy: 'notInParty', reason: 'Not in your party' };
  }

  const held = Math.max(0, deck[cardId] ?? 0);
  const limit = copyLimit(card);
  if (held >= limit) {
    return { ok: false, blockedBy: 'copyLimit', reason: `Limit ${limit} (${card.tier})` };
  }

  if (card.ownerId !== null) {
    const used = countForCharacter(cardDefs, deck, card.ownerId);
    if (used >= CARDS_PER_CHARACTER) {
      return {
        ok: false,
        blockedBy: 'characterBudget',
        reason: `${CARDS_PER_CHARACTER} card limit`,
      };
    }
  }

  return { ok: true };
}

export interface DeckValidation {
  ok: boolean;
  /** Human-readable, shown directly in the builder. */
  problems: string[];
}

/**
 * Checks a whole deck.
 *
 * Reports every problem rather than the first, so the builder can list what is
 * wrong all at once instead of revealing issues one at a time as each is fixed.
 */
export function validateDeck(
  cardDefs: CardDefs,
  deck: DeckList,
  party: readonly CombatantId[]
): DeckValidation {
  const problems: string[] = [];

  for (const [cardId, rawCount] of Object.entries(deck)) {
    const count = Math.max(0, rawCount);
    if (count === 0) continue;

    const card = cardDefs[cardId];
    if (!card) {
      problems.push(`Unknown card: ${cardId}`);
      continue;
    }

    if (card.ownerId !== null && !party.includes(card.ownerId)) {
      problems.push(`${card.name} belongs to someone not in your party`);
    }

    const limit = copyLimit(card);
    if (count > limit) {
      problems.push(`${card.name}: ${count} copies, limit ${limit}`);
    }
  }

  for (const characterId of party) {
    const used = countForCharacter(cardDefs, deck, characterId);
    if (used > CARDS_PER_CHARACTER) {
      problems.push(`${characterId}: ${used} cards, limit ${CARDS_PER_CHARACTER}`);
    }
  }

  const size = deckSize(deck);
  if (size < MIN_DECK_SIZE) {
    problems.push(`Deck has ${size} cards, needs at least ${MIN_DECK_SIZE}`);
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Drops cards whose owner is no longer equipped.
 *
 * Called whenever the party changes, so benching someone removes their cards
 * immediately rather than leaving an invalid deck to be discovered at the
 * Fight button.
 */
export function pruneToParty(
  cardDefs: CardDefs,
  deck: DeckList,
  party: readonly CombatantId[]
): DeckList {
  const pruned: DeckList = {};

  for (const [cardId, count] of Object.entries(deck)) {
    if (count <= 0) continue;

    const card = cardDefs[cardId];
    if (!card) continue;
    if (card.ownerId !== null && !party.includes(card.ownerId)) continue;

    pruned[cardId] = count;
  }

  return pruned;
}

/**
 * Turns counts into the flat list the engine shuffles.
 *
 * Sorted by card id, because object key order is an implementation detail and
 * a battle must be reproducible from its seed. Two decks with the same contents
 * built in a different order have to produce the same shuffle.
 */
export function expandDeck(deck: DeckList): CardDefId[] {
  const expanded: CardDefId[] = [];

  for (const cardId of Object.keys(deck).sort()) {
    const count = Math.max(0, deck[cardId] ?? 0);
    for (let i = 0; i < count; i++) expanded.push(cardId);
  }

  return expanded;
}

/**
 * Fills every equipped character to their cap, plus all the neutrals.
 *
 * Deliberately not used by the builder, where characters start empty and the
 * player picks every card. This exists so the balance probe and integration
 * tests can build a full legal deck without hand-writing card counts.
 */
export function defaultDeckFor(cardDefs: CardDefs, party: readonly CombatantId[]): DeckList {
  const deck: DeckList = {};

  for (const card of availableCards(cardDefs, party)) {
    const check = canAddCopy(cardDefs, deck, party, card.id);
    if (!check.ok) continue;

    let count = 0;
    while (canAddCopy(cardDefs, deck, party, card.id).ok) {
      count += 1;
      deck[card.id] = count;
    }
  }

  return deck;
}
