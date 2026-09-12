import { describe, expect, it } from 'vitest';
import {
  canPlayCard,
  chooseTarget,
  createCombat,
  endPlayerTurn,
  resolveEnemyTurn,
  selectCard,
} from '@/game/combat/engine';
import { stacksOf } from '@/game/combat/status';
import { poisonTickDamage, missingStaminaBonus, computeDamage } from '@/game/combat/stats';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from '@/game/combat/types';

/**
 * Poison, Bleed and stamina drain, against a controlled fixture rather than the
 * real party — so tuning `content.ts` never breaks a rules test.
 */

const PERMANENT: StatusDuration = { kind: 'permanent' };
const POISON_2: StatusDuration = { kind: 'turns', remaining: 2 };

function hero(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'hero',
    name: 'Hero',
    team: 'player',
    health: 200,
    maxHealth: 200,
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
  poisonHit: {
    id: 'poisonHit',
    tier: 'basic',
    name: 'Inject',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'poison', stacks: 1, duration: POISON_2 }],
  },
  cascade: {
    id: 'cascade',
    tier: 'basic',
    name: 'Cascade',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'allEnemies',
    // Stack first, then extend — so the new stack is extended too.
    effects: [
      { type: 'status', kind: 'poison', stacks: 1, duration: POISON_2 },
      { type: 'extendPoison', turns: 1 },
    ],
  },
  bleedHit: {
    id: 'bleedHit',
    tier: 'basic',
    name: 'Sever',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [
      { type: 'damage', power: 50 },
      { type: 'status', kind: 'bleed', stacks: 1, duration: PERMANENT },
    ],
  },
  plainHit: {
    id: 'plainHit',
    tier: 'basic',
    name: 'Jab',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 50 }],
  },
  aoeHit: {
    id: 'aoeHit',
    tier: 'basic',
    name: 'Sweep',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'allEnemies',
    effects: [{ type: 'damage', power: 50 }],
  },
  drain: {
    id: 'drain',
    tier: 'basic',
    name: 'Buckshot',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'drainStamina', amount: 40 }],
  },
  winded: {
    id: 'winded',
    tier: 'basic',
    name: 'Winded',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [{ type: 'drainStamina', amount: 'all' }],
  },
  overdraw: {
    id: 'overdraw',
    tier: 'basic',
    name: 'Overdraw',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'oneEnemy',
    effects: [
      { type: 'damage', power: 35, scaling: { kind: 'missingStamina', bonusPower: 75, exponent: 2 } },
    ],
    energyOnStaminaEmpty: 1,
  },
  exsanguinate: {
    id: 'exsanguinate',
    tier: 'basic',
    name: 'Exsanguinate',
    description: '',
    brief: '',
    ownerId: 'hero',
    energyCost: 1,
    staminaCost: 10,
    target: 'none',
    effects: [{ type: 'discardHandAndAttack', power: 50, bleedStacks: 1 }],
  },
};

const PASSIVE: EnemyAction[] = [];

function battle(options: { combatants?: Combatant[]; deck?: string[] } = {}) {
  const combatants = options.combatants ?? [hero(), foe()];
  const enemyActions: Record<string, EnemyAction[]> = {};
  for (const c of combatants) if (c.team === 'enemy') enemyActions[c.id] = PASSIVE;

  const state = createCombat({
    combatants,
    deck: options.deck ?? Array.from({ length: 12 }, () => 'plainHit'),
    seed: 42,
  });

  return { state, content: { cardDefs: CARDS, enemyActions } satisfies CombatContent };
}

function findInHand(state: CombatState, definitionId: string): string {
  const found = state.hand.find((id) => state.cards[id]?.definitionId === definitionId);
  if (!found) throw new Error(`no ${definitionId} in hand`);
  return found;
}

