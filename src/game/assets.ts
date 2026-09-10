/**
 * Asset keys and URLs.
 *
 * Assets live in `public/` and are fetched by Phaser's loader at runtime — they
 * are deliberately NOT `import`ed. Phaser's loader takes URLs, so routing art
 * through Vite's asset pipeline (which rewrites imports to hashed filenames)
 * would mean hand-threading every hashed URL into the loader for no benefit.
 *
 * Every URL goes through `assetUrl` so it respects Vite's `base`. With
 * `base: './'` for Capacitor, `import.meta.env.BASE_URL` is `./` — hardcoding a
 * leading `/` here is exactly the mistake that 404s inside the Android WebView
 * while working fine in the dev server.
 */

export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  const normalisedBase = base.endsWith('/') ? base : `${base}/`;
  const normalisedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalisedBase}assets/${normalisedPath}`;
}

export const AssetKeys = {
  tileset: 'terrain',
  tilemap: 'overworld',
  player: 'player',
  combatants: 'combatants',
} as const;

export const AssetPaths = {
  tileset: 'tilemaps/tileset.png',
  tilemap: 'tilemaps/overworld.json',
  player: 'sprites/player.png',
  combatants: 'sprites/combatants.png',
} as const;

/** Frame size of the arena combatant sheet. */
export const COMBATANT_FRAME = { width: 48, height: 56 } as const;

/** Which frame of `combatants.png` each combatant uses. */
export const COMBATANT_FRAMES: Record<string, number> = {
  ivy: 0,
  saber: 1,
  cask: 2,
  ogre: 3,
  imp1: 4,
  // Both imps share a frame; only their ids differ.
  imp2: 4,
};

/** Frame dimensions of the player spritesheet, one frame per facing. */
export const PLAYER_FRAME = { width: 24, height: 32 } as const;

/** Frame index per facing, matching the order frames are drawn in the sheet. */
export const PLAYER_FRAMES = {
  down: 0,
  up: 1,
  left: 2,
  right: 3,
} as const;
