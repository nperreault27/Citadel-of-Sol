/**
 * The starting party, their decks, and the arena's enemy group.
 *
 * This is where every tunable number lives — the engine imports none of it.
 * Run `npm run balance` after changing anything here.
 *
 * Stat conventions:
 *   Attack   ~100 is the baseline. Card power is a percentage of it, so a
 *            power-70 card on a 100-Attack character lands around 70 before
 *            mitigation.
 *   Defense  mitigation is 50/(50+DEF), so DEF 50 halves incoming damage.
 *   Stamina  100 baseline; a hit worth 25% of max health drains half the bar.
 *            At zero the character sits out the rest of the turn.
 */

import { POISON_DURATION_TURNS } from './stats';
import { createCombat, type CreateCombatOptions } from './engine';
import type {
  CardDefinition,
  Combatant,
  CombatContent,
  CombatState,
  EnemyAction,
  StatusDuration,
} from './types';

/** Strength, Weakness and Bleed all last until the battle ends. */
const PERMANENT: StatusDuration = { kind: 'permanent' };

/** Each Poison application carries its own countdown, so stacks expire apart. */
const POISON_TIMER: StatusDuration = { kind: 'turns', remaining: POISON_DURATION_TURNS };

// ── The party ───────────────────────────────────────────────────────────────

/**
 * Ivy — The Chemist. Trait: Poison.
 *
 * Deals little up front and wins long fights. Her poison ignores Defense, so
 * she is the answer to targets the rest of the party bounces off.
 */
export const IVY: Combatant = {
  id: 'ivy',
  name: 'Ivy',
  team: 'player',
  health: 160,
  maxHealth: 160,
  stamina: 100,
  maxStamina: 100,
  attack: 95,
  defense: 22,
  speed: 11,
  statuses: [],
  downed: false,
  resting: false,
};

/**
 * Saber — The Assassin. Trait: Bleed.
 *
 * Highest Attack and lowest Defense. Bleed doubles her next hit on a target, so
 * her damage comes from setting up and then cashing in.
 */
export const SABER: Combatant = {
  id: 'saber',
  name: 'Saber',
  team: 'player',
  health: 150,
  maxHealth: 150,
  stamina: 100,
  maxStamina: 100,
  attack: 115,
  defense: 18,
  speed: 16,
  statuses: [],
  downed: false,
  resting: false,
};

/**
 * Cask — The Blunderbuss. Trait: stamina drain.
 *
 * Steals turns rather than dealing damage. Draining an enemy to zero during
 * your turn benches them for the whole of theirs, because the rest flag is only
 * cleared during their own end-of-turn upkeep.
 */
export const CASK: Combatant = {
  id: 'cask',
  name: 'Cask',
  team: 'player',
  health: 210,
  maxHealth: 210,
  stamina: 120,
  maxStamina: 120,
  attack: 90,
  defense: 45,
  speed: 7,
  statuses: [],
  downed: false,
  resting: false,
};

export const PARTY: Combatant[] = [IVY, SABER, CASK];

// ── The enemy group ─────────────────────────────────────────────────────────

export const OGRE: Combatant = {
  id: 'ogre',
  name: 'Ogre',
  team: 'enemy',
  health: 400,
  maxHealth: 400,
  stamina: 140,
  maxStamina: 140,
  attack: 110,
  defense: 40,
  speed: 6,
  statuses: [],
  downed: false,
  resting: false,
};

function makeImp(index: number): Combatant {
  return {
    id: `imp${index}`,
    name: `Imp ${index}`,
    team: 'enemy',
    health: 120,
    maxHealth: 120,
    stamina: 80,
    maxStamina: 80,
    attack: 70,
    defense: 15,
    speed: 9,
    statuses: [],
    downed: false,
    resting: false,
  };
}

export const ENEMIES: Combatant[] = [OGRE, makeImp(1), makeImp(2)];

// ── Cards ───────────────────────────────────────────────────────────────────

