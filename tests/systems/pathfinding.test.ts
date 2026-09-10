import { describe, expect, it } from 'vitest';
import { findPath } from '@/game/systems/pathfinding';
import type { TileCoord } from '@/game/systems/grid';

/**
 * Builds a passability function from ASCII art. '#' is solid, anything else is
 * walkable — far easier to read than nested arrays of booleans.
 */
function grid(rows: string[]) {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;

  const passable = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    return rows[y]?.[x] !== '#';
  };

  return { passable, width, height };
}

const at = (tileX: number, tileY: number): TileCoord => ({ tileX, tileY });

describe('findPath', () => {
  it('walks a straight line across open ground', () => {
    const { passable, width, height } = grid(['.....', '.....', '.....']);
    const path = findPath(at(0, 0), at(4, 0), passable, width, height);

    expect(path).toHaveLength(4);
    expect(path.at(-1)).toEqual(at(4, 0));
  });

  it('excludes the start tile from the path', () => {
    const { passable, width, height } = grid(['...']);
    const path = findPath(at(0, 0), at(2, 0), passable, width, height);

    expect(path[0]).toEqual(at(1, 0));
  });

  it('returns an empty path when already at the goal', () => {
    const { passable, width, height } = grid(['...']);
    expect(findPath(at(1, 0), at(1, 0), passable, width, height)).toEqual([]);
  });

  it('routes around a wall', () => {
    const { passable, width, height } = grid([
      '.....',
      '.###.',
      '.....',
    ]);
    const path = findPath(at(0, 1), at(4, 1), passable, width, height);

    expect(path.length).toBeGreaterThan(0);
    expect(path.at(-1)).toEqual(at(4, 1));
    // Never steps onto a solid tile.
    expect(path.every((tile) => passable(tile.tileX, tile.tileY))).toBe(true);
  });

  it('finds the shortest route around an obstacle', () => {
    const { passable, width, height } = grid([
      '.....',
      '..#..',
      '.....',
    ]);
    // Manhattan distance is 4, but the blocked tile forces a step out of the
    // row and back into it, so the shortest legal route is 6.
    expect(findPath(at(0, 1), at(4, 1), passable, width, height)).toHaveLength(6);
  });

  it('takes the direct route when nothing is in the way', () => {
    const { passable, width, height } = grid(['.....', '.....', '.....']);
    expect(findPath(at(0, 1), at(4, 1), passable, width, height)).toHaveLength(4);
  });

  it('returns nothing when the goal is solid', () => {
    const { passable, width, height } = grid(['.#.']);
    expect(findPath(at(0, 0), at(1, 0), passable, width, height)).toEqual([]);
  });

  it('returns nothing when the goal is walled off', () => {
    // This is the case that makes pathfinding worth having: without it, a tap
    // inside the enclosure walks the player into the wall and sticks there.
    const { passable, width, height } = grid([
      '.....',
      '.###.',
      '.#.#.',
      '.###.',
      '.....',
    ]);
    expect(findPath(at(0, 0), at(2, 2), passable, width, height)).toEqual([]);
  });

  it('returns nothing for an out-of-bounds goal', () => {
    const { passable, width, height } = grid(['...']);
    expect(findPath(at(0, 0), at(9, 9), passable, width, height)).toEqual([]);
  });

  it('produces a path where every step is orthogonally adjacent', () => {
    const { passable, width, height } = grid([
      '......',
      '.####.',
      '......',
      '.####.',
      '......',
    ]);
    const path = findPath(at(0, 0), at(5, 4), passable, width, height);
    expect(path.length).toBeGreaterThan(0);

    let previous = at(0, 0);
    for (const step of path) {
      const distance =
        Math.abs(step.tileX - previous.tileX) + Math.abs(step.tileY - previous.tileY);
      expect(distance).toBe(1);
      previous = step;
    }
  });

  it('gives up rather than hanging when the search budget runs out', () => {
    const rows = Array.from({ length: 60 }, () => '.'.repeat(60));
    const { passable, width, height } = grid(rows);

    expect(findPath(at(0, 0), at(59, 59), passable, width, height, 10)).toEqual([]);
  });
});
