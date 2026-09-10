import { createStore } from 'zustand/vanilla';
import { COMBAT_CONTENT, createArenaBattle } from '@/game/combat/content';
import {
  cancelCardSelection,
  chooseTarget,
  confirmDiscard,
  endPlayerTurn,
  resolveSelection,
  selectCard,
  stepEnemyTurn,
} from '@/game/combat/engine';
import { gameStore } from './store';
import type { CardInstanceId, CombatState, CombatantId } from '@/game/combat/types';

/**
 * Holds the current battle and applies engine transitions to it.
 *
 * Built with zustand/vanilla so it imports no framework: React subscribes
 * through `useCombatStore`, and ArenaScene reads it with `getState()` and
 * subscribes for animation cues. All the actual rules live in
 * `src/game/combat/engine.ts` — this is a thin shell holding the latest state,
 * the UI-local selection that isn't part of the rules, and the pacing of the
 * enemy turn.
 */

/** Gap between enemy actions, long enough to read each one. */
export const ENEMY_ACTION_DELAY_MS = 750;

/** Beat before the first enemy acts, so the handover is legible. */
const ENEMY_TURN_LEAD_IN_MS = 400;

export interface CombatStoreState {
  battle: CombatState | null;

  /** Cards ticked in the end-of-turn discard prompt. Purely UI state. */
  discardSelection: CardInstanceId[];

  startBattle: (seed?: number) => void;
  /** Finishes a card that is waiting on the player to pick a card. */
  chooseCard: (instanceId: CardInstanceId) => void;
  endBattle: () => void;

  playCard: (instanceId: CardInstanceId) => void;
  cancelTargeting: () => void;
  pickTarget: (combatantId: CombatantId) => void;
  endTurn: () => void;

  toggleDiscard: (instanceId: CardInstanceId) => void;
  submitDiscards: () => void;
}

/**
 * Pending enemy-step timer.
 *
 * Module-level rather than in the store because it is machinery, not state: no
 * component should re-render because a timer handle changed.
 */
let enemyTimer: ReturnType<typeof setTimeout> | null = null;

function cancelEnemyTurn(): void {
  if (enemyTimer !== null) {
    clearTimeout(enemyTimer);
    enemyTimer = null;
  }
}

export const combatStore = createStore<CombatStoreState>()((set, get) => {
  /**
   * Advances the enemy turn one action at a time.
   *
   * Each step is its own store update, so the arena animates each attack and the
   * health bars drain one hit at a time. Resolving the turn in a single call
   * would be correct but unwatchable.
   */
  function scheduleEnemyStep(delay: number): void {
    cancelEnemyTurn();

    enemyTimer = setTimeout(() => {
      enemyTimer = null;

      const battle = get().battle;
      // The battle can end or be abandoned while the timer is in flight.
      if (!battle || battle.phase !== 'enemyTurn') return;

      const next = stepEnemyTurn(battle, COMBAT_CONTENT);
      set({ battle: next });

      if (next.phase === 'enemyTurn') scheduleEnemyStep(ENEMY_ACTION_DELAY_MS);
    }, delay);
  }

  /** Applies a transition and starts the enemy turn if it just began. */
  function commit(next: CombatState): void {
    set({ battle: next });
    if (next.phase === 'enemyTurn') scheduleEnemyStep(ENEMY_TURN_LEAD_IN_MS);
  }

  return {
    battle: null,
    discardSelection: [],

    startBattle: (seed) => {
      cancelEnemyTurn();
      // The party comes from durable game state, so the deck is built from
      // whoever is currently equipped.
      const party = gameStore.getState().party;
      const battle =
        seed === undefined ? createArenaBattle(party) : createArenaBattle(party, seed);

      set({ battle, discardSelection: [] });
      if (battle.phase === 'enemyTurn') scheduleEnemyStep(ENEMY_TURN_LEAD_IN_MS);
    },

    chooseCard: (instanceId) => {
      const { battle } = get();
      if (!battle) return;
      set({ battle: resolveSelection(battle, instanceId) });
    },

    endBattle: () => {
      cancelEnemyTurn();
      set({ battle: null, discardSelection: [] });
    },

    playCard: (instanceId) => {
      const { battle } = get();
      if (!battle) return;
      set({ battle: selectCard(battle, COMBAT_CONTENT, instanceId) });
    },

    cancelTargeting: () => {
      const { battle } = get();
      if (!battle) return;
      set({ battle: cancelCardSelection(battle) });
    },

    pickTarget: (combatantId) => {
      const { battle } = get();
      if (!battle) return;
      set({ battle: chooseTarget(battle, COMBAT_CONTENT, combatantId) });
    },

    endTurn: () => {
      const { battle } = get();
      if (!battle) return;
      set({ discardSelection: [] });
      commit(endPlayerTurn(battle, COMBAT_CONTENT));
    },

    toggleDiscard: (instanceId) =>
      set((state) => ({
        discardSelection: state.discardSelection.includes(instanceId)
          ? state.discardSelection.filter((id) => id !== instanceId)
          : [...state.discardSelection, instanceId],
      })),

    submitDiscards: () => {
      const { battle, discardSelection } = get();
      if (!battle) return;
      const next = confirmDiscard(battle, COMBAT_CONTENT, discardSelection);
      set({ discardSelection: [] });
      commit(next);
    },
  };
});

/** How many cards still need discarding before the turn can end. */
export function discardsRequired(state: CombatStoreState): number {
  const battle = state.battle;
  if (!battle || battle.phase !== 'discarding') return 0;
  return Math.max(0, battle.hand.length - battle.handLimit);
}

/** The choice a card is waiting on, if any. */
export function pendingSelection(state: CombatStoreState) {
  return state.battle?.phase === 'selecting' ? (state.battle.selection ?? null) : null;
}

/** True while the enemy team is mid-turn, so the UI can lock input. */
export function isEnemyTurn(state: CombatStoreState): boolean {
  return state.battle?.phase === 'enemyTurn';
}