const CARD_LIST: CardDefinition[] = [
  // ══ Ivy — Poison ══
  {
    id: 'ivy.inject',
    name: 'Inject',
    description: 'Deal damage and apply 1 Poison.',
    ownerId: 'ivy',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [
      { type: 'damage', power: 45 },
      { type: 'status', kind: 'poison', stacks: 1, duration: POISON_TIMER },
    ],
  },
  {
    id: 'ivy.disperse',
    name: 'Disperse',
    description: 'Apply 2 Poison to all enemies.',
    ownerId: 'ivy',
    energyCost: 2,
    staminaCost: 35,
    target: 'allEnemies',
    // No damage: the whole card is board-wide poison setup, which is what makes
    // Cascade worth holding for.
    effects: [{ type: 'status', kind: 'poison', stacks: 2, duration: POISON_TIMER }],
  },
  {
    id: 'ivy.cascade',
    name: 'Cascade',
    description: 'Apply 1 Poison to all enemies, then extend every Poison by 1 turn.',
    ownerId: 'ivy',
    energyCost: 2,
    staminaCost: 30,
    target: 'allEnemies',
    // Order matters: the stack is applied first, so the extend catches it too
    // and it lands as a 3-turn poison rather than the 2 it was applied with.
    effects: [
      { type: 'status', kind: 'poison', stacks: 1, duration: POISON_TIMER },
      { type: 'extendPoison', turns: 1 },
    ],
  },

  // ══ Saber — Bleed ══
  {
    id: 'saber.sever',
    name: 'Sever',
    description: 'Deal damage and apply 1 Bleed.',
    ownerId: 'saber',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [
      { type: 'damage', power: 50 },
      { type: 'status', kind: 'bleed', stacks: 1, duration: PERMANENT },
    ],
  },
  {
    id: 'saber.crossfade',
    name: 'Crossfade',
    description: 'Deal damage to all enemies and apply 1 Bleed to each.',
    ownerId: 'saber',
    energyCost: 2,
    staminaCost: 40,
    target: 'allEnemies',
    effects: [
      { type: 'damage', power: 35 },
      { type: 'status', kind: 'bleed', stacks: 1, duration: PERMANENT },
    ],
  },
  {
    id: 'saber.exsanguinate',
    name: 'Exsanguinate',
    description: 'Discard your hand. Strike a random enemy for each card discarded.',
    ownerId: 'saber',
    energyCost: 3,
    staminaCost: 30,
    target: 'none',
    // The generated strikes cost no extra stamina — the real price is the hand.
    effects: [{ type: 'discardHandAndAttack', power: 50, bleedStacks: 1 }],
  },

  // ══ Cask — Stamina drain ══
  {
    id: 'cask.buckshot',
    name: 'Buckshot',
    description: 'Deal damage and drain 40 stamina.',
    ownerId: 'cask',
    energyCost: 1,
    staminaCost: 25,
    target: 'oneEnemy',
    effects: [
      { type: 'damage', power: 45 },
      { type: 'drainStamina', amount: 40 },
    ],
  },
  {
    id: 'cask.overdraw',
    name: 'Overdraw',
    description: 'Deals far more damage the more stamina the target is missing. Refunds 1 energy if it empties them.',
    ownerId: 'cask',
    energyCost: 1,
    staminaCost: 30,
    target: 'oneEnemy',
    effects: [
      {
        type: 'damage',
        power: 35,
        // Exponent 2: a half-drained target yields only a quarter of the bonus,
        // so this is weak on a fresh enemy and brutal on a worn-down one.
        scaling: { kind: 'missingStamina', bonusPower: 75, exponent: 2 },
      },
    ],
    energyOnStaminaEmpty: 1,
  },
  {
    id: 'cask.winded',
    name: 'Winded',
    description: "Empty a target's stamina completely.",
    ownerId: 'cask',
    energyCost: 3,
    staminaCost: 35,
    target: 'oneEnemy',
    // No damage at all — a guaranteed stolen turn is the whole card.
    effects: [{ type: 'drainStamina', amount: 'all' }],
  },

  // ══ Neutral — no owner, no stamina, but the team must be able to act ══
  {
    id: 'team.regroup',
    name: 'Regroup',
    description: 'Draw 2 cards.',
    ownerId: null,
    energyCost: 1,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'draw', count: 2 }],
  },
];

export const CARD_DEFS: Record<string, CardDefinition> = Object.fromEntries(
  CARD_LIST.map((card) => [card.id, card])
);

/**
 * The shared draw pile, before shuffling.
 *
 * Three copies of each basic, two of each special, one of each unique — so a
 * typical hand usually holds something playable for more than one character,
 * and the uniques feel like an occasion.
 */
export const STARTING_DECK: string[] = [
  ...repeat('ivy.inject', 3),
  ...repeat('ivy.disperse', 2),
  ...repeat('ivy.cascade', 1),

  ...repeat('saber.sever', 3),
  ...repeat('saber.crossfade', 2),
  ...repeat('saber.exsanguinate', 1),

  ...repeat('cask.buckshot', 3),
  ...repeat('cask.overdraw', 2),
  ...repeat('cask.winded', 1),

  ...repeat('team.regroup', 2),
];

function repeat(id: string, times: number): string[] {
  return Array.from({ length: times }, () => id);
}

// ── Enemy behaviour ─────────────────────────────────────────────────────────

const OGRE_ACTIONS: EnemyAction[] = [
  {
    id: 'ogre.smash',
    name: 'Smash',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 80 }],
  },
  {
    id: 'ogre.sweep',
    name: 'Sweep',
    weight: 1,
    target: 'allEnemies',
    effects: [{ type: 'damage', power: 45 }],
  },
];

const IMP_ACTIONS: EnemyAction[] = [
  {
    id: 'imp.scratch',
    name: 'Scratch',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60 }],
  },
  {
    id: 'imp.jinx',
    name: 'Jinx',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'weakness', stacks: 1, duration: PERMANENT }],
  },
];

export const COMBAT_CONTENT: CombatContent = {
  cardDefs: CARD_DEFS,
  enemyActions: {
    ogre: OGRE_ACTIONS,
    imp1: IMP_ACTIONS,
    imp2: IMP_ACTIONS,
  },
};

// ── Battle factory ──────────────────────────────────────────────────────────

/**
 * Builds the arena battle.
 *
 * Party speed totals 34 against the enemies' 24, so the player leads — the
 * friendlier opening while the loop is being tuned.
 */
export function createArenaBattle(seed = Date.now() % 2147483647): CombatState {
  const options: CreateCombatOptions = {
    combatants: [...PARTY, ...ENEMIES],
    deck: STARTING_DECK,
    seed,
  };
  return createCombat(options);
}
