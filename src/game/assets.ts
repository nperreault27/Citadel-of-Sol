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

/**
 * Which frame of `combatants.png` each kind of combatant uses.
 *
 * Keyed by archetype, falling back to id for the player's characters, who have
 * none — so four Ratkin are one entry, not four. Keep in step with the figure
 * list in `scripts/generate-placeholder-assets.mjs`, which generates the sheet
 * these indices point into.
 */
export const COMBATANT_FRAMES: Record<string, number> = {
  ivy: 0,
  saber: 1,
  cask: 2,
  lyra: 3,
  bruno: 4,
  hollis: 5,
  emrys: 6,
  vesper: 7,
  thane: 8,

  ogre: 9,
  imp: 10,
  ratkin: 11,
  bulwark: 12,
  acolyte: 13,
  sapper: 14,
  cantor: 15,
  warden: 16,
  revenant: 17,
  ghoul: 18,
  hexweaver: 19,
  tyrant: 20,
  broodmother: 21,
  chitterling: 22,
};

/**
 * The sprite key for a combatant: its kind if it has one, else itself.
 *
 * Everything drawing a combatant goes through here, so a new enemy needs one
 * frame entry rather than one per instance on the field.
 */
export function frameFor(combatant: { id: string; archetype?: string }): number {
  return COMBATANT_FRAMES[combatant.archetype ?? combatant.id] ?? 0;
}

/** Frame dimensions of the player spritesheet, one frame per facing. */
export const PLAYER_FRAME = { width: 24, height: 32 } as const;

/** Frame index per facing, matching the order frames are drawn in the sheet. */
export const PLAYER_FRAMES = {
  down: 0,
  up: 1,
  left: 2,
  right: 3,
} as const;