function play(state: CombatState, content: CombatContent, def: string, target?: string) {
  const card = findInHand(state, def);
  const mid = selectCard(state, content, card);
  return target ? chooseTarget(mid, content, target) : mid;
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

// ── Poison ──────────────────────────────────────────────────────────────────

describe('poison', () => {
  it('deals 5% of max health per stack, ignoring Defense', () => {
    // The point of poison ignoring the mitigation curve: a 200-DEF wall takes
    // exactly the same tick as a naked one.
    expect(poisonTickDamage(1, 200)).toBe(10);
    expect(poisonTickDamage(3, 200)).toBe(30);
    expect(poisonTickDamage(2, 400)).toBe(40);
  });

  it('ticks at the end of the victim team turn', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'poisonHit') });
    const applied = play(state, content, 'poisonHit', 'foe');

    expect(applied.combatants['foe']?.health).toBe(200);

    const afterTurn = passTurn(applied, content);
    // 1 stack on a 200 maxHP target = 10.
    expect(afterTurn.combatants['foe']?.health).toBe(190);
  });

  it('ticks twice over its two-turn timer, then expires', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'poisonHit') });
    let current = play(state, content, 'poisonHit', 'foe');

    current = passTurn(current, content); // tick 1
    expect(current.combatants['foe']?.health).toBe(190);

    current = passTurn(current, content); // tick 2
    expect(current.combatants['foe']?.health).toBe(180);

    current = passTurn(current, content); // expired
    expect(current.combatants['foe']?.health).toBe(180);
    expect(stacksOf(current.combatants['foe']!.statuses, 'poison')).toBe(0);
  });

  it('tracks separate applications as independent stacks', () => {
    // Applied a turn apart, the two stacks must expire a turn apart rather than
    // merging into one entry that dies all at once.
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'poisonHit') });

    let current = play(state, content, 'poisonHit', 'foe');
    current = passTurn(current, content); // stack A ticks once
    current = play(current, content, 'poisonHit', 'foe'); // stack B applied

    expect(current.combatants['foe']!.statuses.filter((s) => s.kind === 'poison')).toHaveLength(2);

    current = passTurn(current, content); // both tick: 2 stacks = 20
    expect(current.combatants['foe']?.health).toBe(200 - 10 - 20);

    // Stack A is now spent; only B remains.
    expect(stacksOf(current.combatants['foe']!.statuses, 'poison')).toBe(1);
  });

  it('does not drain stamina', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'poisonHit') });
    const after = passTurn(play(state, content, 'poisonHit', 'foe'), content);

    expect(after.combatants['foe']?.stamina).toBe(100);
  });

  it('does not weaken its bearer', () => {
    // netStrengthStacks once counted every non-Strength entry as Weakness,
    // which would have made Poison quietly halve the victim's own Attack.
    const poisoned = hero({ statuses: [{ kind: 'poison', stacks: 3, duration: POISON_2 }] });
    expect(computeDamage(poisoned, foe(), 50)).toBe(50);
  });

  it('can finish a target', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ health: 5 })],
      deck: Array.from({ length: 12 }, () => 'poisonHit'),
    });
    const after = passTurn(play(state, content, 'poisonHit', 'foe'), content);

    expect(after.combatants['foe']?.downed).toBe(true);
    expect(after.phase).toBe('victory');
  });
});

