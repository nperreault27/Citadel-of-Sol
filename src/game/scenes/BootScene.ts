import Phaser from 'phaser';
import { EventBus } from '@/bridge/EventBus';
import { gameStore } from '@/state/store';

/**
 * First scene. Deliberately loads nothing.
 *
 * Its only job is to hand control to PreloadScene as fast as possible so React
 * can swap the boot splash for a real progress bar. Anything loaded here happens
 * before the player sees any feedback at all, so it stays empty.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create(): void {
    gameStore.getState().setPhase('loading');
    EventBus.emit('preload:progress', { progress: 0 });
    this.scene.start('PreloadScene');
  }
}
