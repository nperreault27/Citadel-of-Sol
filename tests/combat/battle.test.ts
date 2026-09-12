import { describe, expect, it } from 'vitest';
import {
  COMBAT_CONTENT,
  DEFAULT_PARTY,
  ENEMIES,
  ENEMY_TEAMS,
  ROSTER,
  characterById,
  createArenaBattle,
  defaultDeck,
} from '@/game/combat/content';
import { COMBATANT_FRAMES } from '@/game/assets';
import {
  canPlayCard,
  cardDefOf,
  chooseTarget,
  confirmDiscard,
  endPlayerTurn,
  resolveSelection,
  resolveEnemyTurn,
  legalTargets,
  selectCard,
} from '@/game/combat/engine';
import type { CombatState } from '@/game/combat/types';

/**
 * End-to-end runs against the real content.
 *
 * The unit tests prove each rule in isolation; these prove the loop actually
 * terminates. A card economy has plenty of ways to deadlock — an empty hand
 * with no playable card, a discard phase that can never be satisfied, an enemy
 * with no legal action — and none of them show up in a single-transition test.
 */

/** Plays greedily until the battle resolves or the turn cap is hit. */
function playOut(state: CombatState, maxRounds = 200): CombatState {
  let current = state;

  for (let i = 0; i < maxRounds; i++) {
    if (current.phase === 'victory' || current.phase === 'defeat') break;

    // Cards that ask the player to pick one park the battle here. A simulation
    // has no preference, so it takes the first option.
    if (current.phase === 'selecting') {
      const choice = current.selection?.cards[0];
      if (!choice) break;
      current = resolveSelection(current, choice);
      continue;
    }

    // The enemy turn is stepped for the UI's benefit; simulations resolve it
    // in one go.
    if (current.phase === 'enemyTurn') {
      current = resolveEnemyTurn(current, COMBAT_CONTENT);
      continue;
    }

    if (current.phase === 'discarding') {
      const excess = current.hand.length - current.handLimit;
      current = confirmDiscard(current, COMBAT_CONTENT, current.hand.slice(0, excess));
      continue;
    }

    // Play whatever is affordable, then pass.
    let playedSomething = true;
    while (playedSomething && current.phase === 'selectCard') {
      playedSomething = false;

      for (const instanceId of [...current.hand]) {
        if (!canPlayCard(current, COMBAT_CONTENT, instanceId).ok) continue;

        const def = cardDefOf(current, COMBAT_CONTENT, instanceId);
        if (!def) continue;

        const next = selectCard(current, COMBAT_CONTENT, instanceId);

        if (next.phase === 'selectTarget') {
          const targets = legalTargets(next, COMBAT_CONTENT, instanceId);
          const target = targets[0];
          if (!target) break;
          current = chooseTarget(next, COMBAT_CONTENT, target);
        } else {
          current = next;
        }

        playedSomething = true;
        break;
      }
    }

    if (current.phase === 'victory' || current.phase === 'defeat') break;
    current = resolveEnemyTurn(endPlayerTurn(current, COMBAT_CONTENT), COMBAT_CONTENT);
  }

  return current;
}

