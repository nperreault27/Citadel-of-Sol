import { describe, expect, it } from 'vitest';
import {
  canPlayCard,
  cancelCardSelection,
  chooseTarget,
  confirmDiscard,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  legalTargets,
  selectCard,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from '@/game/combat/types';

/**
 * A deliberately small, fully controlled battle. Using the real content here
 * would mean every balance tweak breaks the rules tests.
 */

const PERMANENT: StatusDuration = { kind: 'permanent' };
const ONE_TURN: StatusDuration = { kind: 'turns', remaining: 1 };

function hero(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero',
    name: 'Hero',
    team: 'player',
    health: 100,
    maxHealth: 100,
    stamina: 100,
    maxStamina: 100,
    attack: 100,
    defense: 0,
    speed: 10,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
    ...overrides,
  };
}

function foe(overrides: Partial<Combatant> = {}): Combatant {
  return { ...hero({ id: 'foe', name: 'Foe', team: 'enemy', speed: 1 }), ...overrides };
}

const CARDS: Record<string, CardDefinition> = {
  strike: {
    id: 'strike',
    tier: 'basic',
    name: 'Strike',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 50 }],
  },
  heavy: {
    id: 'heavy',
    tier: 'basic',
    name: 'Heavy',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 100,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 50 }],
  },
  buff: {
    id: 'buff',
    tier: 'basic',
    name: 'Buff',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'self',
    effects: [{ type: 'status', kind: 'strength', stacks: 1, duration: PERMANENT }],
  },
  rally: {
    id: 'rally',
    tier: 'basic',
    name: 'Rally',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'self',
    effects: [{ type: 'status', kind: 'strength', stacks: 1, duration: ONE_TURN }],
  },
  snare: {
    id: 'snare',
    tier: 'basic',
    name: 'Snare',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'weakness', stacks: 1, duration: ONE_TURN }],
  },
  mend: {
    id: 'mend',
    tier: 'basic',
    name: 'Mend',
    description: '',
    brief: '',
    // Owned by the hero, not the ally — a downed character can't play their own
    // revive, so a card owned by the ally would be unplayable in exactly the
    // test that needs it.
    ownerId: 'hero',
    staminaCost: 10,
    target: 'oneAlly',
    effects: [{ type: 'heal', amount: 40 }],
  },
  regroup: {
    id: 'regroup',
    tier: 'basic',
    name: 'Regroup',
    description: '',
    brief: '',
    ownerId: null,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'draw', count: 2 }],
  },
};

const PASSIVE_ENEMY: EnemyAction[] = [];

