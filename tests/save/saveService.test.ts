import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveService, SAVE_KEY } from '@/save';
import { createMemoryAdapter } from '@/save/memoryAdapter';
import { CURRENT_SAVE_VERSION, createNewSave } from '@/save/schema';

beforeEach(() => {
  // The service warns on every rejected save; that's correct behaviour in the
  // app but noise here.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('SaveService.load', () => {
  it('returns a fresh save when nothing is stored', async () => {
    const service = new SaveService(createMemoryAdapter());
    const { data, wasReset } = await service.load();

    expect(wasReset).toBe(false);
    expect(data.version).toBe(CURRENT_SAVE_VERSION);
    expect(data.inventory).toEqual([]);
  });

  it('round-trips a saved game', async () => {
    const adapter = createMemoryAdapter();
    const service = new SaveService(adapter);

    const save = createNewSave();
    save.player.x = 512;
    save.player.facing = 'left';
    save.inventory = [{ itemId: 'key', quantity: 2 }];

    await service.saveNow(save);
    const { data, wasReset } = await service.load();

    expect(wasReset).toBe(false);
    expect(data.player.x).toBe(512);
    expect(data.player.facing).toBe('left');
    expect(data.inventory).toEqual([{ itemId: 'key', quantity: 2 }]);
  });

  it('starts fresh when the stored value is not JSON', async () => {
    const service = new SaveService(createMemoryAdapter({ [SAVE_KEY]: 'not json{' }));
    const { wasReset, data } = await service.load();

    expect(wasReset).toBe(true);
    expect(data.version).toBe(CURRENT_SAVE_VERSION);
  });

  it('starts fresh when the save fails schema validation', async () => {
    // Right version, wrong shape — the exact case a hand-edited or partially
    // written save produces, and the one that crashes an unvalidated loader.
    const broken = JSON.stringify({
      version: CURRENT_SAVE_VERSION,
      savedAt: 0,
      player: { x: 'nope', y: 0, facing: 'down', health: 1, maxHealth: 1 },
      world: { mapKey: 'overworld', visitedFlags: [] },
      inventory: [],
    });

    const service = new SaveService(createMemoryAdapter({ [SAVE_KEY]: broken }));
    const { wasReset } = await service.load();

    expect(wasReset).toBe(true);
  });

  it('rejects an unknown facing value', async () => {
    const save = createNewSave();
    const tampered = JSON.stringify({ ...save, player: { ...save.player, facing: 'sideways' } });

    const service = new SaveService(createMemoryAdapter({ [SAVE_KEY]: tampered }));
    expect((await service.load()).wasReset).toBe(true);
  });

  it('starts fresh for a save written by a newer build', async () => {
    const save = { ...createNewSave(), version: CURRENT_SAVE_VERSION + 5 };
    const service = new SaveService(createMemoryAdapter({ [SAVE_KEY]: JSON.stringify(save) }));

    expect((await service.load()).wasReset).toBe(true);
  });

  it('never throws, whatever is in storage', async () => {
    for (const value of ['', 'null', '[]', '{}', '"str"', '0']) {
      const service = new SaveService(createMemoryAdapter({ [SAVE_KEY]: value }));
      await expect(service.load()).resolves.toBeDefined();
    }
  });
});

describe('SaveService.saveNow', () => {
  it('stamps the current version and a timestamp', async () => {
    const adapter = createMemoryAdapter();
    const service = new SaveService(adapter);

    const save = { ...createNewSave(), version: 999, savedAt: 0 };
    await service.saveNow(save);

    const written = JSON.parse((await adapter.get(SAVE_KEY))!);
    expect(written.version).toBe(CURRENT_SAVE_VERSION);
    expect(written.savedAt).toBeGreaterThan(0);
  });
});

describe('SaveService.saveDebounced', () => {
  it('coalesces a burst into a single write', async () => {
    vi.useFakeTimers();

    const adapter = createMemoryAdapter();
    const setSpy = vi.spyOn(adapter, 'set');
    const service = new SaveService(adapter);

    const save = createNewSave();
    service.saveDebounced(save, 1000);
    service.saveDebounced(save, 1000);
    service.saveDebounced(save, 1000);

    expect(setSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('writes the newest state, not the first one queued', async () => {
    vi.useFakeTimers();

    const adapter = createMemoryAdapter();
    const service = new SaveService(adapter);

    const first = createNewSave();
    const latest = { ...createNewSave(), player: { ...createNewSave().player, x: 999 } };

    service.saveDebounced(first, 1000);
    service.saveDebounced(latest, 1000);

    await vi.advanceTimersByTimeAsync(1000);

    const written = JSON.parse((await adapter.get(SAVE_KEY))!);
    expect(written.player.x).toBe(999);
  });

  it('flush writes immediately and cancels the pending timer', async () => {
    vi.useFakeTimers();

    const adapter = createMemoryAdapter();
    const setSpy = vi.spyOn(adapter, 'set');
    const service = new SaveService(adapter);

    service.saveDebounced(createNewSave(), 1000);
    await service.flush();

    expect(setSpy).toHaveBeenCalledTimes(1);

    // The queued timer must not fire a second write afterwards.
    await vi.advanceTimersByTimeAsync(2000);
    expect(setSpy).toHaveBeenCalledTimes(1);
  });

  it('flush is a no-op when nothing is pending', async () => {
    const adapter = createMemoryAdapter();
    const setSpy = vi.spyOn(adapter, 'set');

    await new SaveService(adapter).flush();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
