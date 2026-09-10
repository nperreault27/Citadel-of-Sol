import { useStore } from 'zustand/react';
import { gameStore, type GameState } from './store';

/**
 * React binding for the vanilla store. This is the only file in `state/` that
 * knows React exists — swapping the UI framework means rewriting this file and
 * nothing else under `state/`.
 *
 * Always pass a selector. `useGameStore()` with no argument subscribes the
 * component to every field, so an inventory pickup would re-render the health
 * bar. Selectors keep each component subscribed to only what it draws.
 *
 *   const health = useGameStore((s) => s.health);
 */
export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(gameStore, selector);
}

/**
 * Actions never change identity, so reading them through this doesn't subscribe
 * the component to anything — safe to call in event handlers without causing
 * re-renders.
 */
export function getGameActions() {
  return gameStore.getState();
}