const BITE: EnemyAction[] = [
  { id: 'bite', name: 'Bite', description: 'Bite one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'damage', power: 50 }] },
];

function content(enemyActions: Record<string, EnemyAction[]> = { foe: PASSIVE_ENEMY }): CombatContent {
  return { cardDefs: CARDS, enemyActions };
}

function battle(
  options: {
    combatants?: Combatant[];
    deck?: string[];
    enemyActions?: Record<string, EnemyAction[]>;
  } = {}
): { state: CombatState; content: CombatContent } {
  const state = createCombat({
    combatants: options.combatants ?? [hero(), foe()],
    deck: options.deck ?? Array.from({ length: 12 }, () => 'strike'),
    seed: 42,
  });
  return { state, content: content(options.enemyActions ?? { foe: PASSIVE_ENEMY }) };
}

/** First card in hand matching a definition. */
function findInHand(state: CombatState, definitionId: string): string {
  const found = state.hand.find((id) => state.cards[id]?.definitionId === definitionId);
  if (!found) throw new Error(`no ${definitionId} in hand`);
  return found;
}

/**
 * Ends the player turn and resolves the enemy turn to completion.
 *
 * `endPlayerTurn` now only queues the enemies — the UI steps through them one at
 * a time so each attack can be animated. Tests that care about the state after a
 * full round use this instead.
 */
function passTurn(state: CombatState, content: CombatContent): CombatState {
  return resolveEnemyTurn(endPlayerTurn(state, content), content);
}

// ────────────────────────────────────────────────────────────────────────────

describe('createCombat', () => {
  it('deals a full hand', () => {
    const { state } = battle();

    expect(state.hand).toHaveLength(5);
    expect(state.exhaustPile).toEqual([]);
    expect(state.round).toBe(1);
  });

  it('gives the first turn to the faster team', () => {
    const { state } = battle({ combatants: [hero({ speed: 1 }), foe({ speed: 50 })] });
    expect(state.activeTeam).toBe('enemy');
  });

  it('shuffles the deck rather than dealing it in order', () => {
    const deck = ['strike', 'buff', 'mend', 'regroup', 'heavy', 'strike', 'buff', 'mend'];
    const a = createCombat({ combatants: [hero(), foe()], deck, seed: 1 });
    const b = createCombat({ combatants: [hero(), foe()], deck, seed: 999 });

    const defsOf = (s: CombatState) => s.hand.map((id) => s.cards[id]?.definitionId).join(',');
    expect(defsOf(a)).not.toBe(defsOf(b));
  });

  it('is deterministic for a given seed', () => {
    const deck = ['strike', 'buff', 'mend', 'regroup', 'heavy', 'strike'];
    const a = createCombat({ combatants: [hero(), foe()], deck, seed: 7 });
    const b = createCombat({ combatants: [hero(), foe()], deck, seed: 7 });

    expect(a.hand).toEqual(b.hand);
  });
});

describe('playing a card', () => {
  it('spends the owner stamina and discards the card', () => {
    const { state, content: c } = battle();
    const card = findInHand(state, 'strike');

    const next = chooseTarget(selectCard(state, c, card), c, 'foe');

    expect(next.combatants['hero']?.stamina).toBe(80);
    expect(next.hand).not.toContain(card);
    expect(next.discardPile).toContain(card);
  });

  it('applies damage through the full formula', () => {
    // 100 attack x 50% power, DEF 0 → 50 damage.
    const { state, content: c } = battle();
    const next = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');

    expect(next.combatants['foe']?.health).toBe(50);
  });

  it('drains the target stamina by the damage taken', () => {
    // 50 damage on 100 max HP is 50% — above the 25% pivot, so the drain caps.
    const { state, content: c } = battle();
    const next = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');

    expect(next.combatants['foe']?.stamina).toBe(50);
  });

  it('parks in selectTarget for single-target cards', () => {
    const { state, content: c } = battle();
    const mid = selectCard(state, c, findInHand(state, 'strike'));

    expect(mid.phase).toBe('selectTarget');
    expect(mid.combatants['hero']?.stamina).toBe(100); // nothing paid until a target is chosen
  });

  it('resolves immediately for cards that need no choice', () => {
    const { state, content: c } = battle({ deck: Array.from({ length: 12 }, () => 'buff') });
    const next = selectCard(state, c, findInHand(state, 'buff'));

    expect(next.phase).toBe('selectCard');
    expect(next.combatants['hero']?.statuses).toHaveLength(1);
  });

  it('cancelling targeting costs nothing', () => {
    const { state, content: c } = battle();
    const cancelled = cancelCardSelection(selectCard(state, c, findInHand(state, 'strike')));

    expect(cancelled.phase).toBe('selectCard');
    expect(cancelled.combatants['hero']?.stamina).toBe(100);
    expect(cancelled.hand).toHaveLength(5);
  });

  it('does not mutate the state it was given', () => {
    const { state, content: c } = battle();
    chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');

    expect(state.combatants['hero']?.stamina).toBe(100);
    expect(state.hand).toHaveLength(5);
  });
});

describe('stamina and resting', () => {
  it('regains 40% of max stamina as the team turn opens', () => {
    const { state, content: c } = battle({
      combatants: [hero(), foe({ health: 1000, maxHealth: 1000 })],
    });

    let spent = state;
    for (let i = 0; i < 3; i++) {
      spent = chooseTarget(selectCard(spent, c, findInHand(spent, 'strike')), c, 'foe');
    }
    expect(spent.combatants['hero']?.stamina).toBe(40);

    expect(passTurn(spent, c).combatants['hero']?.stamina).toBe(80);
  });

  it('never regenerates past the max', () => {
    const { state, content: c } = battle({
      combatants: [hero(), foe({ health: 1000, maxHealth: 1000 })],
    });
    const spent = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');

    expect(passTurn(spent, c).combatants['hero']?.stamina).toBe(100);
  });

  it('regenerates enemies as their own turn opens', () => {
    const { state, content: c } = battle({ combatants: [hero(), foe({ stamina: 30 })] });

    expect(endPlayerTurn(state, c).combatants['foe']?.stamina).toBe(70);
  });

  it('forces a rest when stamina bottoms out, and allows overspending', () => {
    const { state, content: c } = battle({ deck: Array.from({ length: 12 }, () => 'heavy') });
    const next = chooseTarget(selectCard(state, c, findInHand(state, 'heavy')), c, 'foe');

    expect(next.combatants['hero']?.stamina).toBe(0);
    expect(next.combatants['hero']?.resting).toBe(true);
  });

  it('blocks a resting character from acting again this turn', () => {
    const { state, content: c } = battle({
      deck: Array.from({ length: 12 }, () => 'heavy'),
    });
    const after = chooseTarget(selectCard(state, c, findInHand(state, 'heavy')), c, 'foe');

    const check = canPlayCard(after, c, findInHand(after, 'heavy'));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/resting/i);
  });

  it('refills stamina completely at end of turn and clears the rest', () => {
    const { state, content: c } = battle({ deck: Array.from({ length: 12 }, () => 'heavy') });
    const spent = chooseTarget(selectCard(state, c, findInHand(state, 'heavy')), c, 'foe');
    const next = passTurn(spent, c);

    expect(next.combatants['hero']?.stamina).toBe(100);
    expect(next.combatants['hero']?.resting).toBe(false);
  });

  it('costs only the remainder of the current turn, not the next one', () => {
    const { state, content: c } = battle({ deck: Array.from({ length: 12 }, () => 'heavy') });
    const spent = chooseTarget(selectCard(state, c, findInHand(state, 'heavy')), c, 'foe');
    const nextTurn = passTurn(spent, c);

    expect(canPlayCard(nextTurn, c, findInHand(nextTurn, 'heavy')).ok).toBe(true);
  });

  it('lasts through the enemy turn, not just the remainder of your own', () => {
    // Exhausting yourself has to cost something. Waking at your own end of turn
    // would mean it cost nothing at all: the enemy would never catch you asleep.
    const { state, content: c } = battle({ deck: Array.from({ length: 12 }, () => 'heavy') });
    const spent = chooseTarget(selectCard(state, c, findInHand(state, 'heavy')), c, 'foe');

    const enemyTurn = endPlayerTurn(spent, c);
    expect(enemyTurn.combatants['hero']?.resting).toBe(true);

    const after = resolveEnemyTurn(enemyTurn, c);
    expect(after.combatants['hero']?.resting).toBe(false);
    expect(after.combatants['hero']?.stamina).toBe(100);
  });

  it('benches an enemy that exhausts itself for the whole of the player turn', () => {
    // The mirror of the rule above: the foe spends its last stamina biting, so
    // it is asleep — and taking extra damage — for all of the player's turn.
    const { state, content: c } = battle({
      // A small bar, so the turn-start regeneration still leaves too little for
      // the bite and it empties itself.
      combatants: [hero({ health: 300, maxHealth: 300 }), foe({ stamina: 5, maxStamina: 10 })],
      enemyActions: { foe: BITE },
      deck: Array.from({ length: 12 }, () => 'strike'),
    });

    const bitten = passTurn(state, c);
    expect(bitten.combatants['foe']?.resting).toBe(true);

    // It wakes as that turn ends, in time to act on the turn after. Checked
    // before the enemy acts: this bar is small enough that it bites itself
    // straight back to sleep.
    const woken = endPlayerTurn(bitten, c);
    expect(woken.combatants['foe']?.resting).toBe(false);

    const after = resolveEnemyTurn(woken, c);
    expect(after.combatants['hero']?.health).toBeLessThan(bitten.combatants['hero']!.health);
  });
});