describe('cascade', () => {
  it('adds a stack to every enemy', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ id: 'a' }), foe({ id: 'b' })],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    const after = play(state, content, 'cascade');

    expect(stacksOf(after.combatants['a']?.statuses ?? [], 'poison')).toBe(1);
    expect(stacksOf(after.combatants['b']?.statuses ?? [], 'poison')).toBe(1);
  });

  it('does not consume existing poison', () => {
    // The old Cascade detonated and cleared the board. It no longer does.
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'poison', stacks: 4, duration: POISON_2 }] })],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    const after = play(state, content, 'cascade');

    expect(stacksOf(after.combatants['foe']?.statuses ?? [], 'poison')).toBe(5);
    // And nothing was dealt up front.
    expect(after.combatants['foe']?.health).toBe(200);
  });

  it('extends existing poison by a turn', () => {
    const { state, content } = battle({
      combatants: [
        hero(),
        foe({ statuses: [{ kind: 'poison', stacks: 2, duration: { kind: 'turns', remaining: 1 } }] }),
      ],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    const after = play(state, content, 'cascade');
    const entry = (after.combatants['foe']?.statuses ?? []).find(
      (e) => e.kind === 'poison' && e.stacks === 2
    );

    expect(entry?.duration).toEqual({ kind: 'turns', remaining: 2 });
  });

  it('extends the stack it just applied, landing it at 3 turns', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'cascade') });
    const after = play(state, content, 'cascade');

    const entry = (after.combatants['foe']?.statuses ?? []).find((e) => e.kind === 'poison');
    expect(entry?.duration).toEqual({ kind: 'turns', remaining: 3 });
  });

  it('merges into one entry when the durations line up', () => {
    // Existing 2-turn poison plus a fresh 2-turn stack merge, then extend
    // together — one badge, not two.
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'poison', stacks: 2, duration: POISON_2 }] })],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    const poison = (play(state, content, 'cascade').combatants['foe']?.statuses ?? []).filter(
      (e) => e.kind === 'poison'
    );

    expect(poison).toHaveLength(1);
    expect(poison[0]?.stacks).toBe(3);
    expect(poison[0]?.duration).toEqual({ kind: 'turns', remaining: 3 });
  });

  it('keeps staggered stacks staggered', () => {
    const { state, content } = battle({
      combatants: [
        hero(),
        foe({
          statuses: [
            { kind: 'poison', stacks: 1, duration: { kind: 'turns', remaining: 1 } },
            { kind: 'poison', stacks: 1, duration: { kind: 'turns', remaining: 2 } },
          ],
        }),
      ],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    const poison = (play(state, content, 'cascade').combatants['foe']?.statuses ?? [])
      .filter((e) => e.kind === 'poison')
      .map((e) => (e.duration.kind === 'turns' ? e.duration.remaining : -1))
      .sort();

    // 1 to 2, 2 to 3, and the fresh 2-turn stack merged with the existing one.
    expect(poison).toEqual([2, 3]);
  });

  it('buys poison an extra tick of damage', () => {
    // The point of the card: more ticks, rather than one burst.
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'poison', stacks: 1, duration: POISON_2 }] })],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    let current = play(state, content, 'cascade');
    for (let i = 0; i < 4; i++) current = passTurn(current, content);

    // 2 stacks ticking for 10 each, over 3 turns before they expire.
    expect(current.combatants['foe']?.health).toBe(200 - 60);
  });

  it('does nothing to a downed enemy', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ id: 'a' }), foe({ id: 'b', downed: true, health: 0 })],
      deck: Array.from({ length: 12 }, () => 'cascade'),
    });

    const after = play(state, content, 'cascade');
    expect(stacksOf(after.combatants['b']?.statuses ?? [], 'poison')).toBe(0);
  });
});

// ── Bleed ───────────────────────────────────────────────────────────────────

describe('bleed', () => {
  it('doubles the next attack and consumes one stack', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'bleed', stacks: 2, duration: PERMANENT }] })],
    });

    const after = play(state, content, 'plainHit', 'foe');

    // 100 attack x 50% power = 50, doubled to 100.
    expect(after.combatants['foe']?.health).toBe(100);
    expect(stacksOf(after.combatants['foe']!.statuses, 'bleed')).toBe(1);
  });

  it('doubles after mitigation, not before', () => {
    const { state, content } = battle({
      combatants: [
        hero(),
        foe({ defense: 50, statuses: [{ kind: 'bleed', stacks: 1, duration: PERMANENT }] }),
      ],
    });

    // 50 raw, halved to 25 by DEF 50, then doubled to 50.
    const after = play(state, content, 'plainHit', 'foe');
    expect(after.combatants['foe']?.health).toBe(150);
  });

  it('is spent one stack per attack, not all at once', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ health: 1000, maxHealth: 1000, statuses: [{ kind: 'bleed', stacks: 3, duration: PERMANENT }] })],
    });

    let current = play(state, content, 'plainHit', 'foe');
    expect(stacksOf(current.combatants['foe']!.statuses, 'bleed')).toBe(2);

    current = play(current, content, 'plainHit', 'foe');
    expect(stacksOf(current.combatants['foe']!.statuses, 'bleed')).toBe(1);
  });

  it('takes one stack from each target of an area attack', () => {
    const { state, content } = battle({
      combatants: [
        hero(),
        foe({ id: 'a', statuses: [{ kind: 'bleed', stacks: 2, duration: PERMANENT }] }),
        foe({ id: 'b', statuses: [{ kind: 'bleed', stacks: 1, duration: PERMANENT }] }),
      ],
      deck: Array.from({ length: 12 }, () => 'aoeHit'),
    });

    const after = play(state, content, 'aoeHit');

    expect(stacksOf(after.combatants['a']!.statuses, 'bleed')).toBe(1);
    expect(stacksOf(after.combatants['b']!.statuses, 'bleed')).toBe(0);
    expect(after.combatants['a']?.health).toBe(100);
    expect(after.combatants['b']?.health).toBe(100);
  });

  it('has no timer — it waits until something attacks', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ statuses: [{ kind: 'bleed', stacks: 1, duration: PERMANENT }] })],
    });

    let current = state;
    for (let i = 0; i < 5; i++) current = passTurn(current, content);

    expect(stacksOf(current.combatants['foe']!.statuses, 'bleed')).toBe(1);
  });

  it('is not consumed by a poison tick', () => {
    const { state, content } = battle({
      combatants: [
        hero(),
        foe({
          statuses: [
            { kind: 'bleed', stacks: 1, duration: PERMANENT },
            { kind: 'poison', stacks: 1, duration: POISON_2 },
          ],
        }),
      ],
    });

    const after = passTurn(state, content);
    expect(stacksOf(after.combatants['foe']!.statuses, 'bleed')).toBe(1);
  });

  it('applies a stack when the attack that lands also inflicts it', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'bleedHit') });
    const after = play(state, content, 'bleedHit', 'foe');

    // The stack is applied after the hit resolves, so this attack is not doubled.
    expect(after.combatants['foe']?.health).toBe(150);
    expect(stacksOf(after.combatants['foe']!.statuses, 'bleed')).toBe(1);
  });
});

