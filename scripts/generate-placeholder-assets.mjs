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
console.log('Done.');