describe('turn-long statuses', () => {
  it('keeps a buff played on your turn up for the enemy turn', () => {
    const { state, content: c } = battle({
      deck: Array.from({ length: 12 }, () => 'rally'),
      enemyActions: { foe: BITE },
    });

    const queued = endPlayerTurn(selectCard(state, c, findInHand(state, 'rally')), c);
    expect(stacksOf(queued.combatants['hero']?.statuses ?? [], 'strength')).toBe(1);

    const after = resolveEnemyTurn(queued, c);
    expect(stacksOf(after.combatants['hero']?.statuses ?? [], 'strength')).toBe(0);
  });

  it('keeps a debuff hung on an enemy up until they have acted under it', () => {
    const { state, content: c } = battle({
      deck: Array.from({ length: 12 }, () => 'snare'),
      enemyActions: { foe: BITE },
    });

    const queued = endPlayerTurn(
      chooseTarget(selectCard(state, c, findInHand(state, 'snare')), c, 'foe'),
      c
    );
    expect(stacksOf(queued.combatants['foe']?.statuses ?? [], 'weakness')).toBe(1);

    // Both sides tick at the same moment — the close of the enemy turn.
    const after = resolveEnemyTurn(queued, c);
    expect(stacksOf(after.combatants['foe']?.statuses ?? [], 'weakness')).toBe(0);
  });
});