// ── Stamina drain ───────────────────────────────────────────────────────────

describe('stamina drain', () => {
  it('removes a flat amount', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'drain') });
    const after = play(state, content, 'drain', 'foe');

    expect(after.combatants['foe']?.stamina).toBe(60);
  });

  it('empties the bar outright with amount "all"', () => {
    const { state, content } = battle({ deck: Array.from({ length: 12 }, () => 'winded') });
    const after = play(state, content, 'winded', 'foe');

    expect(after.combatants['foe']?.stamina).toBe(0);
    expect(after.combatants['foe']?.resting).toBe(true);
  });

  it('costs a drained enemy their entire next turn', () => {
    // This is the whole point of Cask. The rest flag is set during the player's
    // turn and only cleared in the enemy's own end-of-turn upkeep, so the enemy
    // is skipped in between.
    const biter: EnemyAction[] = [
      { id: 'bite', name: 'Bite', description: 'Bite one of your party.', weight: 1, target: 'oneEnemy', effects: [{ type: 'damage', power: 50 }] },
    ];

    const combatants = [hero(), foe()];
    const state = createCombat({
      combatants,
      deck: Array.from({ length: 12 }, () => 'winded'),
      seed: 42,
    });
    const content: CombatContent = { cardDefs: CARDS, enemyActions: { foe: biter } };

    const drained = play(state, content, 'winded', 'foe');
    const afterEnemyTurn = passTurn(drained, content);

    // The enemy never got to act.
    expect(afterEnemyTurn.combatants['hero']?.health).toBe(200);
    // And is refreshed for the turn after.
    expect(afterEnemyTurn.combatants['foe']?.stamina).toBe(100);
    expect(afterEnemyTurn.combatants['foe']?.resting).toBe(false);
  });
});

describe('overdraw scaling', () => {
  it('adds nothing against a full stamina bar', () => {
    expect(missingStaminaBonus(foe(), 75, 2)).toBe(0);
  });

  it('curves rather than scaling linearly', () => {
    // Half drained yields a quarter of the bonus at exponent 2 — that curve is
    // what makes committing to the drain plan pay, instead of a free bonus.
    expect(missingStaminaBonus(foe({ stamina: 50 }), 75, 2)).toBeCloseTo(18.75, 5);
    expect(missingStaminaBonus(foe({ stamina: 25 }), 75, 2)).toBeCloseTo(42.1875, 5);
    expect(missingStaminaBonus(foe({ stamina: 0 }), 75, 2)).toBeCloseTo(75, 5);
  });

  it('hits far harder on a worn-down target', () => {
    const fresh = battle({ combatants: [hero(), foe()], deck: Array.from({ length: 12 }, () => 'overdraw') });
    const worn = battle({
      combatants: [hero(), foe({ stamina: 0 })],
      deck: Array.from({ length: 12 }, () => 'overdraw'),
    });

    const freshDamage = 200 - (play(fresh.state, fresh.content, 'overdraw', 'foe').combatants['foe']?.health ?? 0);
    const wornDamage = 200 - (play(worn.state, worn.content, 'overdraw', 'foe').combatants['foe']?.health ?? 0);

    expect(freshDamage).toBe(35);
    expect(wornDamage).toBe(110);
  });

  it('refunds energy when it empties the target', () => {
    const { state, content } = battle({
      // Low stamina and low max health, so the damage-drain finishes the bar.
      combatants: [hero(), foe({ stamina: 5, maxStamina: 100 })],
      deck: Array.from({ length: 12 }, () => 'overdraw'),
    });

    const after = play(state, content, 'overdraw', 'foe');

    expect(after.combatants['foe']?.stamina).toBe(0);
    // 5 energy, minus 1 for the card, plus the 1 refund.
    expect(after.energy).toBe(5);
  });

  it('gives no refund when the target was already empty', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ stamina: 0 })],
      deck: Array.from({ length: 12 }, () => 'overdraw'),
    });

    const after = play(state, content, 'overdraw', 'foe');
    expect(after.energy).toBe(4);
  });
});

