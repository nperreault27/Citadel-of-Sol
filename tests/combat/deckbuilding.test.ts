import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_CHARACTER,
  COPY_LIMITS,
  MIN_DECK_SIZE,
  availableCards,
  canAddCopy,
  countForCharacter,
  deckSize,
  defaultDeckFor,
  expandDeck,
  pruneToParty,
  validateDeck,
  type CardDefs,
  type DeckList,
} from '@/game/combat/deckbuilding';
import { CARD_DEFS, DEFAULT_PARTY } from '@/game/combat/content';
import type { CardDefinition, CardTier } from '@/game/combat/types';

/**
 * A tiny fixture roster, so the rules tests do not break every time a real card
 * is retuned or retiered.
 */
function card(
  id: string,
  ownerId: string | null,
  tier: CardTier
): CardDefinition {
  return {
    id,
    tier,
    name: id,
    description: '',
    brief: '',
    ownerId,
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 10 }],
  };
}

const DEFS: CardDefs = Object.fromEntries(
  [
    card('a.basic', 'a', 'basic'),
    card('a.special', 'a', 'special'),
    card('a.unique', 'a', 'unique'),
    card('b.basic', 'b', 'basic'),
    card('b.special', 'b', 'special'),
    card('b.unique', 'b', 'unique'),
    // Four cards, like Hollis: nine possible copies against a budget of seven.
    card('c.basic', 'c', 'basic'),
    card('c.special1', 'c', 'special'),
    card('c.special2', 'c', 'special'),
    card('c.unique', 'c', 'unique'),
    card('team.one', null, 'basic'),
    card('team.two', null, 'basic'),
  ].map((definition) => [definition.id, definition])
);

const PARTY = ['a', 'b', 'c'];

function fill(deck: DeckList, cardId: string, party = PARTY): DeckList {
  const next = { ...deck };
  while (canAddCopy(DEFS, next, party, cardId).ok) {
    next[cardId] = (next[cardId] ?? 0) + 1;
  }
  return next;
}

// ── Availability ────────────────────────────────────────────────────────────

describe('availableCards', () => {
  it('offers the equipped characters cards plus the neutrals', () => {
    const ids = availableCards(DEFS, ['a']).map((c) => c.id);

    expect(ids).toContain('a.basic');
    expect(ids).toContain('team.one');
    expect(ids).not.toContain('b.basic');
  });

  it('orders by party slot, then neutrals', () => {
    const ids = availableCards(DEFS, ['b', 'a']).map((c) => c.id);

    expect(ids.indexOf('b.basic')).toBeLessThan(ids.indexOf('a.basic'));
    expect(ids.indexOf('a.basic')).toBeLessThan(ids.indexOf('team.one'));
  });

  it('offers only neutrals with nobody equipped', () => {
    expect(availableCards(DEFS, []).map((c) => c.id)).toEqual(['team.one', 'team.two']);
  });
});

// ── Copy limits ─────────────────────────────────────────────────────────────

describe('copy limits', () => {
  it('caps each tier at 4, 2 and 1', () => {
    expect(COPY_LIMITS).toEqual({ basic: 4, special: 2, unique: 1 });
  });

  it('stops a basic at four copies', () => {
    const deck = fill({}, 'a.basic');

    expect(deck['a.basic']).toBe(4);
    expect(canAddCopy(DEFS, deck, PARTY, 'a.basic').ok).toBe(false);
  });

  it('stops a special at two and a unique at one', () => {
    expect(fill({}, 'a.special')['a.special']).toBe(2);
    expect(fill({}, 'a.unique')['a.unique']).toBe(1);
  });

  it('says which limit was hit', () => {
    const check = canAddCopy(DEFS, { 'a.unique': 1 }, PARTY, 'a.unique');

    expect(check.ok).toBe(false);
    expect(check.reason).toContain('unique');
  });

  it('refuses a card whose owner is not equipped', () => {
    const check = canAddCopy(DEFS, {}, ['a'], 'b.basic');

    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/party/i);
  });

  it('refuses an unknown card', () => {
    expect(canAddCopy(DEFS, {}, PARTY, 'nope').ok).toBe(false);
  });

  it('never caps the neutral cards by character budget', () => {
    // Neutrals have no owner, so only their own copy limit applies.
    let deck: DeckList = {};
    deck = fill(deck, 'team.one');
    deck = fill(deck, 'team.two');

    expect(deckSize(deck)).toBe(8);
  });
});

