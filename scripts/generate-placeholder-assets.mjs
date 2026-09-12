/**
 * Generates placeholder art and a Tiled-format map so the repo runs on a fresh
 * clone without shipping binary assets nobody intends to keep.
 *
 * Run: npm run assets:placeholder
 *
 * Replace the outputs with real art whenever you like — the map is genuine Tiled
 * JSON, so you can open public/assets/tilemaps/overworld.json in Tiled directly,
 * edit it, and re-export over the top.
 *
 * No dependencies: PNGs are encoded by hand with node:zlib.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── PNG encoding ────────────────────────────────────────────────────────────

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes RGBA pixel data (width*height*4 bytes) as a PNG buffer. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with a filter-type byte; 0 means "none".
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createCanvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  return {
    width,
    height,
    data,
    set(x, y, [r, g, b, a = 255]) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    },
    rect(x0, y0, w, h, colour) {
      for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) this.set(x, y, colour);
      }
    },
  };
}

// ── Tileset ─────────────────────────────────────────────────────────────────

const TILE = 32;

/** Local tile ids, in the order they're drawn into the strip below. */
const TILES = {
  GRASS: 0,
  WATER: 1,
  WALL: 2,
  FLOOR: 3,
};
const TILE_COUNT = 4;

function buildTileset() {
  const canvas = createCanvas(TILE * TILE_COUNT, TILE);

  const palette = {
    [TILES.GRASS]: [[74, 124, 89], [86, 138, 100]],
    [TILES.WATER]: [[58, 92, 140], [70, 108, 158]],
    [TILES.WALL]: [[92, 88, 100], [116, 110, 124]],
    [TILES.FLOOR]: [[150, 132, 106], [162, 146, 120]],
  };

  for (let id = 0; id < TILE_COUNT; id++) {
    const [base, accent] = palette[id];
    const ox = id * TILE;
    canvas.rect(ox, 0, TILE, TILE, base);

    // A deterministic speckle so tiles read as textured rather than flat, and so
    // the grid is visible while blocking out level design.
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if ((x * 7 + y * 13 + id * 31) % 11 === 0) canvas.set(ox + x, y, accent);
      }
    }

    // Walls get a lit top edge and a dark base so elevation reads at a glance.
    if (id === TILES.WALL) {
      canvas.rect(ox, 0, TILE, 4, [140, 134, 148]);
      canvas.rect(ox, TILE - 5, TILE, 5, [58, 55, 64]);
    }
  }

  return encodePng(canvas.width, canvas.height, canvas.data);
}

// ── Player spritesheet ──────────────────────────────────────────────────────

const PLAYER_W = 24;
const PLAYER_H = 32;

/**
 * Four frames in one row, ordered to match the `Facing` union in
 * src/game/systems/movement.ts: down, up, left, right.
 */
function buildPlayerSheet() {
  const canvas = createCanvas(PLAYER_W * 4, PLAYER_H);

  const body = [206, 92, 74];
  const bodyDark = [168, 68, 56];
  const skin = [235, 197, 162];
  const hair = [58, 44, 40];
  const eye = [28, 26, 32];

  for (let frame = 0; frame < 4; frame++) {
    const ox = frame * PLAYER_W;

    canvas.rect(ox + 4, 14, 16, 13, body); // torso
    canvas.rect(ox + 4, 25, 16, 2, bodyDark); // shadow under torso
    canvas.rect(ox + 5, 27, 5, 5, bodyDark); // legs
    canvas.rect(ox + 14, 27, 5, 5, bodyDark);
    canvas.rect(ox + 5, 3, 14, 12, skin); // head
    canvas.rect(ox + 5, 3, 14, 4, hair); // hair

    // Eyes only on the frames where the character faces the camera or in profile.
    if (frame === 0) {
      canvas.rect(ox + 8, 9, 2, 2, eye);
      canvas.rect(ox + 14, 9, 2, 2, eye);
    } else if (frame === 2) {
      canvas.rect(ox + 7, 9, 2, 2, eye);
    } else if (frame === 3) {
      canvas.rect(ox + 15, 9, 2, 2, eye);
    } else {
      canvas.rect(ox + 5, 3, 14, 8, hair); // back of head
    }
  }

  return encodePng(canvas.width, canvas.height, canvas.data);
}

// ── Combatant spritesheet ───────────────────────────────────────────────────

