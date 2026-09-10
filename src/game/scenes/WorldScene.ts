import Phaser from 'phaser';
import { EventBus } from '@/bridge/EventBus';
import { inputState } from '@/bridge/inputState';
import { gameStore, toSaveData } from '@/state/store';
import { saveService } from '@/save';
import { CURRENT_SAVE_VERSION } from '@/save/schema';
import { getInitialPlayer } from '@/save/session';
import { AssetKeys, PLAYER_FRAMES } from '../assets';
import { CAMERA_ZOOM, PLAYER_SPEED, TILE_SIZE } from '../config';
import { axesToVelocity, velocityToFacing, type Facing } from '../systems/movement';
import { tileInFront, tilesEqual, worldToTile, type TileCoord } from '../systems/grid';

interface Interactable {
  tile: TileCoord;
  speaker: string;
  lines: string[];
}

export class WorldScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private facing: Facing = 'down';
  private lastTile: TileCoord = { tileX: -1, tileY: -1 };
  private interactables: Interactable[] = [];
  private teardown: Array<() => void> = [];

  constructor() {
    super({ key: 'WorldScene' });
  }

  create(): void {
    const map = this.make.tilemap({ key: AssetKeys.tilemap });
    const tileset = map.addTilesetImage('terrain', AssetKeys.tileset);

    if (!tileset) {
      // Almost always a name mismatch: the first argument must match the
      // tileset's `name` inside the Tiled JSON, not the image filename.
      console.error('[world] tileset "terrain" not found in map');
      return;
    }

    // Everything visible is one GPU layer — Phaser 4 renders it as a single quad
    // whose cost is fixed per screen pixel rather than per visible tile. That is
    // the single biggest rendering win available to a scrolling tile map on a
    // mid-range phone.
    map.createLayer('ground', tileset, 0, 0, true);

    // Collision comes from a separate, invisible plain layer. A GPU layer is one
    // quad and can't answer per-tile collision queries, so the two concerns are
    // split: this one is never drawn, only consulted.
    const collisionLayer = map.createLayer('walls', tileset, 0, 0, false);

    if (!(collisionLayer instanceof Phaser.Tilemaps.TilemapLayer)) {
      console.error('[world] expected a standard TilemapLayer for collision');
      return;
    }

    collisionLayer.setVisible(false);
    collisionLayer.setCollisionByProperty({ collides: true });

    this.createPlayer(map);
    this.physics.add.collider(this.player, collisionLayer);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.setCollideWorldBounds(true);

    this.collectInteractables(map);
    this.wireEvents();

    gameStore.getState().setPhase('playing');
    EventBus.emit('world:ready', { mapKey: gameStore.getState().mapKey });
  }

  private createPlayer(map: Phaser.Tilemaps.Tilemap): void {
    const saved = getInitialPlayer();
    const spawn = saved ?? this.findSpawnPoint(map);

    this.player = this.physics.add.sprite(
      spawn.x,
      spawn.y,
      AssetKeys.player,
      PLAYER_FRAMES.down
    );

    if (saved) {
      this.facing = saved.facing;
      this.player.setFrame(PLAYER_FRAMES[saved.facing]);
    }

    // The physics body covers the feet only, not the full 24x32 sprite. A
    // top-down character whose head collides with walls feels wrong — the head
    // should visually overlap the wall above it.
    this.player.body.setSize(16, 10);
    this.player.body.setOffset(4, 21);

    this.lastTile = worldToTile({ x: this.player.x, y: this.player.y }, TILE_SIZE);
  }

  /** Reads the `spawn` object from the Tiled object layer, with a fallback. */
  private findSpawnPoint(map: Phaser.Tilemaps.Tilemap): { x: number; y: number } {
    const objects = map.getObjectLayer('objects')?.objects ?? [];
    const spawn = objects.find((object) => object.name === 'spawn');

    if (spawn?.x !== undefined && spawn.y !== undefined) {
      // Tiled anchors rectangle objects at their top-left; offset to the centre
      // so the sprite lands in the middle of the tile rather than on its corner.
      return { x: spawn.x + TILE_SIZE / 2, y: spawn.y + TILE_SIZE / 2 };
    }

    return { x: TILE_SIZE * 2, y: TILE_SIZE * 2 };
  }

  private collectInteractables(map: Phaser.Tilemaps.Tilemap): void {
    const objects = map.getObjectLayer('objects')?.objects ?? [];

    this.interactables = objects
      .filter((object) => object.type === 'interactable')
      .map((object) => {
        const properties = readTiledProperties(object);
        const text = typeof properties['text'] === 'string' ? properties['text'] : '';
        const speaker = typeof properties['speaker'] === 'string' ? properties['speaker'] : '';

        return {
          tile: worldToTile({ x: object.x ?? 0, y: object.y ?? 0 }, TILE_SIZE),
          speaker,
          // Pipe-separated because Tiled's string property editor is single-line.
          lines: text.split('|').map((line) => line.trim()).filter(Boolean),
        };
      })
      .filter((entry) => entry.lines.length > 0);
  }

  private wireEvents(): void {
    this.teardown.push(EventBus.on('ui:action-pressed', () => this.tryInteract()));

    this.teardown.push(
      EventBus.on('ui:request-save', () => {
        void saveService.saveNow(this.currentSave());
      })
    );

    this.teardown.push(
      EventBus.on('ui:pause', () => {
        this.physics.pause();
        gameStore.getState().setPhase('paused');
        // Pausing is the most reliable "player is about to leave" signal there
        // is, so force any debounced write out now.
        void saveService.flush();
      })
    );

    this.teardown.push(
      EventBus.on('ui:resume', () => {
        this.physics.resume();
        gameStore.getState().setPhase('playing');
      })
    );

    // Autosave whenever durable state changes. The store only changes on
    // discrete events, and the service debounces, so this stays cheap.
    this.teardown.push(
      gameStore.subscribe((state, previous) => {
        if (
          state.health !== previous.health ||
          state.inventory !== previous.inventory ||
          state.visitedFlags !== previous.visitedFlags
        ) {
          saveService.saveDebounced(this.currentSave());
        }
      })
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const dispose of this.teardown) dispose();
      this.teardown = [];
      void saveService.flush();
    });
  }

  private currentSave() {
    return toSaveData(
      { x: this.player.x, y: this.player.y, facing: this.facing },
      CURRENT_SAVE_VERSION
    );
  }

  private tryInteract(): void {
    const state = gameStore.getState();

    // An action press while a dialog is open advances it rather than starting a
    // new conversation.
    if (state.dialog) {
      state.advanceDialog();
      return;
    }

    if (state.phase !== 'playing') return;

    const playerTile = worldToTile({ x: this.player.x, y: this.player.y }, TILE_SIZE);
    const target = tileInFront(playerTile, this.facing);

    // Accept the tile the player stands on as well as the one ahead — on a phone,
    // requiring exact facing alignment for a tap is needlessly fiddly.
    const hit = this.interactables.find(
      (entry) => tilesEqual(entry.tile, target) || tilesEqual(entry.tile, playerTile)
    );

    if (!hit) return;

    state.openDialog(hit.speaker, hit.lines);
    EventBus.emit('dialog:open', { speaker: hit.speaker, lines: hit.lines });
  }

  override update(): void {
    if (gameStore.getState().phase !== 'playing') {
      this.player.setVelocity(0, 0);
      return;
    }

    const velocity = axesToVelocity(inputState.moveX, inputState.moveY, PLAYER_SPEED);
    this.player.setVelocity(velocity.x, velocity.y);

    const nextFacing = velocityToFacing(velocity, this.facing);
    if (nextFacing !== this.facing) {
      this.facing = nextFacing;
      this.player.setFrame(PLAYER_FRAMES[nextFacing]);
    }

    // Tile crossings are a discrete event, so they're safe to send across the
    // boundary. Position itself never is — this fires a handful of times a
    // second at walking speed, not 60.
    const tile = worldToTile({ x: this.player.x, y: this.player.y }, TILE_SIZE);
    if (!tilesEqual(tile, this.lastTile)) {
      this.lastTile = tile;
      EventBus.emit('player:moved-tile', tile);
    }
  }
}

/** Flattens Tiled's `[{name, type, value}]` property array into a lookup. */
function readTiledProperties(
  object: Phaser.Types.Tilemaps.TiledObject
): Record<string, unknown> {
  const raw = object.properties;
  if (!Array.isArray(raw)) return {};

  const result: Record<string, unknown> = {};
  for (const entry of raw as Array<{ name?: string; value?: unknown }>) {
    if (typeof entry?.name === 'string') result[entry.name] = entry.value;
  }
  return result;
}
