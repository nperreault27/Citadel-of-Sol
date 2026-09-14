import { COMBAT_CONTENT } from '@/game/combat/content';
import {
  canPlayCard,
  cardDefOf,
  confirmDiscard,
  endPlayerTurn,
  legalTargets,
  needsTargetChoice,
  resolveEnemyTurn,
} from '@/game/combat/engine';
import { nextRandom, shuffle } from '@/game/combat/rng';
import type { CardInstanceId, CombatState } from '@/game/combat/types';
import { cardValue, evaluate } from './evaluate';
import { applyAction, isOver, type Action, type Policy } from './play';

/**
 * A planner that plays a whole turn in its head before committing to a card.
 *
 * Each decision:
 *   1. Beam-search every order of plays this turn could take, keeping the
 *      `beam` most promising part-played turns at each depth.
 *   2. Take the best finished turns and play the enemy's reply to each, `samples`
 *      times with different rolls, scoring what is left.
 *   3. Play the first card of the winner, and keep following the plan for as
 *      long as the real battle matches what was imagined.
 *
 * It is not allowed to cheat. The engine keeps the draw order and the next roll
 * in the state, so before imagining anything the planner shuffles its copy of
 * the draw pile and replaces the seed with one of its own. It knows what a
 * player knows: the hand, the board, and the enemy's move lists.
 */

export interface PlannerOptions {
  /** Part-played turns kept at each depth of the search. */
  beam: number;
  /** Finished turns, best first, that get the enemy's reply played out. */
  leaves: number;
  /** Enemy replies imagined per finished turn. */
  samples: number;
  /** Most cards considered in one turn. */
  maxDepth: number;
  /** Seeds the planner's own imagination. Unrelated to the battle's seed. */
  seed: number;
}

export const DEFAULT_PLANNER_OPTIONS: PlannerOptions = {
  beam: 8,
  leaves: 6,
  samples: 4,
  maxDepth: 12,
  seed: 1,
};

interface Node {
  state: CombatState;
  path: Action[];
  /** State key after each step of `path`, for checking the plan still holds. */
  keys: string[];
  score: number;
}

/**
 * Everything about a state that a decision depends on, and nothing random.
 *
 * Cards are keyed by definition, not instance, so two copies of Jab are one
 * choice rather than two. The seed and draw order are left out on purpose:
 * they are exactly what the planner is not allowed to know.
 */
export function stateKey(state: CombatState): string {
  const defs = (ids: readonly CardInstanceId[]) =>
    ids
      .map((id) => state.cards[id]?.definitionId ?? '?')
      .sort()
      .join(',');

  const parts = [
    state.phase,
    state.round,
    defs(state.hand),
    state.drawPile.length,
    state.discardPile.length,
    state.exhaustPile.length,
    state.selection ? defs(state.selection.cards) : '',
  ];

  for (const id of [...state.playerOrder, ...state.enemyOrder]) {
    const c = state.combatants[id];
    if (!c) continue;
    const statuses = c.statuses
      .map((s) => `${s.kind}${s.stacks}${s.duration.kind === 'turns' ? `/${s.duration.remaining}` : ''}`)
      .join('.');
    parts.push(`${id}:${c.health}:${c.shield}:${c.stamina}:${c.downed ? 1 : 0}${c.resting ? 1 : 0}:${statuses}`);
  }

  return parts.join('|');
}

function actionKey(state: CombatState, action: Action | undefined): string {
  if (!action) return 'end';
  switch (action.type) {
    case 'play':
      return `play:${state.cards[action.card]?.definitionId}:${action.target}`;
    case 'select':
      return `select:${state.cards[action.card]?.definitionId}`;
    default:
      return action.type;
  }
}

/** Every distinct thing the player could do next, without ending the turn. */
function enumerate(state: CombatState): Action[] {
  if (state.phase === 'selecting') {
    const seen = new Set<string>();
    return (state.selection?.cards ?? [])
      .filter((card) => {
        const def = state.cards[card]?.definitionId ?? card;
        if (seen.has(def)) return false;
        seen.add(def);
        return true;
      })
      .map((card) => ({ type: 'select', card }));
  }

  if (state.phase !== 'selectCard') return [];

  const actions: Action[] = [];
  const seen = new Set<string>();

  for (const card of state.hand) {
    const def = cardDefOf(state, COMBAT_CONTENT, card);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);

    if (!canPlayCard(state, COMBAT_CONTENT, card).ok) continue;

    if (!needsTargetChoice(def.target)) {
      actions.push({ type: 'play', card, target: null });
      continue;
    }

    const heals = def.effects.some((e) => e.type === 'heal' || e.type === 'healPercent');

    for (const target of legalTargets(state, COMBAT_CONTENT, card)) {
      // Healing someone already full is never the best use of a card.
      const ally = state.combatants[target];
      if (heals && ally && !ally.downed && ally.health >= ally.maxHealth) continue;
      actions.push({ type: 'play', card, target });
    }
  }

  return actions;
}

