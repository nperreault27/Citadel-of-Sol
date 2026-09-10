import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { PreloadScene } from './scenes/PreloadScene';
import { WorldScene } from './scenes/WorldScene';
import { ArenaScene } from './scenes/ArenaScene';

/** World units per tile. Must match `tilewidth`/`tileheight` in the Tiled map. */
export const TILE_SIZE = 32;

/**
 * Camera zoom. The placeholder art is 32px tiles, which is tiny on a phone at
 * 1:1 — this scales the world up so a tile is a comfortable thumb target.
 */
export const CAMERA_ZOOM = 2.5;

export const PLAYER_SPEED = 140;

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0e14',

    scale: {
      // RESIZE over FIT: the canvas fills the parent at whatever size it is, so a
      // larger screen reveals more of the world instead of letterboxing a fixed
      // design resolution. Combined with CAMERA_ZOOM this gives a consistent
      // apparent tile size across devices.
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%',
    },

    // Nearest-neighbour sampling — without this the placeholder tiles blur into
    // mush when the camera zooms past 1:1.
    pixelArt: true,
    roundPixels: true,

    // NOTE ON DEVICE PIXEL RATIO: Phaser 4 has no `resolution` config option (it
    // was removed back in the v3 line and did not return). Under Scale.RESIZE the
    // backing canvas is sized in CSS pixels, so the game renders at 1x rather
    // than at the device's 3x DPR. That is the behaviour we want on mobile — it
    // is roughly a 9x reduction in fragment work versus rendering at native
    // density, and with pixelArt the difference is barely visible.

    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 }, // top-down: no gravity
        debug: false, // flip to true to see collision bodies
      },
    },

    render: {
      antialias: false,
    },

    // Only the first is started automatically; ArenaScene is entered via
    // `scene.switch`, which sleeps the overworld rather than destroying it, so
    // the player returns to exactly where they left.
    scene: [BootScene, PreloadScene, WorldScene, ArenaScene],
  };
}
