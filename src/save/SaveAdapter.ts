/**
 * Storage backend contract. Deliberately string-in/string-out — serialisation,
 * validation and migration are the save service's job, not the backend's, so
 * adding a new backend (cloud sync, a file on desktop) stays trivial.
 */
export interface SaveAdapter {
  readonly name: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
