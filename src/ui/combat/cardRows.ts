import type { CSSProperties } from 'react';

/**
 * Cards on a row before it splits.
 *
 * Five is the hand limit, and five is also about as narrow as a card can get on
 * a phone before it stops being worth looking at.
 */
const CARDS_PER_ROW = 5;

/** Columns for `count` cards: even rows, never more than `CARDS_PER_ROW` wide. */
export function cardColumns(count: number): number {
  if (count <= CARDS_PER_ROW) return Math.max(count, 1);
  return Math.ceil(count / Math.ceil(count / CARDS_PER_ROW));
}

/**
 * Class and style for a row of cards.
 *
 * Draw effects push the hand past its limit mid-turn, so a row can never assume
 * five. Shrinking to fit whatever arrives ends in slivers, and scrolling the
 * overflow off the side of a phone is worse — an off-screen card is one the
 * player has effectively lost. So an over-full row splits into even rows
 * instead: six cards deal as 3 + 3, not 5 + 1.
 *
 * The column count goes to CSS as a custom property and the cards size
 * themselves off it. Nothing here measures the screen.
 */
export function cardRowProps(
  baseClass: string,
  count: number
): { className: string; style: CSSProperties } {
  const columns = cardColumns(count);
  const split = columns < count;

  return {
    className: `${baseClass} card-row${split ? ' card-row--split' : ''}`,
    style: { '--card-cols': columns } as CSSProperties,
  };
}
