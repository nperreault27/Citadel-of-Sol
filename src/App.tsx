import { useEffect } from 'react';
import { PhaserGame } from '@/game/PhaserGame';
import { UIOverlay } from '@/ui/UIOverlay';
import { EventBus } from '@/bridge/EventBus';
import { gameStore } from '@/state/store';
import { useAndroidLifecycle } from '@/ui/hooks/useAndroidLifecycle';

export function App() {
  useAndroidLifecycle();
  useEventBridge();

  return (
    <>
      <PhaserGame />
      <UIOverlay />
    </>
  );
}

/**
 * Translates the game's events into store updates for the UI.
 *
 * Kept in one place rather than scattered across components so there's a single
 * list of what the world can push into the interface. `EventBus.on` returns its
 * own unsubscribe function, which is exactly the shape useEffect wants.
 */
function useEventBridge(): void {
  useEffect(() => {
    const unsubscribers = [
      EventBus.on('preload:progress', ({ progress }) => {
        gameStore.getState().setLoadProgress(progress);
      }),

      EventBus.on('loot:acquired', ({ itemId, quantity }) => {
        gameStore.getState().addItem(itemId, quantity);
      }),

      EventBus.on('player:health-changed', ({ current, max }) => {
        gameStore.getState().setHealth(current, max);
      }),
    ];

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);
}
