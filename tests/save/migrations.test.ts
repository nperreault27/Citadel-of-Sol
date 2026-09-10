import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The live game is at save version 1, so the migration chain has nothing to run.
 * These tests mock the version constant and inject synthetic migrations, so the
 * machinery is proven *before* the first real schema change depends on it —
 * which is the only time a broken migration chain is cheap to discover.
 */
vi.mock('@/save/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/save/schema')>();
  return { ...actual, CURRENT_SAVE_VERSION: 3 };
});

const { migrateToCurrent, migrations } = await import('@/save/migrations');

afterEach(() => {
  for (const key of Object.keys(migrations)) delete migrations[Number(key)];
});

describe('migrateToCurrent', () => {
  it('rejects values that are not plain objects', () => {
    expect(migrateToCurrent(null)).toBeNull();
    expect(migrateToCurrent('save')).toBeNull();
    expect(migrateToCurrent([{ version: 1 }])).toBeNull();
  });

  it('rejects a missing or non-integer version', () => {
    expect(migrateToCurrent({})).toBeNull();
    expect(migrateToCurrent({ version: '1' })).toBeNull();
    expect(migrateToCurrent({ version: 1.5 })).toBeNull();
    expect(migrateToCurrent({ version: 0 })).toBeNull();
  });

  it('refuses a save from a newer build rather than corrupting it', () => {
    // A player who sideloads an older APK over a newer one. Migrating backwards
    // is impossible, so the only safe answers are "refuse" or "destroy data".
    expect(migrateToCurrent({ version: 4 })).toBeNull();
  });

  it('passes a current-version save through untouched', () => {
    const save = { version: 3, coins: 5 };
    expect(migrateToCurrent(save)).toEqual({ version: 3, coins: 5 });
  });

  it('runs every step of the chain in order', () => {
    const order: number[] = [];
    migrations[1] = (data) => {
      order.push(1);
      return { ...data, addedInV2: true };
    };
    migrations[2] = (data) => {
      order.push(2);
      return { ...data, addedInV3: true };
    };

    const result = migrateToCurrent({ version: 1, coins: 5 });

    expect(order).toEqual([1, 2]);
    expect(result).toEqual({ version: 3, coins: 5, addedInV2: true, addedInV3: true });
  });

  it('starts partway through the chain when the save is only one version behind', () => {
    migrations[1] = () => {
      throw new Error('should not run for a v2 save');
    };
    migrations[2] = (data) => ({ ...data, addedInV3: true });

    expect(migrateToCurrent({ version: 2 })).toEqual({ version: 3, addedInV3: true });
  });

  it('returns null when a migration is missing from the chain', () => {
    // Someone bumped CURRENT_SAVE_VERSION without adding the migration. Better
    // to reset one player's save than to hand malformed data to the game.
    migrations[1] = (data) => ({ ...data });
    // migrations[2] deliberately absent

    expect(migrateToCurrent({ version: 1 })).toBeNull();
  });

  it('stamps the resulting version even if a migration forgets to', () => {
    migrations[1] = (data) => ({ ...data });
    migrations[2] = (data) => ({ ...data });

    expect(migrateToCurrent({ version: 1 })?.['version']).toBe(3);
  });
});