describe('a full battle', () => {
  it('reaches a conclusion rather than stalling', () => {
    const result = playOut(createArenaBattle(DEFAULT_PARTY, defaultDeck(DEFAULT_PARTY), 1));
    expect(['victory', 'defeat']).toContain(result.phase);
  });

  it('resolves from many different seeds', () => {
    // A deadlock that only appears on certain shuffles is exactly the kind of
    // bug that ships. Sweeping seeds is cheap insurance.
    for (let seed = 1; seed <= 25; seed++) {
      const result = playOut(createArenaBattle(DEFAULT_PARTY, defaultDeck(DEFAULT_PARTY), seed));
      expect(['victory', 'defeat'], `seed ${seed} stalled in ${result.phase}`).toContain(
        result.phase
      );
    }
  });

  it('never leaves the hand over the limit once a turn has ended', () => {
    let current = createArenaBattle(DEFAULT_PARTY, defaultDeck(DEFAULT_PARTY), 7);

    for (let turn = 0; turn < 12; turn++) {
      if (current.phase === 'victory' || current.phase === 'defeat') break;

      if (current.phase === 'discarding') {
        const excess = current.hand.length - current.handLimit;
        current = confirmDiscard(current, COMBAT_CONTENT, current.hand.slice(0, excess));
      } else {
        current = resolveEnemyTurn(endPlayerTurn(current, COMBAT_CONTENT), COMBAT_CONTENT);
      }

      if (current.phase === 'selectCard') {
        expect(current.hand.length).toBeLessThanOrEqual(current.handLimit);
      }
    }
  });

  it('conserves every card across the piles', () => {
    const start = createArenaBattle(DEFAULT_PARTY, defaultDeck(DEFAULT_PARTY), 3);
    const total = start.drawPile.length + start.hand.length + start.discardPile.length;

    const end = playOut(start, 40);
    const endTotal = end.drawPile.length + end.hand.length + end.discardPile.length;

    // Cards must never be created or destroyed, only moved.
    expect(endTotal).toBe(total);
    expect(total).toBe(Object.keys(start.cards).length);
  });

  it('starts the player first, given the default party out-speeds the enemies', () => {
    const partySpeed = DEFAULT_PARTY.map(characterById).reduce(
      (sum, c) => sum + (c?.speed ?? 0),
      0
    );
    const enemySpeed = ENEMIES.reduce((sum, c) => sum + c.speed, 0);

    expect(partySpeed).toBeGreaterThan(enemySpeed);
    expect(createArenaBattle(DEFAULT_PARTY, defaultDeck(DEFAULT_PARTY), 1).activeTeam).toBe('player');
  });

  it('gives every enemy on every team at least one defined action', () => {
    // Every team, not just the one the arena currently loads. An unreachable
    // team with no moves is a bug that only surfaces the day it is switched on.
    for (const team of ENEMY_TEAMS) {
      for (const enemy of team.members) {
        const key = enemy.archetype ?? enemy.id;
        const actions = COMBAT_CONTENT.enemyActions[key];
        expect(actions, `${team.id}: ${enemy.id} has no actions for ${key}`).toBeDefined();
        expect(actions!.length).toBeGreaterThan(0);
      }
    }
  });

  it('gives every enemy a sprite frame of its own', () => {
    // `frameFor` falls back to frame 0 for anything unmapped, which draws the
    // enemy as Ivy rather than failing — so a missing entry is invisible in
    // every way except on screen.
    for (const team of ENEMY_TEAMS) {
      for (const enemy of team.members) {
        const key = enemy.archetype ?? enemy.id;
        expect(COMBATANT_FRAMES[key], `${team.id}: no frame for ${key}`).toBeDefined();
      }
    }
  });

  it('keeps every combatant id unique across all teams at once', () => {
    // Ids key the combatant map, so two enemies sharing one would collapse into
    // a single fighter the moment both were on the field.
    for (const team of ENEMY_TEAMS) {
      const ids = team.members.map((member) => member.id);
      expect(new Set(ids).size, `${team.id} has duplicate ids`).toBe(ids.length);
    }
  });

  it('references only real owners from every card', () => {
    const ids = new Set([...ROSTER, ...ENEMIES].map((c) => c.id));

    for (const card of Object.values(COMBAT_CONTENT.cardDefs)) {
      if (card.ownerId === null) continue;
      expect(ids.has(card.ownerId), `${card.id} has unknown owner ${card.ownerId}`).toBe(true);
    }
  });

  it('deals a battle from exactly the deck that was built', () => {
    // The join between deck building and the engine: whatever the player chose
    // is what gets shuffled, no more and no less.
    const deck = { 'ivy.inject': 4, 'ivy.disperse': 2, 'saber.sever': 3, 'team.regroup': 4 };
    const battle = createArenaBattle(['ivy', 'saber'], deck, 11);

    const dealt = Object.values(battle.cards).map((card) => card.definitionId);
    const counted: Record<string, number> = {};
    for (const id of dealt) counted[id] = (counted[id] ?? 0) + 1;

    expect(counted).toEqual(deck);
    expect(dealt).toHaveLength(13);
    // And every one of them is accounted for across the piles.
    expect(battle.drawPile.length + battle.hand.length + battle.discardPile.length).toBe(13);
  });

  it('is reproducible from a deck regardless of how it was assembled', () => {
    // Object key order must not leak into the shuffle.
    const a = createArenaBattle(['ivy'], { 'ivy.inject': 4, 'team.regroup': 4 }, 5);
    const b = createArenaBattle(['ivy'], { 'team.regroup': 4, 'ivy.inject': 4 }, 5);

    const defsOf = (state: CombatState) =>
      state.hand.map((id) => state.cards[id]?.definitionId).join(',');

    expect(defsOf(a)).toBe(defsOf(b));
  });

  it('never lets a neutral card deal damage, which needs an attacker', () => {
    for (const card of Object.values(COMBAT_CONTENT.cardDefs)) {
      if (card.ownerId !== null) continue;
      expect(card.effects.some((e) => e.type === 'damage')).toBe(false);
    }
  });
});
