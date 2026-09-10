import Phaser from 'phaser';
import { EventBus } from '@/bridge/EventBus';
import { AssetKeys, AssetPaths, PLAYER_FRAME, assetUrl } from '../assets';

/**
 * Loads every asset the world needs, reporting progress up to React.
 *
 * The progress bar itself is a React component, not drawn in Phaser — that keeps
 * the loading UI stylable in CSS alongside the rest of the interface instead of
 * being hand-drawn with Graphics.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.PROGRESS, (progress: number) => {
      EventBus.emit('preload:progress', { progress });
    });

    // A missing asset otherwise fails silently and the world boots half-empty,
    // which is a confusing thing to debug on a device.
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.error(`[preload] failed to load "${file.key}" from ${file.url}`);
    });

    this.load.image(AssetKeys.tileset, assetUrl(AssetPaths.tileset));
    this.load.tilemapTiledJSON(AssetKeys.tilemap, assetUrl(AssetPaths.tilemap));
    this.load.spritesheet(AssetKeys.player, assetUrl(AssetPaths.player), {
      frameWidth: PLAYER_FRAME.width,
      frameHeight: PLAYER_FRAME.height,
    });
  }

  create(): void {
    EventBus.emit('preload:progress', { progress: 1 });
    EventBus.emit('preload:complete');
    this.scene.start('WorldScene');
  }
}
