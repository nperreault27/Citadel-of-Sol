import { describe, expect, it } from 'vitest';
import {
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  resolveSelection,
  selectCard,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import {
  computeDamage,
  DEFENSE_K,
  fatigueMultiplier,
  RESTING_DAMAGE_MULTIPLIER,
  STAMINA_REGEN_FRACTION,
} from '@/game/combat/stats';
import { defaultDeck, DEFAULT_PARTY, ROSTER, characterById } from '@/game/combat/content';
import { expandDeck } from '@/game/combat/deckbuilding';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from '@/game/combat/types';

const UNTIL_REST: StatusDuration = { kind: 'untilRest' };
const PERMANENT: StatusDuration = { kind: 'permanent' };

function hero(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero',
    name: 'Hero',
    team: 'player',
    health: 400,
    maxHealth: 400,
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
  cheap: {
    id: 'cheap',
    tier: 'basic',
    name: 'Cheap',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 10 }],
  },
  fatigueHit: {
    id: 'fatigueHit',
    tier: 'basic',
    name: 'Dirge',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'fatigue', stacks: 1, duration: UNTIL_REST }],
  },
  requiem: {
    id: 'requiem',
    tier: 'basic',
    name: 'Requiem',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'allEnemies',
    effects: [
      { type: 'focusedStatus', kind: 'fatigue', stacks: 1, soloStacks: 3, duration: UNTIL_REST },
    ],
  },
  drain: {
    id: 'drain',
    tier: 'basic',
    name: 'Buckshot',
    description: '',
    brief: '',
    ownerId: 'hero',
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'drainStamina', amount: 40 }],
  },
  forecast: {
    id: 'forecast',
    tier: 'basic',
    name: 'Forecast',
    description: '',
    brief: '',
    ownerId: null,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'revealAndKeep', look: 3 }],
  },
  sift: {
    id: 'sift',
    tier: 'basic',
    name: 'Sift',
    description: '',
    brief: '',
    ownerId: null,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'discardThenDraw', draw: 2 }],
  },
  poultice: {
    id: 'poultice',
    tier: 'basic',
    name: 'Poultice',
    description: '',
    brief: '',
    ownerId: null,
    staminaCost: 0,
    target: 'oneAlly',
    effects: [{ type: 'healPercent', fraction: 0.15 }],
  },
};

const PASSIVE: EnemyAction[] = [];

function battle(options: { combatants?: Combatant[]; deck?: string[] } = {}) {
  const combatants = options.combatants ?? [hero(), foe()];
  const enemyActions: Record<string, EnemyAction[]> = {};
  for (const c of combatants) if (c.team === 'enemy') enemyActions[c.id] = PASSIVE;

  const state = createCombat({
    combatants,
    deck: options.deck ?? Array.from({ length: 12 }, () => 'cheap'),
    seed: 42,
  });

  return { state, content: { cardDefs: CARDS, enemyActions } satisfies CombatContent };
}

function findInHand(state: CombatState, definitionId: string): string {
  const found = state.hand.find((id) => state.cards[id]?.definitionId === definitionId);
  if (!found) throw new Error('card not in hand: ' + definitionId);
  return found;
}

function play(state: CombatState, content: CombatContent, def: string, target?: string) {
  const card = findInHand(state, def);
  const mid = selectCard(state, content, card);
  return target ? chooseTarget(mid, content, target) : mid;
}

function passTurn(state: CombatState, content: CombatContent): CombatState {
  return resolveEnemyTurn(endPlayerTurn(state, content), content);
}

// ── Fatigue ─────────────────────────────────────────────────────────────────

describe('fatigueMultiplier', () => {
  it('compounds 20% per stack, matching how Strength stacks', () => {
    expect(fatigueMultiplier([])).toBe(1);
    expect(fatigueMultiplier([{ kind: 'fatigue', stacks: 1, duration: UNTIL_REST }])).toBeCloseTo(1.2, 10);
    expect(fatigueMultiplier([{ kind: 'fatigue', stacks: 2, duration: UNTIL_REST }])).toBeCloseTo(1.44, 10);
    expect(fatigueMultiplier([{ kind: 'fatigue', stacks: 3, duration: UNTIL_REST }])).toBeCloseTo(1.728, 10);
  });

  it('ignores other statuses', () => {
    expect(fatigueMultiplier([{ kind: 'poison', stacks: 5, duration: PERMANENT }])).toBe(1);
  });
});

