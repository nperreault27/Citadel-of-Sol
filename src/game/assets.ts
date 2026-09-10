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
} as const;

export const AssetPaths = {
  tileset: 'tilemaps/tileset.png',
  tilemap: 'tilemaps/overworld.json',
  player: 'sprites/player.png',
} as const;

/** Frame dimensions of the player spritesheet, one frame per facing. */
export const PLAYER_FRAME = { width: 24, height: 32 } as const;

/** Frame index per facing, matching the order frames are drawn in the sheet. */
export const PLAYER_FRAMES = {
  down: 0,
  up: 1,
  left: 2,
  right: 3,
} as const;
