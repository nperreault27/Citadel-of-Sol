import type { SaveAdapter } from './SaveAdapter';

/**
 * localStorage backend, used during browser development.
 *
 * Every call is wrapped: localStorage throws outright in private-browsing modes
 * and when a quota is exceeded, and a save failure should degrade the session,
 * not end it.
 */
export const webAdapter: SaveAdapter = {
  name: 'localStorage',

  async get(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn('[save] localStorage read failed', error);
      return null;
    }
  },

  async set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn('[save] localStorage write failed', error);
    }
  },

  async remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('[save] localStorage remove failed', error);
    }
  },
};
