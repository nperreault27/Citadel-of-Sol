import { describe, expect, it } from 'vitest';
import {
  isWithinBounds,
  tileDistance,
  tileInFront,
  tileToWorldCenter,
  tilesEqual,
  worldToTile,
} from '@/game/systems/grid';

describe('worldToTile', () => {
  it('maps a position to its containing tile', () => {
    expect(worldToTile({ x: 0, y: 0 }, 32)).toEqual({ tileX: 0, tileY: 0 });
    expect(worldToTile({ x: 31.9, y: 31.9 }, 32)).toEqual({ tileX: 0, tileY: 0 });
    expect(worldToTile({ x: 32, y: 64 }, 32)).toEqual({ tileX: 1, tileY: 2 });
  });

  it('floors toward negative infinity outside the map', () => {
    // Truncation instead of flooring would map -1 and 1 to the same tile.
    expect(worldToTile({ x: -1, y: -1 }, 32)).toEqual({ tileX: -1, tileY: -1 });
  });
});

describe('tileToWorldCenter', () => {
  it('returns the centre, not the corner', () => {
    expect(tileToWorldCenter({ tileX: 0, tileY: 0 }, 32)).toEqual({ x: 16, y: 16 });
    expect(tileToWorldCenter({ tileX: 2, tileY: 3 }, 32)).toEqual({ x: 80, y: 112 });
  });

  it('round-trips with worldToTile', () => {
    const tile = { tileX: 7, tileY: 11 };
    expect(worldToTile(tileToWorldCenter(tile, 32), 32)).toEqual(tile);
  });
});

describe('tileInFront', () => {
  const origin = { tileX: 5, tileY: 5 };

  it('steps one tile in the facing direction', () => {
    expect(tileInFront(origin, 'up')).toEqual({ tileX: 5, tileY: 4 });
    expect(tileInFront(origin, 'down')).toEqual({ tileX: 5, tileY: 6 });
    expect(tileInFront(origin, 'left')).toEqual({ tileX: 4, tileY: 5 });
    expect(tileInFront(origin, 'right')).toEqual({ tileX: 6, tileY: 5 });
  });

  it('treats up as decreasing y, matching screen coordinates', () => {
    expect(tileInFront(origin, 'up').tileY).toBeLessThan(origin.tileY);
  });
});

describe('tile helpers', () => {
  it('compares tiles by value', () => {
    expect(tilesEqual({ tileX: 1, tileY: 2 }, { tileX: 1, tileY: 2 })).toBe(true);
    expect(tilesEqual({ tileX: 1, tileY: 2 }, { tileX: 2, tileY: 1 })).toBe(false);
  });

  it('measures manhattan distance', () => {
    expect(tileDistance({ tileX: 0, tileY: 0 }, { tileX: 3, tileY: 4 })).toBe(7);
  });

  it('bounds-checks against map size', () => {
    expect(isWithinBounds({ tileX: 0, tileY: 0 }, 40, 30)).toBe(true);
    expect(isWithinBounds({ tileX: 39, tileY: 29 }, 40, 30)).toBe(true);
    expect(isWithinBounds({ tileX: 40, tileY: 29 }, 40, 30)).toBe(false);
    expect(isWithinBounds({ tileX: -1, tileY: 0 }, 40, 30)).toBe(false);
  });
});