/** The weakest cards in hand, enough to get down to the limit. */
function cheapestDiscards(state: CombatState): CardInstanceId[] {
  const excess = state.hand.length - state.handLimit;
  return [...state.hand]
    .sort((a, b) => cardValue(state, COMBAT_CONTENT, a) - cardValue(state, COMBAT_CONTENT, b))
    .slice(0, Math.max(0, excess));
}

/** Ends the turn and lets the enemy answer, with a given roll. */
function answer(state: CombatState, seed: number): CombatState {
  if (isOver(state)) return state;

  let current = endPlayerTurn({ ...state, seed }, COMBAT_CONTENT);
  if (current.phase === 'discarding') {
    current = confirmDiscard(current, COMBAT_CONTENT, cheapestDiscards(current));
  }
  return resolveEnemyTurn(current, COMBAT_CONTENT);
}

function isLegal(state: CombatState, action: Action): boolean {
  switch (action.type) {
    case 'play':
      if (!canPlayCard(state, COMBAT_CONTENT, action.card).ok) return false;
      return action.target === null || legalTargets(state, COMBAT_CONTENT, action.card).includes(action.target);
    case 'select':
      return state.phase === 'selecting' && (state.selection?.cards.includes(action.card) ?? false);
    case 'endTurn':
      return state.phase === 'selectCard';
    case 'discard':
      return state.phase === 'discarding';
  }
}

export function createPlanner(overrides: Partial<PlannerOptions> = {}): Policy {
  const options = { ...DEFAULT_PLANNER_OPTIONS, ...overrides };
  let rng = options.seed;

  const roll = (): number => {
    const next = nextRandom(rng);
    rng = next.seed;
    return Math.floor(next.value * 2147483647);
  };

  /** The rest of the current plan, and the state it expects to see next. */
  let plan: Action[] = [];
  let keys: string[] = [];
  let step = 0;

  /**
   * The battle as the player can see it: the draw pile in an order the planner
   * made up, and a seed it chose. Sorting first means the real order cannot
   * leak through the shuffle.
   */
  function imagine(state: CombatState): CombatState {
    const order = [...state.drawPile].sort();
    return { ...state, drawPile: shuffle(order, roll()).items, seed: roll() };
  }

  function search(real: CombatState): Node {
    const root = imagine(real);
    const futures = Array.from({ length: options.samples }, roll);

    const start: Node = { state: root, path: [], keys: [], score: evaluate(root, COMBAT_CONTENT) };
    const seen = new Set([stateKey(root)]);
    const leaves: Node[] = root.phase === 'selectCard' ? [start] : [];
    let beam: Node[] = [start];

    for (let depth = 0; depth < options.maxDepth && beam.length > 0; depth++) {
      const children: Node[] = [];

      for (const node of beam) {
        for (const action of enumerate(node.state)) {
          const next = applyAction(node.state, action);
          if (next === node.state) continue;

          const key = stateKey(next);
          if (seen.has(key)) continue;
          seen.add(key);

          const child: Node = {
            state: next,
            path: [...node.path, action],
            keys: [...node.keys, key],
            score: evaluate(next, COMBAT_CONTENT),
          };

          children.push(child);
          if (next.phase === 'selectCard' || isOver(next)) leaves.push(child);
        }
      }

      beam = children
        .filter((child) => !isOver(child.state))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.beam);
    }

    if (leaves.length === 0) return start;

    // The best few by the static score, plus the best turn behind every opening
    // move. Without the second set, a Goad or an Ironclad — worth nothing until
    // the enemy swings — would be cut before the enemy ever got to swing.
    const ranked = [...leaves].sort((a, b) => b.score - a.score);
    const shortlist = new Set(ranked.slice(0, options.leaves));
    const openers = new Set<string>();
    for (const leaf of ranked) {
      const opener = actionKey(root, leaf.path[0]);
      if (openers.has(opener)) continue;
      openers.add(opener);
      shortlist.add(leaf);
    }

    let best = start;
    let bestScore = -Infinity;

    for (const leaf of shortlist) {
      let total = 0;
      for (const seed of futures) total += evaluate(answer(leaf.state, seed), COMBAT_CONTENT);
      const score = total / futures.length;

      if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && leaf.score > best.score)) {
        best = leaf;
        bestScore = score;
      }
    }

    return best;
  }

  return {
    choose(state) {
      if (state.phase === 'discarding') return { type: 'discard', cards: cheapestDiscards(state) };

      // Keep following the plan while reality matches it. The key after the
      // last step we took has to be exactly what we imagined, so a roll that
      // went differently — an Arc, a draw — sends us back to thinking.
      const expected = keys[step - 1];
      const cached = plan[step];
      if (cached && expected !== undefined && stateKey(state) === expected && isLegal(state, cached)) {
        step += 1;
        return cached;
      }

      const best = search(state);
      plan = isOver(best.state) ? best.path : [...best.path, { type: 'endTurn' }];
      keys = best.keys;
      step = 1;

      const first = plan[0] ?? { type: 'endTurn' };
      if (first.type === 'endTurn') plan = [];
      return first;
    },
  };
}