// ── Exsanguinate ────────────────────────────────────────────────────────────

describe('exsanguinate', () => {
  it('discards the rest of the hand and strikes once per card', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ health: 1000, maxHealth: 1000 })],
      deck: ['exsanguinate', ...Array.from({ length: 11 }, () => 'plainHit')],
    });

    const before = state.hand.length; // 5
    const after = play(state, content, 'exsanguinate');

    expect(after.hand).toHaveLength(0);

    // 4 remaining cards → 4 strikes of 50. The first is not doubled (no bleed
    // yet); each strike then leaves a stack that the next one consumes.
    // 50 + 100 + 100 + 100 = 350.
    expect(before).toBe(5);
    expect(after.combatants['foe']?.health).toBe(1000 - 350);
  });

  it('does nothing extra with an otherwise empty hand', () => {
    const { state, content } = battle({
      deck: ['exsanguinate', ...Array.from({ length: 11 }, () => 'plainHit')],
    });

    // Empty the hand down to just the unique.
    const card = findInHand(state, 'exsanguinate');
    const trimmed: CombatState = { ...state, hand: [card] };

    const after = play(trimmed, content, 'exsanguinate');
    expect(after.combatants['foe']?.health).toBe(200);
  });

  it('costs no extra stamina per generated strike', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ health: 1000, maxHealth: 1000 })],
      deck: ['exsanguinate', ...Array.from({ length: 11 }, () => 'plainHit')],
    });

    const after = play(state, content, 'exsanguinate');

    // Only the card's own 10 stamina, not 10 per strike.
    expect(after.combatants['hero']?.stamina).toBe(90);
  });

  it('never targets a downed enemy', () => {
    const { state, content } = battle({
      combatants: [hero(), foe({ id: 'a', health: 1000, maxHealth: 1000 }), foe({ id: 'b', downed: true, health: 0 })],
      deck: ['exsanguinate', ...Array.from({ length: 11 }, () => 'plainHit')],
    });

    const after = play(state, content, 'exsanguinate');
    expect(after.combatants['b']?.health).toBe(0);
    expect(after.combatants['a']!.health).toBeLessThan(1000);
  });

  it('is playable, and the emptied hand refills at end of turn', () => {
    // The foe needs to survive the volley — otherwise the battle ends and
    // endPlayerTurn correctly does nothing, which isn't what this is testing.
    const { state, content } = battle({
      combatants: [hero(), foe({ health: 1000, maxHealth: 1000 })],
      deck: ['exsanguinate', ...Array.from({ length: 11 }, () => 'plainHit')],
    });

    expect(canPlayCard(state, content, findInHand(state, 'exsanguinate')).ok).toBe(true);

    const emptied = play(state, content, 'exsanguinate');
    expect(emptied.hand).toHaveLength(0);

    const after = passTurn(emptied, content);
    expect(after.hand).toHaveLength(after.handLimit);
  });

  it('ends the battle rather than refilling when the volley wins it', () => {
    const { state, content } = battle({
      deck: ['exsanguinate', ...Array.from({ length: 11 }, () => 'plainHit')],
    });

    const after = passTurn(play(state, content, 'exsanguinate'), content);
    expect(after.phase).toBe('victory');
  });
});