// ── Per-character budget ────────────────────────────────────────────────────

describe('the seven-card budget', () => {
  it('is exactly reachable by maxing a three-card character', () => {
    // 4 + 2 + 1 is precisely the budget, so there is no internal choice.
    let deck: DeckList = {};
    for (const id of ['a.basic', 'a.special', 'a.unique']) deck = fill(deck, id);

    expect(countForCharacter(DEFS, deck, 'a')).toBe(CARDS_PER_CHARACTER);
  });

  it('forces a four-card character to cut something', () => {
    // c can reach nine copies against a budget of seven — the Hollis case.
    let deck: DeckList = {};
    for (const id of ['c.basic', 'c.special1', 'c.special2', 'c.unique']) deck = fill(deck, id);

    expect(countForCharacter(DEFS, deck, 'c')).toBe(CARDS_PER_CHARACTER);
    // Something had to give: not every card reached its own limit.
    const maxedOut =
      (deck['c.basic'] ?? 0) === 4 &&
      (deck['c.special1'] ?? 0) === 2 &&
      (deck['c.special2'] ?? 0) === 2 &&
      (deck['c.unique'] ?? 0) === 1;
    expect(maxedOut).toBe(false);
  });

  it('blocks a further card once the budget is spent', () => {
    let deck: DeckList = {};
    for (const id of ['c.basic', 'c.special1']) deck = fill(deck, id);
    expect(countForCharacter(DEFS, deck, 'c')).toBe(6);

    deck['c.special2'] = 1;
    const check = canAddCopy(DEFS, deck, PARTY, 'c.unique');

    expect(check.ok).toBe(false);
    expect(check.reason).toContain(String(CARDS_PER_CHARACTER));
  });

  it('counts each character separately', () => {
    const deck: DeckList = { 'a.basic': 4, 'b.basic': 2 };

    expect(countForCharacter(DEFS, deck, 'a')).toBe(4);
    expect(countForCharacter(DEFS, deck, 'b')).toBe(2);
    expect(countForCharacter(DEFS, deck, 'c')).toBe(0);
  });
});

// ── Validation ──────────────────────────────────────────────────────────────

describe('validateDeck', () => {
  function legalDeck(): DeckList {
    let deck: DeckList = {};
    for (const id of ['a.basic', 'a.special', 'a.unique', 'b.basic', 'b.special', 'b.unique']) {
      deck = fill(deck, id);
    }
    deck = fill(deck, 'team.one');
    deck = fill(deck, 'team.two');
    return deck;
  }

  it('accepts a deck at or over the floor', () => {
    const deck = legalDeck();

    expect(deckSize(deck)).toBeGreaterThanOrEqual(MIN_DECK_SIZE);
    expect(validateDeck(DEFS, deck, PARTY).ok).toBe(true);
  });

  it('rejects a deck under twenty and says the size', () => {
    const result = validateDeck(DEFS, { 'a.basic': 4 }, PARTY);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('4 cards');
  });

  it('counts neutrals toward the floor', () => {
    // 16 neutrals and 4 character cards is a legal deck, by design.
    const deck: DeckList = { 'team.one': 4, 'team.two': 4, 'a.basic': 4, 'b.basic': 4 };

    expect(deckSize(deck)).toBe(16);
    expect(validateDeck(DEFS, deck, PARTY).ok).toBe(false);

    const bigger: DeckList = { ...deck, 'c.basic': 4 };
    expect(deckSize(bigger)).toBe(20);
    expect(validateDeck(DEFS, bigger, PARTY).ok).toBe(true);
  });

  it('rejects too many copies of one card', () => {
    const deck = { ...legalDeck(), 'a.unique': 3 };
    const result = validateDeck(DEFS, deck, PARTY);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('limit 1');
  });

  it('rejects a card belonging to a benched character', () => {
    const deck = { ...legalDeck(), 'c.basic': 1 };
    const result = validateDeck(DEFS, deck, ['a', 'b']);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toMatch(/not in your party/i);
  });

  it('reports every problem at once rather than the first', () => {
    const result = validateDeck(DEFS, { 'a.unique': 5 }, PARTY);

    // Both the copy limit and the size floor.
    expect(result.problems.length).toBeGreaterThan(1);
  });

  it('ignores zero-count entries left behind by the builder', () => {
    const deck = { ...legalDeck(), 'c.basic': 0 };
    expect(validateDeck(DEFS, deck, PARTY).ok).toBe(true);
  });
});

