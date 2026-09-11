import { z } from 'zod';
import { DEFAULT_PARTY } from '@/game/combat/content';

/**
 * Bump this whenever the save shape changes, and add a matching entry to
 * `migrations.ts`. See that file for the contract.
 */
export const CURRENT_SAVE_VERSION = 3;

export const saveDataSchema = z.object({
  version: z.number().int().positive(),
  savedAt: z.number().int().nonnegative(),

  player: z.object({
    /** World pixel position — restored directly into the Phaser sprite. */
    x: z.number(),
    y: z.number(),
    facing: z.enum(['up', 'down', 'left', 'right']),
    health: z.number().int().nonnegative(),
    maxHealth: z.number().int().positive(),
  }),

  /** Ids of the equipped party, in display order. */
  party: z.array(z.string().min(1)),

  /** The player's deck, as card definition id to number of copies. */
  deck: z.record(z.string().min(1), z.number().int().positive()),

  world: z.object({
    mapKey: z.string().min(1),
    /** Ids of one-shot things already consumed (chests opened, NPCs talked to). */
    visitedFlags: z.array(z.string()),
  }),

  inventory: z.array(
    z.object({
      itemId: z.string().min(1),
      quantity: z.number().int().positive(),
    })
  ),
});

export type SaveData = z.infer<typeof saveDataSchema>;

/** The save handed to a brand-new player, and the fallback for an unreadable one. */
export function createNewSave(): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    savedAt: Date.now(),
    player: {
      x: 160,
      y: 160,
      facing: 'down',
      health: 10,
      maxHealth: 10,
    },
    party: [...DEFAULT_PARTY],
    // New saves build their deck from nothing.
    deck: {},
    world: {
      mapKey: 'overworld',
      visitedFlags: [],
    },
    inventory: [],
  };
}
