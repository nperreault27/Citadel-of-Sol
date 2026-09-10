import { Capacitor } from '@capacitor/core';
import type { SaveAdapter } from './SaveAdapter';
import { capacitorAdapter } from './capacitorAdapter';
import { webAdapter } from './webAdapter';
import { migrateToCurrent } from './migrations';
import { CURRENT_SAVE_VERSION, createNewSave, saveDataSchema, type SaveData } from './schema';

export const SAVE_KEY = 'game:save:slot0';

/**
 * Picks the storage backend for the current platform.
 *
 * Note that @capacitor/preferences does ship a web implementation backed by
 * localStorage, so this split isn't strictly required for things to work. It's
 * here so the browser path is explicit and swappable in tests, rather than
 * silently routed through a plugin shim.
 */
function selectAdapter(): SaveAdapter {
  return Capacitor.isNativePlatform() ? capacitorAdapter : webAdapter;
}

export class SaveService {
  private readonly adapter: SaveAdapter;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: SaveData | null = null;

  constructor(adapter: SaveAdapter = selectAdapter()) {
    this.adapter = adapter;
  }

  /**
   * Reads the save, running it forward through any migrations and validating the
   * result.
   *
   * Never throws and never returns a partially-valid save: anything unreadable,
   * unmigratable or schema-invalid yields a fresh save instead. A corrupt save
   * that boots into a new game is a bad day; one that crashes on launch is an
   * uninstall, and it's the single most common failure mode in offline games.
   */
  async load(): Promise<{ data: SaveData; wasReset: boolean }> {
    const raw = await this.adapter.get(SAVE_KEY);

    if (raw === null) {
      return { data: createNewSave(), wasReset: false };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[save] stored save was not valid JSON; starting fresh');
      return { data: createNewSave(), wasReset: true };
    }

    const migrated = migrateToCurrent(parsed);
    if (migrated === null) {
      console.warn('[save] could not migrate save to current version; starting fresh');
      return { data: createNewSave(), wasReset: true };
    }

    const result = saveDataSchema.safeParse(migrated);
    if (!result.success) {
      console.warn('[save] save failed schema validation; starting fresh', result.error.issues);
      return { data: createNewSave(), wasReset: true };
    }

    return { data: result.data, wasReset: false };
  }

  /** Writes immediately. Use for deliberate save points and app-background. */
  async saveNow(data: SaveData): Promise<void> {
    this.cancelPendingWrite();
    const payload: SaveData = { ...data, version: CURRENT_SAVE_VERSION, savedAt: Date.now() };
    await this.adapter.set(SAVE_KEY, JSON.stringify(payload));
  }

  /**
   * Coalesces bursts of autosave triggers into one write.
   *
   * Discrete game events can still arrive in clusters — pick up three items from
   * one chest and that's three save requests in a frame. Debouncing keeps a
   * JSON serialise plus a native round trip off the critical path.
   */
  saveDebounced(data: SaveData, delayMs = 1000): void {
    this.pending = data;
    if (this.writeTimer !== null) return;

    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      const toWrite = this.pending;
      this.pending = null;
      if (toWrite) void this.saveNow(toWrite);
    }, delayMs);
  }

  /** Forces any debounced write out now — call before the app backgrounds. */
  async flush(): Promise<void> {
    const toWrite = this.pending;
    this.cancelPendingWrite();
    if (toWrite) await this.saveNow(toWrite);
  }

  async clear(): Promise<void> {
    this.cancelPendingWrite();
    await this.adapter.remove(SAVE_KEY);
  }

  private cancelPendingWrite(): void {
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    this.pending = null;
  }
}

export const saveService = new SaveService();

export { createNewSave, saveDataSchema, CURRENT_SAVE_VERSION };
export type { SaveData };
export type { SaveAdapter };