// ── Pruning and expanding ───────────────────────────────────────────────────

describe('pruneToParty', () => {
  it('drops cards whose owner is benched', () => {
    const deck: DeckList = { 'a.basic': 4, 'b.basic': 2, 'team.one': 1 };
    const pruned = pruneToParty(DEFS, deck, ['a']);

    expect(pruned).toEqual({ 'a.basic': 4, 'team.one': 1 });
  });

  it('always keeps the neutrals', () => {
    expect(pruneToParty(DEFS, { 'team.one': 3 }, [])).toEqual({ 'team.one': 3 });
  });

  it('drops unknown cards', () => {
    expect(pruneToParty(DEFS, { ghost: 2 }, PARTY)).toEqual({});
  });
});

describe('expandDeck', () => {
  it('produces one entry per copy', () => {
    expect(expandDeck({ 'a.basic': 3, 'a.unique': 1 })).toEqual([
      'a.basic',
      'a.basic',
      'a.basic',
      'a.unique',
    ]);
  });

  it('is order-independent, so a seeded shuffle is reproducible', () => {
    // Object key order is an implementation detail; two decks with the same
    // contents must expand identically or the same seed would deal differently.
    const one: DeckList = { 'b.basic': 2, 'a.basic': 1 };
    const two: DeckList = { 'a.basic': 1, 'b.basic': 2 };

    expect(expandDeck(one)).toEqual(expandDeck(two));
  });

  it('skips zero and negative counts', () => {
    expect(expandDeck({ 'a.basic': 0, 'a.special': -2, 'a.unique': 1 })).toEqual(['a.unique']);
  });
});

// ── Against the real cards ──────────────────────────────────────────────────

describe('the real roster', () => {
  it('builds a legal default deck for the starting party', () => {
    const deck = defaultDeckFor(CARD_DEFS, DEFAULT_PARTY);
    expect(validateDeck(CARD_DEFS, deck, DEFAULT_PARTY).ok).toBe(true);
  });

  it('spends the full budget for every three-card character', () => {
    const deck = defaultDeckFor(CARD_DEFS, ['ivy', 'saber', 'bruno']);

    for (const id of ['ivy', 'saber', 'bruno']) {
      expect(countForCharacter(CARD_DEFS, deck, id)).toBe(CARDS_PER_CHARACTER);
    }
  });

  it('holds Hollis to the budget despite his fourth card', () => {
    const deck = defaultDeckFor(CARD_DEFS, ['hollis']);
    expect(countForCharacter(CARD_DEFS, deck, 'hollis')).toBe(CARDS_PER_CHARACTER);
  });

  it('gives every character a card set that respects their own limits', () => {
    for (const characterId of ['ivy', 'saber', 'cask', 'lyra', 'bruno', 'hollis', 'emrys', 'vesper', 'thane']) {
      const deck = defaultDeckFor(CARD_DEFS, [characterId]);

      for (const [cardId, count] of Object.entries(deck)) {
        const definition = CARD_DEFS[cardId];
        expect(definition, cardId).toBeDefined();
        expect(count, cardId).toBeLessThanOrEqual(COPY_LIMITS[definition!.tier]);
      }
    }
  });
});
