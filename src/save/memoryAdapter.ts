import type { SaveAdapter } from './SaveAdapter';

/** In-memory backend for unit tests. Also handy as a "no persistence" mode. */
export function createMemoryAdapter(seed: Record<string, string> = {}): SaveAdapter {
  const store = new Map<string, string>(Object.entries(seed));

  return {
    name: 'memory',
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async remove(key) {
      store.delete(key);
    },
  };
}