describe('damage against a resting character', () => {
  it('lands harder than the same hit on a standing one', () => {
    const attacker = hero({ attack: 100 });
    const standing = foe({ defense: 0 });
    const asleep = foe({ defense: 0, stamina: 0, resting: true });

    const normal = computeDamage(attacker, standing, 100);
    expect(computeDamage(attacker, asleep, 100)).toBe(
      Math.round(normal * RESTING_DAMAGE_MULTIPLIER)
    );
  });

  it('applies after Defense, so the increase is the same fraction for everyone', () => {
    const attacker = hero({ attack: 100 });

    // A wall and a glass cannon each take the same proportional punishment for
    // being caught out, which is what putting it after mitigation buys.
    for (const defense of [0, 30, 80]) {
      const standing = foe({ defense });
      const asleep = foe({ defense, stamina: 0, resting: true });

      const normal = computeDamage(attacker, standing, 100);
      const caught = computeDamage(attacker, asleep, 100);
      expect(caught / normal).toBeCloseTo(RESTING_DAMAGE_MULTIPLIER, 1);
    }
  });

  it('leaves a standing target alone', () => {
    const attacker = hero({ attack: 100 });
    const target = foe({ defense: 20 });

    expect(computeDamage(attacker, target, 100)).toBe(
      Math.round(attacker.attack * 1 * (DEFENSE_K / (DEFENSE_K + 20)))
    );
  });
});

describe('fatigue in play', () => {
  it('amplifies the stamina cost of playing a card', () => {
    const { state, content } = battle({
      combatants: [hero({ statuses: [{ kind: 'fatigue', stacks: 1, duration: UNTIL_REST }] }), foe()],
    });

    // A 20-stamina card costs 24 under one stack.
    const after = play(state, content, 'cheap', 'foe');
    expect(after.combatants['hero']?.stamina).toBe(76);
  });

  it('amplifies drain from taking damage', () => {
    const plain = battle({ combatants: [hero(), foe({ attack: 400 })] });
    const tired = battle({
      combatants: [
        hero({ statuses: [{ kind: 'fatigue', stacks: 2, duration: UNTIL_REST }] }),
        foe({ attack: 400 }),
      ],
    });

    const bite: EnemyAction[] = [
      { id: 'b', name: 'Bite', description: 'Bite one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'damage', power: 40 }] },
    ];
    const withBite = (c: CombatContent): CombatContent => ({ ...c, enemyActions: { foe: bite } });

    const a = passTurn(plain.state, withBite(plain.content));
    const b = passTurn(tired.state, withBite(tired.content));

    // The player turn has opened by the time this is read, so its regeneration
    // is already in the bar and has to come back out.
    const regen = Math.round(100 * STAMINA_REGEN_FRACTION);
    const drainedA = 100 - ((a.combatants['hero']?.stamina ?? 0) - regen);
    const drainedB = 100 - ((b.combatants['hero']?.stamina ?? 0) - regen);

    expect(drainedB).toBeGreaterThan(drainedA);
    expect(drainedB).toBe(Math.round(drainedA * 1.44));
  });

  it('amplifies a direct drain', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'fatigue', stacks: 1, duration: UNTIL_REST }] })],
      deck: Array.from({ length: 12 }, () => 'drain'),
    });

    // 40 requested becomes 48.
    const after = play(state, content, 'drain', 'foe');
    expect(after.combatants['foe']?.stamina).toBe(52);
  });

  it('survives turns without expiring', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'fatigue', stacks: 2, duration: UNTIL_REST }] })],
    });

    let current = state;
    for (let i = 0; i < 5; i++) current = passTurn(current, content);

    expect(stacksOf(current.combatants['foe']?.statuses ?? [], 'fatigue')).toBe(2);
  });

  it('falls off when the bearer is worn down and rests', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ stamina: 10, statuses: [{ kind: 'fatigue', stacks: 2, duration: UNTIL_REST }] })],
      deck: Array.from({ length: 12 }, () => 'drain'),
    });

    const drained = play(state, content, 'drain', 'foe');
    expect(drained.combatants['foe']?.resting).toBe(true);
    // Still fatigued while benched.
    expect(stacksOf(drained.combatants['foe']?.statuses ?? [], 'fatigue')).toBe(2);

    const recovered = passTurn(drained, content);
    expect(recovered.combatants['foe']?.resting).toBe(false);
    expect(stacksOf(recovered.combatants['foe']?.statuses ?? [], 'fatigue')).toBe(0);
  });

  it('does not weaken Attack', () => {
    const { state, content } = battle({
      combatants: [hero({ statuses: [{ kind: 'fatigue', stacks: 3, duration: UNTIL_REST }] }), foe()],
    });

    // 100 attack x 10% power, no mitigation.
    expect(play(state, content, 'cheap', 'foe').combatants['foe']?.health).toBe(390);
  });
});

