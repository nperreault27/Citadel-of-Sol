/**
 * Tile/world coordinate conversion. Pure — no Phaser import.
 *
 * Phaser's tilemap API offers equivalents, but keeping our own means gameplay
 * rules (what tile is the player on, what's in front of them) can be unit tested
 * and reasoned about without instantiating a Tilemap.
 */

import type { Facing, Vector2 } from './movement';

export interface TileCoord {
  tileX: number;
  tileY: number;
}

/** World pixel position → the tile containing it. */
export function worldToTile(world: Vector2, tileSize: number): TileCoord {
  return {
    tileX: Math.floor(world.x / tileSize),
    tileY: Math.floor(world.y / tileSize),
  };
}

/** Tile coordinate → the world pixel position of that tile's centre. */
export function tileToWorldCenter(tile: TileCoord, tileSize: number): Vector2 {
  return {
    x: tile.tileX * tileSize + tileSize / 2,
    y: tile.tileY * tileSize + tileSize / 2,
  };
}

/** The tile directly in front of an entity — the interaction target. */
export function tileInFront(origin: TileCoord, facing: Facing): TileCoord {
  switch (facing) {
    case 'up':
      return { tileX: origin.tileX, tileY: origin.tileY - 1 };
    case 'down':
      return { tileX: origin.tileX, tileY: origin.tileY + 1 };
    case 'left':
      return { tileX: origin.tileX - 1, tileY: origin.tileY };
    case 'right':
      return { tileX: origin.tileX + 1, tileY: origin.tileY };
  }
}

export function tilesEqual(a: TileCoord, b: TileCoord): boolean {
  return a.tileX === b.tileX && a.tileY === b.tileY;
}

/** Manhattan distance in tiles — the right metric for 4-directional grid movement. */
export function tileDistance(a: TileCoord, b: TileCoord): number {
  return Math.abs(a.tileX - b.tileX) + Math.abs(a.tileY - b.tileY);
}

export function isWithinBounds(tile: TileCoord, widthInTiles: number, heightInTiles: number): boolean {
  return (
    tile.tileX >= 0 && tile.tileY >= 0 && tile.tileX < widthInTiles && tile.tileY < heightInTiles
  );
}
