import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { gameStore } from './state/store';
import { saveService } from './save';
import { setInitialPlayer } from './save/session';
import './styles/globals.css';

/**
 * Loads the save before mounting anything.
 *
 * Doing this first means WorldScene can spawn the player at their saved position
 * synchronously — Phaser's `create()` can't reliably await an async load, and
 * spawning at the origin then teleporting looks like a bug.
 */
async function bootstrap() {
  const { data, wasReset } = await saveService.load();

  gameStore.getState().hydrateFromSave(data, wasReset);
  setInitialPlayer(data.player);

  const container = document.getElementById('root');
  if (!container) throw new Error('#root not found');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
