/**
 * Draw pile / hand / discard movement. Pure — returns new pile objects.
 *
 * All three equipped characters' decks are shuffled into a single shared pile,
 * with each card still tagged by its owner. One hand, one discard, one reshuffle.
 */

import { shuffle } from './rng';
import type { CardInstanceId } from './types';

export interface Piles {
  drawPile: CardInstanceId[];
  hand: CardInstanceId[];
  discardPile: CardInstanceId[];
  seed: number;
}

/**
 * Moves the discard pile back into the draw pile and shuffles it.
 *
 * Cards in hand are untouched — they're still in play, so a reshuffle mid-turn
 * must not scoop them up.
 */
export function reshuffleDiscardIntoDraw(piles: Piles): Piles {
  if (piles.discardPile.length === 0) return { ...piles };

  const shuffled = shuffle([...piles.drawPile, ...piles.discardPile], piles.seed);

  return {
    drawPile: shuffled.items,
    hand: [...piles.hand],
    discardPile: [],
    seed: shuffled.seed,
  };
}

/**
 * Draws up to `count` cards, reshuffling the discard when the draw pile runs dry.
 *
 * Draws fewer than asked if both piles are exhausted, rather than looping
 * forever — with a small deck and a big hand that state is genuinely reachable.
 */
export function drawCards(piles: Piles, count: number): Piles {
  let current: Piles = {
    drawPile: [...piles.drawPile],
    hand: [...piles.hand],
    discardPile: [...piles.discardPile],
    seed: piles.seed,
  };

  for (let i = 0; i < count; i++) {
    if (current.drawPile.length === 0) {
      if (current.discardPile.length === 0) break; // nothing left anywhere
      current = reshuffleDiscardIntoDraw(current);
    }

    const card = current.drawPile.shift();
    if (card === undefined) break;
    current.hand.push(card);
  }

  return current;
}

/** Moves one card from hand to discard. No-op if it isn't in hand. */
export function discardFromHand(piles: Piles, instanceId: CardInstanceId): Piles {
  const index = piles.hand.indexOf(instanceId);
  if (index === -1) return { ...piles };

  const hand = [...piles.hand];
  hand.splice(index, 1);

  return {
    drawPile: [...piles.drawPile],
    hand,
    discardPile: [...piles.discardPile, instanceId],
    seed: piles.seed,
  };
}

/**
 * Brings the hand to exactly `limit` by drawing, when it is short.
 *
 * An over-full hand is *not* trimmed here — that requires the player to choose
 * which cards to lose, so the engine parks in the `discarding` phase instead.
 */
export function refillHandTo(piles: Piles, limit: number): Piles {
  const shortfall = limit - piles.hand.length;
  return shortfall > 0 ? drawCards(piles, shortfall) : { ...piles };
}