describe('neutral cards', () => {
  it('cost no stamina', () => {
    const { state, content: c } = battle({
      deck: ['regroup', 'strike', 'strike', 'strike', 'strike', 'strike', 'strike'],
    });
    const next = selectCard(state, c, findInHand(state, 'regroup'));

    expect(next.combatants['hero']?.stamina).toBe(100);
  });

  it('are used up rather than discarded', () => {
    const { state, content: c } = battle({
      deck: ['regroup', 'strike', 'strike', 'strike', 'strike', 'strike', 'strike'],
    });
    const card = findInHand(state, 'regroup');
    const next = selectCard(state, c, card);

    expect(next.hand).not.toContain(card);
    expect(next.discardPile).not.toContain(card);
    expect(next.exhaustPile).toEqual([card]);
  });

  it('never come back round, even through a reshuffle', () => {
    // Six cards: the whole deck cycles every turn or two, so a used-up card that
    // leaked back into the discard would be in hand again almost at once.
    const { state, content: c } = battle({
      combatants: [hero(), foe({ health: 10000, maxHealth: 10000 })],
      deck: ['regroup', 'strike', 'strike', 'strike', 'strike', 'strike'],
    });
    const card = findInHand(state, 'regroup');
    let current = selectCard(state, c, card);

    for (let turn = 0; turn < 6; turn++) {
      const strike = current.hand.find((id) => canPlayCard(current, c, id).ok);
      if (strike) current = chooseTarget(selectCard(current, c, strike), c, 'foe');
      current = passTurn(current, c);

      expect(current.hand).not.toContain(card);
      expect(current.drawPile).not.toContain(card);
      expect(current.exhaustPile).toEqual([card]);
    }
  });

  it('draw effects add to the hand', () => {
    const { state, content: c } = battle({
      deck: ['regroup', ...Array.from({ length: 10 }, () => 'strike')],
    });
    const before = state.hand.length;
    const next = selectCard(state, c, findInHand(state, 'regroup'));

    // Minus the regroup itself, plus two drawn.
    expect(next.hand).toHaveLength(before - 1 + 2);
  });

  it('are unplayable when nobody can act', () => {
    const { state, content: c } = battle({
      combatants: [hero({ resting: true }), foe()],
      deck: ['regroup', ...Array.from({ length: 10 }, () => 'strike')],
    });

    const check = canPlayCard(state, c, findInHand(state, 'regroup'));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/no one/i);
  });
});

describe('targeting', () => {
  it('offers only living enemies', () => {
    const { state, content: c } = battle({
      combatants: [hero(), foe({ id: 'foe' }), foe({ id: 'foe2', downed: true })],
    });

    expect(legalTargets(state, c, findInHand(state, 'strike'))).toEqual(['foe']);
  });

  it('excludes downed allies from a non-healing card', () => {
    const { state, content: c } = battle({
      combatants: [hero(), hero({ id: 'ally', downed: true }), foe()],
      deck: Array.from({ length: 12 }, () => 'buff'),
    });

    expect(legalTargets(state, c, findInHand(state, 'buff'))).not.toContain('ally');
  });

  it('includes downed allies for a healing card, so revives can reach them', () => {
    const { state, content: c } = battle({
      combatants: [hero(), hero({ id: 'ally', downed: true, health: 0 }), foe()],
      deck: Array.from({ length: 12 }, () => 'mend'),
    });

    expect(legalTargets(state, c, findInHand(state, 'mend'))).toContain('ally');
  });

  it('rejects an illegal target', () => {
    const { state, content: c } = battle();
    const mid = selectCard(state, c, findInHand(state, 'strike'));
    const next = chooseTarget(mid, c, 'hero'); // an ally, for an enemy-targeted card

    expect(next).toBe(mid); // unchanged
  });
});

describe('downing and revival', () => {
  it('downs a combatant at zero health', () => {
    const { state, content: c } = battle({ combatants: [hero(), foe({ health: 10 })] });
    const next = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');

    expect(next.combatants['foe']?.health).toBe(0);
    expect(next.combatants['foe']?.downed).toBe(true);
  });

  it('healing a downed ally brings them back', () => {
    const { state, content: c } = battle({
      combatants: [hero(), hero({ id: 'ally', health: 0, downed: true }), foe()],
      deck: Array.from({ length: 12 }, () => 'mend'),
    });

    const next = chooseTarget(selectCard(state, c, findInHand(state, 'mend')), c, 'ally');

    expect(next.combatants['ally']?.downed).toBe(false);
    expect(next.combatants['ally']?.health).toBe(40);
  });

  it('declares victory when the last enemy falls', () => {
    const { state, content: c } = battle({ combatants: [hero(), foe({ health: 10 })] });
    const next = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');

    expect(next.phase).toBe('victory');
  });

  it('declares defeat when the last ally falls', () => {
    const { state, content: c } = battle({
      combatants: [hero({ health: 10, maxHealth: 10 }), foe({ attack: 1000 })],
      enemyActions: { foe: BITE },
    });

    const next = passTurn(state, c);
    expect(next.phase).toBe('defeat');
  });
});

