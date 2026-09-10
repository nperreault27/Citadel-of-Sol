import { Preferences } from '@capacitor/preferences';
import type { SaveAdapter } from './SaveAdapter';

/**
 * Native backend, backed by Android SharedPreferences via @capacitor/preferences.
 *
 * Worth using over localStorage on device: the WebView's own storage can be
 * evicted by the system under storage pressure, and is wiped by "Clear cache" in
 * app settings — which users do routinely without expecting to lose a save.
 * SharedPreferences survives both.
 */
export const capacitorAdapter: SaveAdapter = {
  name: 'capacitor-preferences',

  async get(key) {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch (error) {
      console.warn('[save] Preferences read failed', error);
      return null;
    }
  },

  async set(key, value) {
    try {
      await Preferences.set({ key, value });
    } catch (error) {
      console.warn('[save] Preferences write failed', error);
    }
  },

  async remove(key) {
    try {
      await Preferences.remove({ key });
    } catch (error) {
      console.warn('[save] Preferences remove failed', error);
    }
  },
};
