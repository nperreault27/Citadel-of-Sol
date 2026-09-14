import { COMBAT_CONTENT } from '@/game/combat/content';
import { canPlayCard, cardDefOf, legalTargets, needsTargetChoice } from '@/game/combat/engine';
import type { Policy } from './play';

/**
 * The original probe AI, kept as a baseline.
 *
 * Plays the first affordable card at the first legal target, takes the first
 * option of any choice, and throws away the first cards in hand. Its win rate is
 * a ceiling on how easy a fight is. Next to the planner's, the gap says how much
 * a party rewards actually thinking.
 */
export function createGreedy(): Policy {
  return {
    choose(state) {
      if (state.phase === 'selecting') {
        const card = state.selection?.cards[0];
        return card ? { type: 'select', card } : { type: 'endTurn' };
      }

      if (state.phase === 'discarding') {
        const excess = Math.max(1, state.hand.length - state.handLimit);
        return { type: 'discard', cards: state.hand.slice(0, excess) };
      }

      for (const card of state.hand) {
        const def = cardDefOf(state, COMBAT_CONTENT, card);
        if (!def || !canPlayCard(state, COMBAT_CONTENT, card).ok) continue;

        if (!needsTargetChoice(def.target)) return { type: 'play', card, target: null };

        const target = legalTargets(state, COMBAT_CONTENT, card)[0];
        if (target) return { type: 'play', card, target };
      }

      return { type: 'endTurn' };
    },
  };
}