describe('focusedStatus', () => {
  it('spreads one stack across a group', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ id: 'a' }), foe({ id: 'b' })],
      deck: Array.from({ length: 12 }, () => 'requiem'),
    });

    const after = play(state, content, 'requiem');

    expect(stacksOf(after.combatants['a']?.statuses ?? [], 'fatigue')).toBe(1);
    expect(stacksOf(after.combatants['b']?.statuses ?? [], 'fatigue')).toBe(1);
  });

  it('concentrates on a lone survivor', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ id: 'a' })],
      deck: Array.from({ length: 12 }, () => 'requiem'),
    });

    expect(stacksOf(play(state, content, 'requiem').combatants['a']?.statuses ?? [], 'fatigue')).toBe(3);
  });

  it('counts only living enemies when deciding', () => {
    // A downed enemy must not stop the card treating this as one-on-one.
    const { state, content } = battle({
      combatants: [hero(), foe({ id: 'a' }), foe({ id: 'b', downed: true, health: 0 })],
      deck: Array.from({ length: 12 }, () => 'requiem'),
    });

    const after = play(state, content, 'requiem');
    expect(stacksOf(after.combatants['a']?.statuses ?? [], 'fatigue')).toBe(3);
    expect(stacksOf(after.combatants['b']?.statuses ?? [], 'fatigue')).toBe(0);
  });
});

// ── Card selection ──────────────────────────────────────────────────────────

