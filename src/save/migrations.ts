import { DEFAULT_PARTY, LEGACY_DEFAULT_DECK } from '@/game/combat/content';
import { CURRENT_SAVE_VERSION } from './schema';

/**
 * A migration takes the save shape at version N and returns the shape at N+1.
 *
 * They run on *unvalidated* data — a save written by an older build won't match
 * today's schema, which is the whole reason migrations exist. So the input is
 * `unknown` and each migration is responsible for its own narrowing. Validation
 * happens once, after the chain has finished.
 */
export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated *from*.
 *
 * When the save shape changes:
 *   1. Bump CURRENT_SAVE_VERSION in schema.ts
 *   2. Add an entry here keyed by the version being migrated away from
 *
 * Never edit an existing migration once a build carrying it has shipped — some
 * player out there has a save that depends on it behaving exactly as it did.
 */
export const migrations: Record<number, Migration> = {
  /** v2 added the equipped party. Saves from v1 get the starting three. */
  1: (data) => ({ ...data, party: [...DEFAULT_PARTY] }),

  /**
   * v3 added the player-built deck. An existing save gets the fixed deck it was
   * already effectively playing, rather than an empty one that cannot fight.
   */
  2: (data) => ({ ...data, deck: { ...LEGACY_DEFAULT_DECK } }),
};

/**
 * Runs a save forward through every migration between its version and the
 * current one. Returns null if the chain is broken or the data is unusable, in
 * which case the caller falls back to a fresh save rather than crashing.
 */
export function migrateToCurrent(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }

  let data = raw as Record<string, unknown>;
  const startVersion = data['version'];

  if (typeof startVersion !== 'number' || !Number.isInteger(startVersion) || startVersion < 1) {
    return null;
  }

  // A save from a *newer* build than the one running (user downgraded, or synced
  // an APK backup) cannot be migrated backwards. Refuse rather than corrupt it.
  if (startVersion > CURRENT_SAVE_VERSION) {
    return null;
  }

  let version = startVersion;
  while (version < CURRENT_SAVE_VERSION) {
    const migration = migrations[version];
    if (!migration) {
      // Gap in the chain — a version was bumped without a migration added.
      return null;
    }
    data = migration(data);
    version += 1;
    data['version'] = version;
  }

  return data;
}