// [body, trim, skin, width, height] — width/height in pixels of the torso block.
// Order must match COMBATANT_FRAMES in `src/game/assets.ts`.
const FIGURES = [
  // ── The party ──
  [[96, 148, 104], [150, 196, 140], [236, 212, 180], 18, 24], // Ivy, slight chemist
  [[186, 66, 74], [230, 120, 110], [235, 197, 162], 20, 26], // Saber, lean assassin
  [[74, 104, 156], [126, 158, 200], [226, 190, 158], 30, 26], // Cask, broad gunner
  [[150, 122, 176], [190, 166, 214], [238, 214, 196], 18, 25], // Lyra, poised bard
  [[186, 138, 62], [222, 178, 96], [228, 186, 150], 32, 28], // Bruno, heavy bruiser
  [[110, 116, 128], [156, 162, 176], [220, 200, 180], 34, 30], // Hollis, slab of a man
  [[72, 96, 168], [124, 152, 216], [232, 214, 190], 18, 26], // Emrys, robed mage
  [[124, 40, 60], [186, 74, 96], [226, 210, 214], 20, 26], // Vesper, pale vampire
  [[86, 132, 148], [130, 180, 196], [224, 206, 186], 32, 28], // Thane, shield-bearer

  // ── The bestiary ──
  [[104, 122, 78], [138, 156, 104], [128, 140, 92], 34, 34], // Ogre, hulking
  [[128, 92, 156], [172, 132, 200], [186, 150, 210], 16, 18], // Imp, tiny
  [[138, 110, 74], [176, 148, 104], [196, 172, 140], 15, 17], // Ratkin, small and quick
  [[98, 104, 112], [142, 150, 162], [116, 122, 132], 36, 32], // Bulwark, a wall with legs
  [[164, 156, 118], [206, 200, 164], [222, 206, 178], 17, 23], // Acolyte, slight attendant
  [[92, 126, 118], [134, 174, 164], [200, 192, 170], 22, 25], // Sapper, wiry leech
  [[196, 178, 120], [228, 214, 168], [230, 214, 190], 20, 26], // Cantor, gilded singer
  [[112, 128, 156], [158, 176, 204], [210, 196, 178], 31, 29], // Warden, armoured guard
  [[88, 52, 72], [140, 88, 116], [188, 172, 176], 26, 30], // Revenant, gaunt and tall
  [[118, 106, 96], [158, 146, 132], [176, 168, 152], 19, 22], // Ghoul, stooped
  [[86, 70, 128], [130, 110, 180], [198, 184, 206], 21, 26], // Hexweaver, hooded
  [[150, 60, 52], [200, 104, 88], [206, 178, 156], 36, 34], // Tyrant, enormous
  [[84, 108, 72], [124, 154, 104], [170, 182, 140], 35, 33], // Broodmother, bloated
  [[142, 132, 88], [184, 176, 124], [198, 190, 148], 13, 14], // Chitterling, smallest thing here
];

const COMBATANT_W = 48;
const COMBATANT_H = 56;

/**
 * One frame per kind of combatant, in the order COMBATANT_FRAMES expects — the
 * nine party members, then every enemy archetype in the bestiary.
 *
 * Silhouettes differ in bulk and height as well as colour, so a fight reads
 * apart at a glance on a phone screen rather than relying on hue alone. That
 * matters more among the enemies than the party: a Warden and a Cantor stand
 * side by side and the player has to know which one to kill first.
 *
 * Keep the order in step with COMBATANT_FRAMES in `src/game/assets.ts`. A
 * mismatch is silent — the arena falls back to frame 0 and draws the enemy as
 * Ivy — so there is a test asserting every archetype has a frame.
 */
function buildCombatantSheet() {
  const canvas = createCanvas(COMBATANT_W * FIGURES.length, COMBATANT_H);

  FIGURES.forEach(([body, trim, skin, bodyW, bodyH], index) => {
    const ox = index * COMBATANT_W;
    const centre = ox + Math.floor(COMBATANT_W / 2);

    const headR = Math.max(5, Math.floor(bodyW / 3));
    const bodyTop = COMBATANT_H - bodyH - 4;
    const headTop = bodyTop - headR * 2;

    // Contact shadow — grounds the figure so it doesn't float over the floor.
    for (let x = -bodyW; x <= bodyW; x++) {
      const halfWidth = bodyW * 0.7;
      if (Math.abs(x) > halfWidth) continue;
      const t = 1 - Math.abs(x) / halfWidth;
      if (t > 0.15) canvas.set(centre + x, COMBATANT_H - 3, [0, 0, 0, 70]);
      if (t > 0.5) canvas.set(centre + x, COMBATANT_H - 2, [0, 0, 0, 50]);
    }

    canvas.rect(centre - Math.floor(bodyW / 2), bodyTop, bodyW, bodyH, body);
    canvas.rect(centre - Math.floor(bodyW / 2), bodyTop, bodyW, 3, trim);
    canvas.rect(centre - Math.floor(bodyW / 2), bodyTop + bodyH - 4, bodyW, 4, [
      Math.floor(body[0] * 0.6),
      Math.floor(body[1] * 0.6),
      Math.floor(body[2] * 0.6),
    ]);

    canvas.rect(centre - headR, headTop, headR * 2, headR * 2, skin);
    canvas.rect(centre - headR, headTop, headR * 2, 3, trim);

    // Eyes, one pixel pair, dark enough to read at any size.
    canvas.rect(centre - headR + 2, headTop + headR, 2, 2, [26, 24, 30]);
    canvas.rect(centre + headR - 4, headTop + headR, 2, 2, [26, 24, 30]);
  });

  return encodePng(canvas.width, canvas.height, canvas.data);
}