describe('revealAndKeep', () => {
  it('parks the battle until the player chooses', () => {
    const { state, content } = battle({
      deck: ['forecast', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const revealed = play(state, content, 'forecast');

    expect(revealed.phase).toBe('selecting');
    expect(revealed.selection?.kind).toBe('keepOne');
    expect(revealed.selection?.cards).toHaveLength(3);
  });

  it('keeps one and discards the rest', () => {
    const { state, content } = battle({
      deck: ['forecast', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const revealed = play(state, content, 'forecast');
    const handBefore = revealed.hand.length;
    const chosen = revealed.selection?.cards[0] ?? '';

    const done = resolveSelection(revealed, chosen);

    expect(done.phase).toBe('selectCard');
    expect(done.hand).toHaveLength(handBefore + 1);
    expect(done.hand).toContain(chosen);
    expect(done.discardPile).toContain(revealed.selection?.cards[1]);
    expect(done.discardPile).toContain(revealed.selection?.cards[2]);
  });

  it('never loses a card while the choice is open', () => {
    // The revealed cards belong to no pile mid-choice, so this is the moment a
    // card could quietly vanish.
    const { state, content } = battle({
      deck: ['forecast', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const revealed = play(state, content, 'forecast');
    const accounted =
      revealed.hand.length +
      revealed.drawPile.length +
      revealed.discardPile.length +
      revealed.exhaustPile.length +
      (revealed.selection?.cards.length ?? 0);

    expect(accounted).toBe(Object.keys(revealed.cards).length);
  });

  it('refuses a card that was not offered', () => {
    const { state, content } = battle({
      deck: ['forecast', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const revealed = play(state, content, 'forecast');
    expect(resolveSelection(revealed, revealed.hand[0] ?? '')).toBe(revealed);
  });

  it('blocks other cards while the choice is open', () => {
    const { state, content } = battle({
      deck: ['forecast', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const revealed = play(state, content, 'forecast');
    const other = revealed.hand.find((id) => revealed.cards[id]?.definitionId === 'cheap') ?? '';

    expect(selectCard(revealed, content, other)).toBe(revealed);
  });
});

describe('discardThenDraw', () => {
  it('asks which card to throw, then draws', () => {
    const { state, content } = battle({
      deck: ['sift', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const prompted = play(state, content, 'sift');
    expect(prompted.phase).toBe('selecting');
    expect(prompted.selection?.kind).toBe('discardOne');

    const victim = prompted.hand[0] ?? '';
    const handBefore = prompted.hand.length;
    const done = resolveSelection(prompted, victim);

    // Minus the discard, plus two drawn.
    expect(done.hand).toHaveLength(handBefore - 1 + 2);
    expect(done.discardPile).toContain(victim);
    expect(done.phase).toBe('selectCard');
  });

  it('skips the prompt when the hand is already empty', () => {
    const { state, content } = battle({
      deck: ['sift', ...Array.from({ length: 11 }, () => 'cheap')],
    });

    const card = findInHand(state, 'sift');
    const onlyCard: CombatState = { ...state, hand: [card] };
    const done = selectCard(onlyCard, content, card);

    expect(done.phase).toBe('selectCard');
    expect(done.hand).toHaveLength(2);
  });
});

describe('healPercent', () => {
  it('scales with the target max health', () => {
    const { state, content } = battle({
      combatants: [hero({ health: 100, maxHealth: 400 }), foe()],
      deck: Array.from({ length: 12 }, () => 'poultice'),
    });

    // 15% of 400.
    expect(play(state, content, 'poultice', 'hero').combatants['hero']?.health).toBe(160);
  });

  it('revives a downed ally', () => {
    const { state, content } = battle({
      combatants: [hero(), hero({ id: 'ally', health: 0, maxHealth: 200, downed: true }), foe()],
      deck: Array.from({ length: 12 }, () => 'poultice'),
    });

    const after = play(state, content, 'poultice', 'ally');
    expect(after.combatants['ally']?.downed).toBe(false);
    expect(after.combatants['ally']?.health).toBe(30);
  });

  it('never overheals', () => {
    const { state, content } = battle({
      combatants: [hero({ health: 400, maxHealth: 400 }), foe()],
      deck: Array.from({ length: 12 }, () => 'poultice'),
    });

    expect(play(state, content, 'poultice', 'hero').combatants['hero']?.health).toBe(400);
  });
});

// ── Roster-driven decks ─────────────────────────────────────────────────────

describe('deck building against real content', () => {
  it('only offers cards owned by the equipped party', () => {
    const deck = defaultDeck(['lyra']);

    expect(Object.keys(deck).some((id) => id.startsWith('lyra.'))).toBe(true);
    expect(Object.keys(deck).some((id) => id.startsWith('ivy.'))).toBe(false);
    expect(Object.keys(deck).some((id) => id.startsWith('bruno.'))).toBe(false);
  });

  it('always offers the neutral cards', () => {
    expect(Object.keys(defaultDeck([])).every((id) => id.startsWith('team.'))).toBe(true);
    expect(expandDeck(defaultDeck([])).length).toBeGreaterThan(0);
  });

  it('grows with each character equipped', () => {
    const one = expandDeck(defaultDeck(['ivy'])).length;
    const two = expandDeck(defaultDeck(['ivy', 'saber'])).length;
    expect(two).toBeGreaterThan(one);
  });

  it('ignores an unknown id rather than throwing', () => {
    expect(() => defaultDeck(['nobody'])).not.toThrow();
    expect(defaultDeck(['nobody'])).toEqual(defaultDeck([]));
  });

  it('gives every roster member cards to bring', () => {
    const neutralOnly = expandDeck(defaultDeck([])).length;
    for (const character of ROSTER) {
      expect(expandDeck(defaultDeck([character.id])).length).toBeGreaterThan(neutralOnly);
    }
  });

  it('covers the default party', () => {
    for (const id of DEFAULT_PARTY) {
      expect(characterById(id)).toBeDefined();
    }
  });
});
