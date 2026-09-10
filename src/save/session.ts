import type { SaveData } from './schema';

/**
 * Holds the player's spawn transform between the bootstrap save load and
 * WorldScene creating the sprite.
 *
 * Player position deliberately isn't in the Zustand store (it changes every
 * frame; see the rule in state/store.ts), and Phaser's `create()` can't
 * reliably await an async load — so the save is read once during bootstrap,
 * before the game mounts, and parked here for the scene to pick up.
 */
let initialPlayer: SaveData['player'] | null = null;

export function setInitialPlayer(player: SaveData['player']): void {
  initialPlayer = player;
}

export function getInitialPlayer(): SaveData['player'] | null {
  return initialPlayer;
}
