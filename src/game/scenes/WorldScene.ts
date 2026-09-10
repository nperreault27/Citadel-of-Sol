import Phaser from 'phaser';
import { EventBus } from '@/bridge/EventBus';
import { gameStore, toSaveData } from '@/state/store';
import { saveService } from '@/save';
import { CURRENT_SAVE_VERSION } from '@/save/schema';
import { getInitialPlayer } from '@/save/session';
import { AssetKeys, PLAYER_FRAMES } from '../assets';
import { CAMERA_ZOOM, PLAYER_SPEED, TILE_SIZE } from '../config';
import { axesToVelocity, velocityToFacing, type Facing } from '../systems/movement';
import {
  tileInFront,
  tileToWorldCenter,
  tilesEqual,
  worldToTile,
  type TileCoord,
} from '../systems/grid';
import { findPath } from '../systems/pathfinding';

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

  /** Remaining waypoints of the current click-to-move path. */
  private path: TileCoord[] = [];
  /** Blocked lookup, flattened to `y * width + x`, built once from the map. */
  private blocked: boolean[] = [];
  private mapWidthTiles = 0;
  private mapHeightTiles = 0;
  private moveMarker?: Phaser.GameObjects.Arc;
  /** Interactable to talk to once the current path finishes. */
  private pendingInteract: TileCoord | null = null;

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

    this.buildBlockedGrid(map, collisionLayer);
    this.createPlayer(map);
    this.physics.add.collider(this.player, collisionLayer);

    this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.cameras.main.setZoom(CAMERA_ZOOM);
    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    this.player.setCollideWorldBounds(true);

    this.collectInteractables(map);
    this.wireEvents();
    this.wireClickToMove();

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
      EventBus.on('arena:enter', () => {
        // `switch` sleeps this scene instead of shutting it down, so the map,
        // the player's position and every listener survive until they return.
        this.stopMoving();
        this.scene.switch('ArenaScene');
      })
    );

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

  /** Precomputes which tiles are solid, so pathfinding never calls into Phaser. */
  private buildBlockedGrid(
    map: Phaser.Tilemaps.Tilemap,
    collisionLayer: Phaser.Tilemaps.TilemapLayer
  ): void {
    this.mapWidthTiles = map.width;
    this.mapHeightTiles = map.height;
    this.blocked = new Array<boolean>(map.width * map.height).fill(false);

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = collisionLayer.getTileAt(x, y);
        this.blocked[y * map.width + x] = tile !== null && tile.collides;
      }
    }
  }

  private isPassable = (tileX: number, tileY: number): boolean => {
    if (tileX < 0 || tileY < 0 || tileX >= this.mapWidthTiles || tileY >= this.mapHeightTiles) {
      return false;
    }
    return !this.blocked[tileY * this.mapWidthTiles + tileX];
  };

  /** Tap anywhere walkable to path there. */
  private wireClickToMove(): void {
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      const state = gameStore.getState();

      // A tap while a dialog is open advances it instead of issuing a move —
      // otherwise the player walks away mid-conversation.
      if (state.dialog) {
        state.advanceDialog();
        return;
      }

      if (state.phase !== 'playing') return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const goal = worldToTile({ x: world.x, y: world.y }, TILE_SIZE);
      const from = worldToTile({ x: this.player.x, y: this.player.y }, TILE_SIZE);

      const path = findPath(
        from,
        goal,
        this.isPassable,
        this.mapWidthTiles,
        this.mapHeightTiles
      );

      if (path.length === 0) return;

      this.showMoveMarker(goal);

      // A tap on something interactable walks up to it and then talks, so the
      // player never has to line up a facing by hand. Stop one tile short —
      // the target tile is where the object is standing.
      const hit = this.interactables.find((entry) => tilesEqual(entry.tile, goal));
      this.pendingInteract = hit ? goal : null;
      this.path = hit ? path.slice(0, -1) : path;

      // Already adjacent: nothing to walk, so talk immediately.
      if (this.pendingInteract && this.path.length === 0) this.arriveAtInteractable();
    });
  }

  /** Faces the pending interactable and opens its dialog. */
  private arriveAtInteractable(): void {
    const target = this.pendingInteract;
    this.pendingInteract = null;
    if (!target) return;

    const from = worldToTile({ x: this.player.x, y: this.player.y }, TILE_SIZE);
    this.faceToward(from, target);
    this.tryInteract();
  }

  private faceToward(from: TileCoord, to: TileCoord): void {
    const dx = to.tileX - from.tileX;
    const dy = to.tileY - from.tileY;
    if (dx === 0 && dy === 0) return;

    const facing: Facing =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';

    this.facing = facing;
    this.player.setFrame(PLAYER_FRAMES[facing]);
  }

  private showMoveMarker(tile: TileCoord): void {
    const centre = tileToWorldCenter(tile, TILE_SIZE);

    this.moveMarker?.destroy();
    this.moveMarker = this.add.circle(centre.x, centre.y, 5, 0xd8a657, 0.9);

    this.tweens.add({
      targets: this.moveMarker,
      alpha: 0,
      scale: 2,
      duration: 420,
      onComplete: () => this.moveMarker?.destroy(),
    });
  }

  private stopMoving(): void {
    this.path = [];
    this.player.setVelocity(0, 0);
  }

  /**
   * Steers toward the next waypoint.
   *
   * Waypoints are tile centres, and a waypoint counts as reached within a few
   * pixels — testing for exact equality would overshoot and jitter, since the
   * sprite moves by a fractional distance each frame.
   */
  private followPath(): void {
    const next = this.path[0];
    if (!next) {
      this.player.setVelocity(0, 0);
      return;
    }

    const target = tileToWorldCenter(next, TILE_SIZE);
    const dx = target.x - this.player.x;
    const dy = target.y - this.player.y;

    if (Math.hypot(dx, dy) <= 3) {
      this.path.shift();
      if (this.path.length === 0) {
        this.player.setVelocity(0, 0);
        this.arriveAtInteractable();
      }
      return;
    }

    const velocity = axesToVelocity(dx, dy, PLAYER_SPEED);
    this.player.setVelocity(velocity.x, velocity.y);
  }

  override update(): void {
    if (gameStore.getState().phase !== 'playing') {
      this.stopMoving();
      return;
    }

    this.followPath();
    const velocity = { x: this.player.body.velocity.x, y: this.player.body.velocity.y };

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
