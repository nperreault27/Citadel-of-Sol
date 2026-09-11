import { createStore } from 'zustand/vanilla';
import { DEFAULT_PARTY, PARTY_SIZE, prunePlayerDeck } from '@/game/combat/content';
import type { DeckList } from '@/game/combat/deckbuilding';
import type { SaveData } from '@/save/schema';

/**
 * Durable game state, shared by both sides of the boundary.
 *
 * Built with zustand/vanilla rather than the React-flavoured `create`, so this
 * module imports no framework at all: Phaser reads it with `gameStore.getState()`
 * and writes through the actions below, while React subscribes via the
 * `useGameStore` hook in the sibling file.
 *
 * ── The rule that keeps this fast ──────────────────────────────────────────
 * Phaser must NEVER write to this store on a per-frame basis. Every write here
 * re-renders subscribed React components. Store writes are for discrete events
 * only — health changed, item gained, dialog opened.
 *
 * Continuous values (player x/y, velocity, camera scroll) stay inside Phaser and
 * are never mirrored here. They're read directly off the sprite at save time.
 */

export interface InventoryEntry {
  itemId: string;
  quantity: number;
}

export interface DialogState {
  speaker: string;
  lines: string[];
  lineIndex: number;
}

export interface GameState {
  // ── Lifecycle ──
  phase: 'booting' | 'loading' | 'playing' | 'paused';
  loadProgress: number;

  // ── Player ──
  health: number;
  maxHealth: number;

  // ── World ──
  mapKey: string;
  visitedFlags: string[];

  /** Ids of the three equipped characters. */
  party: string[];

  /** The player's deck, as card definition id to copies. */
  deck: DeckList;

  // ── Inventory ──
  inventory: InventoryEntry[];

  // ── UI ──
  dialog: DialogState | null;
  /** Set when a corrupt save was discarded, so the UI can tell the player. */
  saveWasReset: boolean;

  // ── Actions ──
  setPhase: (phase: GameState['phase']) => void;
  setLoadProgress: (progress: number) => void;
  setHealth: (current: number, max?: number) => void;
  damage: (amount: number) => void;
  heal: (amount: number) => void;
  addItem: (itemId: string, quantity?: number) => void;
  removeItem: (itemId: string, quantity?: number) => void;
  setFlag: (flag: string) => void;
  setParty: (party: string[]) => void;
  setDeck: (deck: DeckList) => void;
  hasFlag: (flag: string) => boolean;
  openDialog: (speaker: string, lines: string[]) => void;
  advanceDialog: () => void;
  closeDialog: () => void;
  hydrateFromSave: (save: SaveData, wasReset: boolean) => void;
}

export const gameStore = createStore<GameState>()((set, get) => ({
  phase: 'booting',
  loadProgress: 0,

  health: 10,
  maxHealth: 10,

  mapKey: 'overworld',
  visitedFlags: [],
  party: [...DEFAULT_PARTY],
  deck: {},

  inventory: [],

  dialog: null,
  saveWasReset: false,

  setPhase: (phase) => set({ phase }),

  setLoadProgress: (loadProgress) => set({ loadProgress }),

  setHealth: (current, max) =>
    set((state) => {
      const maxHealth = max ?? state.maxHealth;
      return { health: clamp(current, 0, maxHealth), maxHealth };
    }),

  damage: (amount) =>
    set((state) => ({ health: clamp(state.health - amount, 0, state.maxHealth) })),

  heal: (amount) => set((state) => ({ health: clamp(state.health + amount, 0, state.maxHealth) })),

  addItem: (itemId, quantity = 1) =>
    set((state) => {
      const existing = state.inventory.find((entry) => entry.itemId === itemId);
      if (!existing) {
        return { inventory: [...state.inventory, { itemId, quantity }] };
      }
      return {
        inventory: state.inventory.map((entry) =>
          entry.itemId === itemId ? { ...entry, quantity: entry.quantity + quantity } : entry
        ),
      };
    }),

  removeItem: (itemId, quantity = 1) =>
    set((state) => ({
      inventory: state.inventory
        .map((entry) =>
          entry.itemId === itemId ? { ...entry, quantity: entry.quantity - quantity } : entry
        )
        .filter((entry) => entry.quantity > 0),
    })),

  setFlag: (flag) =>
    set((state) =>
      state.visitedFlags.includes(flag)
        ? state
        : { visitedFlags: [...state.visitedFlags, flag] }
    ),

  hasFlag: (flag) => get().visitedFlags.includes(flag),

  setParty: (party) =>
    set((state) => {
      const next = party.slice(0, PARTY_SIZE);
      // Benching someone removes their cards straight away, rather than leaving
      // an invalid deck to be discovered at the Fight button.
      return { party: next, deck: prunePlayerDeck(state.deck, next) };
    }),

  setDeck: (deck) => set({ deck }),

  openDialog: (speaker, lines) => set({ dialog: { speaker, lines, lineIndex: 0 } }),

  advanceDialog: () =>
    set((state) => {
      if (!state.dialog) return state;
      const next = state.dialog.lineIndex + 1;
      // Past the last line closes the dialog, so the UI only needs one action
      // for "player tapped the dialog box".
      if (next >= state.dialog.lines.length) return { dialog: null };
      return { dialog: { ...state.dialog, lineIndex: next } };
    }),

  closeDialog: () => set({ dialog: null }),

  hydrateFromSave: (save, wasReset) =>
    set({
      health: save.player.health,
      maxHealth: save.player.maxHealth,
      mapKey: save.world.mapKey,
      visitedFlags: [...save.world.visitedFlags],
      party: save.party.length > 0 ? [...save.party] : [...DEFAULT_PARTY],
      deck: { ...save.deck },
      inventory: save.inventory.map((entry) => ({ ...entry })),
      saveWasReset: wasReset,
    }),
}));

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds the persistable slice of the save from store state.
 *
 * Player position is NOT in the store (see the rule above), so the caller — the
 * scene that owns the sprite — passes it in.
 */
export function toSaveData(
  position: { x: number; y: number; facing: SaveData['player']['facing'] },
  version: number
): SaveData {
  const state = gameStore.getState();

  return {
    version,
    savedAt: Date.now(),
    player: {
      x: position.x,
      y: position.y,
      facing: position.facing,
      health: state.health,
      maxHealth: state.maxHealth,
    },
    party: [...state.party],
    deck: { ...state.deck },
    world: {
      mapKey: state.mapKey,
      visitedFlags: [...state.visitedFlags],
    },
    inventory: state.inventory.map((entry) => ({ ...entry })),
  };
}
