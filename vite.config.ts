/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // CRITICAL for Capacitor: the Android WebView serves from a local origin, and
  // Vite's default absolute `/assets/...` paths 404 silently inside the app while
  // working fine in the browser. This is the classic "white screen on device" bug.
  base: './',

  plugins: [react()],

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    host: true, // reachable from a phone on the same LAN for quick testing
    port: 5173,
  },

  build: {
    // Phaser is large; keep it in its own chunk so app code can invalidate
    // independently of the engine on redeploys.
    rollupOptions: {
      output: {
        // Function form rather than the `{ phaser: ['phaser'] }` object shorthand:
        // Vite 8's bundler only accepts a function here.
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 1600,
  },

  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
  },
});
