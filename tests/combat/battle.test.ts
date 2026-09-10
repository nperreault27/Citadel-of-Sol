import { describe, expect, it } from 'vitest';
import { COMBAT_CONTENT, createArenaBattle, PARTY, ENEMIES } from '@/game/combat/content';
import {
  canPlayCard,
  cardDefOf,
  chooseTarget,
  confirmDiscard,
  endPlayerTurn,
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
    const result = playOut(createArenaBattle(1));
    expect(['victory', 'defeat']).toContain(result.phase);
  });

  it('resolves from many different seeds', () => {
    // A deadlock that only appears on certain shuffles is exactly the kind of
    // bug that ships. Sweeping seeds is cheap insurance.
    for (let seed = 1; seed <= 25; seed++) {
      const result = playOut(createArenaBattle(seed));
      expect(['victory', 'defeat'], `seed ${seed} stalled in ${result.phase}`).toContain(
        result.phase
      );
    }
  });

  it('never leaves the hand over the limit once a turn has ended', () => {
    let current = createArenaBattle(7);

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
    const start = createArenaBattle(3);
    const total = start.drawPile.length + start.hand.length + start.discardPile.length;

    const end = playOut(start, 40);
    const endTotal = end.drawPile.length + end.hand.length + end.discardPile.length;

    // Cards must never be created or destroyed, only moved.
    expect(endTotal).toBe(total);
    expect(total).toBe(Object.keys(start.cards).length);
  });

  it('starts the player first, given the party out-speeds the enemies', () => {
    const partySpeed = PARTY.reduce((sum, c) => sum + c.speed, 0);
    const enemySpeed = ENEMIES.reduce((sum, c) => sum + c.speed, 0);

    expect(partySpeed).toBeGreaterThan(enemySpeed);
    expect(createArenaBattle(1).activeTeam).toBe('player');
  });

  it('gives every enemy at least one defined action', () => {
    for (const enemy of ENEMIES) {
      const actions = COMBAT_CONTENT.enemyActions[enemy.id];
      expect(actions, `${enemy.id} has no actions`).toBeDefined();
      expect(actions!.length).toBeGreaterThan(0);
    }
  });

  it('references only real owners from every card', () => {
    const ids = new Set([...PARTY, ...ENEMIES].map((c) => c.id));

    for (const card of Object.values(COMBAT_CONTENT.cardDefs)) {
      if (card.ownerId === null) continue;
      expect(ids.has(card.ownerId), `${card.id} has unknown owner ${card.ownerId}`).toBe(true);
    }
  });

  it('never lets a neutral card deal damage, which needs an attacker', () => {
    for (const card of Object.values(COMBAT_CONTENT.cardDefs)) {
      if (card.ownerId !== null) continue;
      expect(card.effects.some((e) => e.type === 'damage')).toBe(false);
    }
  });
});