// ── Tiled map ───────────────────────────────────────────────────────────────

const MAP_W = 40;
const MAP_H = 30;

function buildMap() {
  const ground = new Array(MAP_W * MAP_H).fill(TILES.GRASS + 1);
  const walls = new Array(MAP_W * MAP_H).fill(0);

  const at = (x, y) => y * MAP_W + x;

  // Solid geometry, as [x, y]. Drawn as walls on `ground` AND marked on the
  // invisible `walls` mask below — except the lake, which is drawn as water but
  // is just as impassable.
  const obstacles = [
    [16, 8], [17, 8], [18, 8],
    [16, 9], [18, 9],
    [16, 10], [17, 10], [18, 10],
    [24, 18], [25, 18], [26, 18],
    [8, 20], [9, 20], [10, 20], [11, 20],
    [30, 22], [31, 22], [30, 23], [31, 23],
  ];
  const isObstacle = new Set(obstacles.map(([x, y]) => at(x, y)));

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = at(x, y);
      const inLake = x > 27 && x < 36 && y > 3 && y < 10;
      const onBorder = x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1;
      const solid = inLake || onBorder || isObstacle.has(i);

      // ── Visuals: everything the player sees comes from this layer, which is
      // the one rendered as a GPU layer. It never needs a collision lookup.
      if (x > 3 && x < 12 && y > 3 && y < 11) ground[i] = TILES.FLOOR + 1; // courtyard
      if (inLake) ground[i] = TILES.WATER + 1;
      if (onBorder || isObstacle.has(i)) ground[i] = TILES.WALL + 1;

      // ── Collision: a plain mask, kept invisible. Splitting it this way means
      // the visible layer can be a single GPU quad while collision still works
      // per-tile, and the lake can look like water while blocking like stone.
      if (solid) walls[i] = TILES.WALL + 1;
    }
  }

  const layer = (id, name, data, extra = {}) => ({
    data,
    height: MAP_H,
    id,
    name,
    opacity: 1,
    type: 'tilelayer',
    visible: true,
    width: MAP_W,
    x: 0,
    y: 0,
    ...extra,
  });

  return {
    compressionlevel: -1,
    height: MAP_H,
    infinite: false,
    layers: [
      layer(1, 'ground', ground),
      // Invisible collision mask. Flip `visible` to true (or set arcade
      // physics.debug) when you need to see what's actually solid.
      layer(2, 'walls', walls, { visible: false }),
      {
        draworder: 'topdown',
        id: 3,
        name: 'objects',
        objects: [
          {
            gid: 0,
            height: 32,
            id: 1,
            name: 'spawn',
            point: false,
            rotation: 0,
            type: 'spawn',
            visible: true,
            width: 32,
            x: 7 * 32,
            y: 7 * 32,
          },
          {
            height: 32,
            id: 2,
            name: 'signpost',
            properties: [
              { name: 'speaker', type: 'string', value: 'Signpost' },
              {
                name: 'text',
                type: 'string',
                value: 'North: the lake.|East: nothing but grass.|You should add more here.',
              },
            ],
            rotation: 0,
            type: 'interactable',
            visible: true,
            width: 32,
            x: 10 * 32,
            y: 9 * 32,
          },
        ],
        opacity: 1,
        type: 'objectgroup',
        visible: true,
        x: 0,
        y: 0,
      },
    ],
    nextlayerid: 4,
    nextobjectid: 3,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.0',
    tileheight: TILE,
    tilesets: [
      {
        columns: TILE_COUNT,
        firstgid: 1,
        image: 'tileset.png',
        imageheight: TILE,
        imagewidth: TILE * TILE_COUNT,
        margin: 0,
        name: 'terrain',
        spacing: 0,
        tilecount: TILE_COUNT,
        tileheight: TILE,
        tilewidth: TILE,
        // The `collides` property is what WorldScene keys collision off, via
        // setCollisionByProperty. Set it in Tiled under the tile's Custom
        // Properties if you add more solid tiles.
        tiles: [
          { id: TILES.WALL, properties: [{ name: 'collides', type: 'bool', value: true }] },
        ],
      },
    ],
    tilewidth: TILE,
    type: 'map',
    version: '1.10',
    width: MAP_W,
  };
}

// ── Write everything ────────────────────────────────────────────────────────

function write(relativePath, contents) {
  const full = resolve(root, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents);
  const size = Buffer.isBuffer(contents) ? contents.length : Buffer.byteLength(contents);
  console.log(`  ${relativePath}  (${size.toLocaleString()} bytes)`);
}

console.log('Generating placeholder assets...');
write('public/assets/tilemaps/tileset.png', buildTileset());
write('public/assets/tilemaps/overworld.json', JSON.stringify(buildMap(), null, 1));
write('public/assets/sprites/player.png', buildPlayerSheet());
write('public/assets/sprites/combatants.png', buildCombatantSheet());
console.log('Done.');
