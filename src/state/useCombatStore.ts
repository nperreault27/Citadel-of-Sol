import { useStore } from 'zustand/react';
import { combatStore, type CombatStoreState } from './combatStore';

/**
 * React binding for the combat store. The only file under `state/` besides
 * `useGameStore` that knows React exists.
 *
 * Always pass a selector — subscribing to the whole battle would re-render the
 * entire combat screen on every card played.
 */
export function useCombatStore<T>(selector: (state: CombatStoreState) => T): T {
  return useStore(combatStore, selector);
}

export function getCombatActions(): CombatStoreState {
  return combatStore.getState();
}
