import type { CapacitorConfig } from '@capacitor/cli';

/**
 * ⚠️ SET `appId` BEFORE RUNNING `npx cap add android`.
 *
 * The application id is permanent once the first build reaches Google Play —
 * it cannot be changed afterwards without publishing an entirely new listing and
 * losing every install and review. Use reverse-domain form, e.g.
 * `com.yourname.yourgame`.
 */
const config: CapacitorConfig = {
  appId: 'com.example.game',
  appName: 'Game',
  webDir: 'dist',

  android: {
    // Phaser draws every frame; letting the WebView mix in a translucent
    // background costs compositing work for no visual gain.
    backgroundColor: '#0b0e14',
  },

  plugins: {
    SplashScreen: {
      launchAutoHide: false, // hidden manually once the world is ready
      backgroundColor: '#0b0e14',
      androidScaleType: 'CENTER_CROP',
      // Splash stays up through Phaser's own asset load, so the player never
      // sees an empty canvas.
      showSpinner: false,
    },
  },
};

export default config;
