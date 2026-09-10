/**
 * A* over the tile grid. Pure — no Phaser import, no DOM.
 *
 * Needed because movement is click-to-move: without a real path, tapping past a
 * wall walks the player straight into it and they stick there. Four-directional
 * to match the `Facing` model — diagonal steps would need corner-cutting rules
 * and produce facings the sprite sheet has no frame for.
 */

import type { TileCoord } from './grid';

/** Returns true if a tile can be walked on. */
export type Passable = (tileX: number, tileY: number) => boolean;

interface Node {
  tileX: number;
  tileY: number;
  /** Cost from the start. */
  g: number;
  /** g + heuristic. */
  f: number;
  parent: Node | null;
}

const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** Manhattan distance — admissible for 4-directional movement with uniform cost. */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Finds a walkable path from `start` to `goal`, excluding the start tile.
 *
 * Returns an empty array when the goal is unreachable or is the start itself.
 * `maxNodes` bounds the search so a tap on an enclosed area can't stall a frame
 * on a large map.
 */
export function findPath(
  start: TileCoord,
  goal: TileCoord,
  passable: Passable,
  width: number,
  height: number,
  maxNodes = 4000
): TileCoord[] {
  if (start.tileX === goal.tileX && start.tileY === goal.tileY) return [];
  if (!inBounds(goal, width, height) || !passable(goal.tileX, goal.tileY)) return [];

  const open: Node[] = [
    {
      tileX: start.tileX,
      tileY: start.tileY,
      g: 0,
      f: heuristic(start.tileX, start.tileY, goal.tileX, goal.tileY),
      parent: null,
    },
  ];

  const seen = new Map<number, number>(); // tile index → best known g
  seen.set(index(start.tileX, start.tileY, width), 0);

  let expanded = 0;

  while (open.length > 0 && expanded < maxNodes) {
    // Linear scan for the lowest f. A binary heap would be faster, but on a map
    // this size the scan is not measurable and this is far easier to read.
    let bestAt = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i]!.f < open[bestAt]!.f) bestAt = i;
    }

    const current = open.splice(bestAt, 1)[0]!;
    expanded++;

    if (current.tileX === goal.tileX && current.tileY === goal.tileY) {
      return reconstruct(current);
    }

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = current.tileX + dx;
      const ny = current.tileY + dy;

      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (!passable(nx, ny)) continue;

      const g = current.g + 1;
      const key = index(nx, ny, width);
      const known = seen.get(key);
      if (known !== undefined && known <= g) continue;

      seen.set(key, g);
      open.push({
        tileX: nx,
        tileY: ny,
        g,
        f: g + heuristic(nx, ny, goal.tileX, goal.tileY),
        parent: current,
      });
    }
  }

  return [];
}

function reconstruct(node: Node): TileCoord[] {
  const path: TileCoord[] = [];
  let current: Node | null = node;

  while (current && current.parent) {
    path.push({ tileX: current.tileX, tileY: current.tileY });
    current = current.parent;
  }

  return path.reverse();
}

function index(x: number, y: number, width: number): number {
  return y * width + x;
}

function inBounds(tile: TileCoord, width: number, height: number): boolean {
  return tile.tileX >= 0 && tile.tileY >= 0 && tile.tileX < width && tile.tileY < height;
}