describe('end of turn', () => {
  it('draws the hand back up to the limit', () => {
    const { state, content: c } = battle();
    const played = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');
    expect(played.hand).toHaveLength(4);

    const next = passTurn(played, c);
    expect(next.hand).toHaveLength(5);
  });

  it('asks the player to discard when the hand is over the limit', () => {
    const { state, content: c } = battle({
      deck: ['regroup', 'regroup', ...Array.from({ length: 10 }, () => 'strike')],
    });

    // Regroup nets +1 card, taking the hand to 6.
    const drawn = selectCard(state, c, findInHand(state, 'regroup'));
    expect(drawn.hand.length).toBeGreaterThan(5);

    const next = passTurn(drawn, c);
    expect(next.phase).toBe('discarding');
  });

  it('stays in discarding until enough cards are dropped', () => {
    const { state, content: c } = battle({
      deck: ['regroup', 'regroup', ...Array.from({ length: 10 }, () => 'strike')],
    });
    const drawn = selectCard(state, c, findInHand(state, 'regroup'));
    const discarding = passTurn(drawn, c);

    const over = discarding.hand.length - discarding.handLimit;
    expect(over).toBeGreaterThan(0);

    const partial = confirmDiscard(discarding, c, []);
    expect(partial.phase).toBe('discarding');

    const done = confirmDiscard(discarding, c, discarding.hand.slice(0, over));
    expect(done.phase).not.toBe('discarding');
    expect(done.hand).toHaveLength(discarding.handLimit);
  });

  it('advances the round after the enemy acts', () => {
    const { state, content: c } = battle();
    const played = chooseTarget(selectCard(state, c, findInHand(state, 'strike')), c, 'foe');
    const next = passTurn(played, c);

    expect(next.round).toBe(2);
    expect(next.activeTeam).toBe('player');
    expect(next.phase).toBe('selectCard');
  });

  it('leaves permanent Strength in place across turns', () => {
    const { state, content: c } = battle({ deck: Array.from({ length: 12 }, () => 'buff') });
    let current = selectCard(state, c, findInHand(state, 'buff'));

    for (let i = 0; i < 3; i++) current = passTurn(current, c);

    expect(current.combatants['hero']?.statuses[0]?.stacks).toBe(1);
  });
});

describe('enemy turn', () => {
  it('lets enemies act and damage the player', () => {
    const { state, content: c } = battle({ enemyActions: { foe: BITE } });
    const next = passTurn(state, c);

    expect(next.combatants['hero']!.health).toBeLessThan(100);
  });

  it('skips downed enemies', () => {
    const { state, content: c } = battle({
      combatants: [hero(), foe({ downed: true })],
      enemyActions: { foe: BITE },
    });
    const next = passTurn(state, c);

    expect(next.combatants['hero']?.health).toBe(100);
  });

  it('is deterministic for a given seed', () => {
    const build = () =>
      createCombat({
        combatants: [hero(), foe({ id: 'foe' }), foe({ id: 'foe2' })],
        deck: Array.from({ length: 12 }, () => 'strike'),
        seed: 5,
      });

    const c = content({ foe: BITE, foe2: BITE });
    const a = passTurn(build(), c);
    const b = passTurn(build(), c);

    expect(a.combatants['hero']?.health).toBe(b.combatants['hero']?.health);
  });
});

describe('deck exhaustion', () => {
  it('reshuffles the discard pile once the draw pile runs out', () => {
    // Six cards total: five in the opening hand, one left to draw.
    const { state, content: c } = battle({ deck: Array.from({ length: 6 }, () => 'strike') });
    expect(state.drawPile).toHaveLength(1);

    let current = state;
    for (let turn = 0; turn < 4; turn++) {
      const card = current.hand.find((id) => canPlayCard(current, c, id).ok);
      if (card) current = chooseTarget(selectCard(current, c, card), c, 'foe');
      current = passTurn(current, c);
      if (current.phase === 'victory' || current.phase === 'defeat') break;
    }

    // Cards keep circulating rather than the hand running dry.
    expect(current.hand.length + current.drawPile.length + current.discardPile.length).toBe(6);
  });
});
