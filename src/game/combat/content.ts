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
import {
  availableCards,
  canAddCopy,
  countForCharacter,
  defaultDeckFor,
  expandDeck,
  pruneToParty,
  validateDeck,
  type DeckList,
} from './deckbuilding';
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

/** Taunt counts down in stacks: one stack is one turn of drawing attacks. */
const PER_TURN_STACK: StatusDuration = { kind: 'perTurnStack' };

/** Immunity expires as Hollis's next turn opens, covering one enemy turn. */
const UNTIL_NEXT_TURN: StatusDuration = { kind: 'untilNextTurn' };

/** Fatigue only leaves when the bearer is worn down to nothing and recovers. */
const UNTIL_REST: StatusDuration = { kind: 'untilRest' };

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
  shield: 0,
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
  shield: 0,
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
  shield: 0,
  downed: false,
  resting: false,
};

/**
 * Lyra — The Bard. Trait: Fatigue.
 *
 * Deals almost no damage herself. She makes an ally hit harder and makes the
 * enemy tire faster, so her value is entirely in what the rest of the team does
 * with the turns she buys.
 */
export const LYRA: Combatant = {
  id: 'lyra',
  name: 'Lyra',
  team: 'player',
  health: 165,
  maxHealth: 165,
  stamina: 100,
  maxStamina: 100,
  attack: 85,
  defense: 30,
  speed: 13,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
};

/**
 * Bruno — The Fighter. Trait: raw damage.
 *
 * No status mechanic at all, which makes him the baseline everything else is
 * measured against. His max stamina is deliberately 100 so Haymaker's cost
 * empties the bar exactly — see the card.
 */
export const BRUNO: Combatant = {
  id: 'bruno',
  name: 'Bruno',
  team: 'player',
  health: 230,
  maxHealth: 150,
  stamina: 100,
  maxStamina: 100,
  attack: 120,
  defense: 35,
  speed: 9,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
};

/**
 * Hollis — The Anvil. Trait: defence.
 *
 * The only character who protects the rest of the team rather than adding to
 * the damage. Highest Defense and health in the roster, lowest Attack — his
 * basic exists mostly so Counter Attack has something to fire.
 */
export const HOLLIS: Combatant = {
  id: 'hollis',
  name: 'Hollis',
  team: 'player',
  health: 280,
  maxHealth: 280,
  stamina: 120,
  maxStamina: 120,
  attack: 75,
  defense: 65,
  speed: 5,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
};

/**
 * Emrys - The Mage. Trait: chain damage.
 *
 * High Attack and almost no Defense. Arc is the only card in the game whose
 * output is genuinely random, so he is the swingy pick.
 */
export const EMRYS: Combatant = {
  id: 'emrys',
  name: 'Emrys',
  team: 'player',
  health: 145,
  maxHealth: 145,
  stamina: 100,
  maxStamina: 100,
  attack: 110,
  defense: 20,
  speed: 12,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
};

/**
 * Vesper - The Vampire. Trait: health as a resource.
 *
 * Spends her own health to hit harder and takes it back off the enemy. Sturdier
 * than she looks, because she has to be: Bloodlet costs 15% of her max health
 * every time she throws it.
 */
export const VESPER: Combatant = {
  id: 'vesper',
  name: 'Vesper',
  team: 'player',
  health: 190,
  maxHealth: 190,
  stamina: 100,
  maxStamina: 100,
  attack: 105,
  defense: 30,
  speed: 14,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
};

/**
 * Thane - The Shielder. Trait: shields.
 *
 * His shields are sized from his own max health, so his bulk is literally what
 * he hands out - the same 60 whether it lands on Emrys or on Hollis. Poison
 * ignores shields entirely, which makes Ivy his hard counter.
 */
export const THANE: Combatant = {
  id: 'thane',
  name: 'Thane',
  team: 'player',
  health: 240,
  maxHealth: 240,
  stamina: 110,
  maxStamina: 110,
  attack: 70,
  defense: 55,
  speed: 8,
  statuses: [],
  shield: 0,
  downed: false,
  resting: false,
};

/** Everyone available to equip. Three of these fight at a time. */
export const ROSTER: Combatant[] = [
  IVY,
  SABER,
  CASK,
  LYRA,
  BRUNO,
  HOLLIS,
  EMRYS,
  VESPER,
  THANE,
];

export const PARTY_SIZE = 3;

/** The party a fresh save starts with. */
export const DEFAULT_PARTY: string[] = [IVY.id, SABER.id, CASK.id];

export function characterById(id: string): Combatant | undefined {
  return ROSTER.find((character) => character.id === id);
}

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
  shield: 0,
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
    shield: 0,
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
    tier: 'basic',
    name: 'Inject',
    description: 'Deal damage and apply 1 Poison.',
    brief: 'Damage and 1 Poison',
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
    tier: 'special',
    name: 'Disperse',
    description: 'Apply 2 Poison to all enemies.',
    brief: '2 Poison to all enemies',
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
    tier: 'unique',
    name: 'Cascade',
    description: 'Apply 1 Poison to all enemies, then extend every Poison by 1 turn.',
    brief: 'Poison all, then extend it',
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
    tier: 'basic',
    name: 'Sever',
    description: 'Deal damage and apply 1 Bleed.',
    brief: 'Damage and 1 Bleed',
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
    tier: 'special',
    name: 'Crossfade',
    description: 'Deal damage to all enemies and apply 1 Bleed to each.',
    brief: 'Damage and Bleed all',
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
    tier: 'unique',
    name: 'Exsanguinate',
    description: 'Discard your hand. Strike a random enemy for each card discarded.',
    brief: 'Dump your hand to strike',
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
    tier: 'basic',
    name: 'Buckshot',
    description: 'Deal damage and drain 40 stamina.',
    brief: 'Damage and drain stamina',
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
    tier: 'special',
    name: 'Overdraw',
    description: 'Deals far more damage the more stamina the target is missing. Refunds 1 energy if it empties them.',
    brief: 'Hits the winded hardest',
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
    tier: 'unique',
    name: 'Winded',
    description: "Empty a target's stamina completely.",
    brief: 'Empty their stamina',
    ownerId: 'cask',
    energyCost: 3,
    staminaCost: 35,
    target: 'oneEnemy',
    // No damage at all — a guaranteed stolen turn is the whole card.
    effects: [{ type: 'drainStamina', amount: 'all' }],
  },

  // ══ Lyra — Fatigue ══
  {
    id: 'lyra.refrain',
    tier: 'basic',
    name: 'Refrain',
    description: 'Give one ally 1 Strength.',
    brief: 'Give an ally Strength',
    ownerId: 'lyra',
    energyCost: 0,
    // Free in energy, so stamina is the only thing rationing it — about four
    // before Lyra benches herself.
    staminaCost: 10,
    target: 'oneAlly',
    effects: [{ type: 'status', kind: 'strength', stacks: 1, duration: PERMANENT }],
  },
  {
    id: 'lyra.dirge',
    tier: 'special',
    name: 'Dirge',
    description: 'Apply 1 Fatigue to one enemy.',
    brief: '1 Fatigue to one enemy',
    ownerId: 'lyra',
    energyCost: 1,
    staminaCost: 25,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'fatigue', stacks: 1, duration: UNTIL_REST }],
  },
  {
    id: 'lyra.requiem',
    tier: 'unique',
    name: 'Requiem',
    description: 'Apply 1 Fatigue to all enemies — or 3 if only one remains.',
    brief: 'Fatigue every enemy',
    ownerId: 'lyra',
    energyCost: 2,
    staminaCost: 35,
    target: 'allEnemies',
    effects: [
      {
        type: 'focusedStatus',
        kind: 'fatigue',
        stacks: 1,
        soloStacks: 3,
        duration: UNTIL_REST,
      },
    ],
  },

  // ══ Bruno — raw damage ══
  {
    id: 'bruno.jab',
    tier: 'basic',
    name: 'Jab',
    description: 'Deal damage to one enemy.',
    brief: 'Damage one enemy',
    ownerId: 'bruno',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 55 }],
  },
  {
    id: 'bruno.hook',
    tier: 'special',
    name: 'Hook',
    description: 'Deal heavy damage to one enemy.',
    brief: 'Heavy damage',
    ownerId: 'bruno',
    energyCost: 2,
    staminaCost: 50,
    target: 'oneEnemy',
    // 2.5x a Jab.
    effects: [{ type: 'damage', power: 137 }],
  },
  {
    id: 'bruno.haymaker',
    tier: 'unique',
    name: 'Haymaker',
    description: 'Deal enormous damage. Bruno is spent for the rest of the turn.',
    brief: 'Huge damage, then spent',
    ownerId: 'bruno',
    energyCost: 3,
    // Exactly his max stamina, so throwing this always benches him — that
    // guaranteed cost is what the 5x is paying for.
    staminaCost: 100,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 275 }],
  },

  // ══ Hollis — defence ══
  {
    id: 'hollis.strike',
    tier: 'basic',
    name: 'Strike',
    description: 'Deal damage to one enemy.',
    brief: 'Damage one enemy',
    ownerId: 'hollis',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    // Counter Attack fires at this same power — see COUNTER_ATTACK_POWER.
    effects: [{ type: 'damage', power: 45 }],
  },
  {
    id: 'hollis.goad',
    tier: 'special',
    name: 'Goad',
    description: 'Taunt +1. Single-target attacks must hit Hollis. Area attacks ignore it.',
    brief: 'Pull attacks onto Hollis',
    ownerId: 'hollis',
    energyCost: 1,
    staminaCost: 20,
    target: 'self',
    effects: [{ type: 'status', kind: 'taunt', stacks: 1, duration: PER_TURN_STACK }],
  },
  {
    id: 'hollis.rebound',
    tier: 'special',
    name: 'Rebound',
    description: 'Gain 3 Counter Attack. Each spends a stack to strike back when attacked.',
    brief: 'Strike back when hit',
    ownerId: 'hollis',
    energyCost: 1,
    staminaCost: 25,
    target: 'self',
    effects: [{ type: 'status', kind: 'counter', stacks: 3, duration: PERMANENT }],
  },
  {
    id: 'hollis.ironclad',
    tier: 'unique',
    name: 'Ironclad',
    description: 'Take no damage until your next turn. Buffs and debuffs still apply.',
    brief: 'Take no damage',
    ownerId: 'hollis',
    energyCost: 3,
    staminaCost: 40,
    target: 'self',
    effects: [{ type: 'status', kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN }],
  },

  // == Emrys - chain damage ==
  {
    id: 'emrys.bolt',
    tier: 'basic',
    name: 'Bolt',
    description: 'Deal damage to one enemy.',
    brief: 'Damage one enemy',
    ownerId: 'emrys',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 55 }],
  },
  {
    id: 'emrys.arc',
    tier: 'special',
    name: 'Arc',
    description: 'Strike an enemy, then keep arcing to any enemy while the lightning holds.',
    brief: 'Lightning chains enemies',
    ownerId: 'emrys',
    energyCost: 2,
    staminaCost: 35,
    target: 'oneEnemy',
    effects: [
      {
        type: 'chainDamage',
        power: 30,
        // Nothing bounds the chain but this roll — it may strike the same enemy
        // repeatedly — so each hit is modest and the total is a long thin tail
        // rather than a reliable burst.
        continueChance: 0.8,
        // Safety valve only: at 80% the odds of reaching this are about 1 in
        // 70,000, so it never shapes play - it just stops a pathological loop.
        maxHits: 50,
      },
    ],
  },
  {
    id: 'emrys.reserve',
    tier: 'unique',
    name: 'Reserve',
    description: 'Restore 40 stamina to an ally. Puts an exhausted ally back on their feet.',
    brief: "Restore an ally's stamina",
    ownerId: 'emrys',
    energyCost: 1,
    staminaCost: 15,
    target: 'oneAlly',
    effects: [{ type: 'restoreStamina', amount: 40 }],
  },

  // == Vesper - health as a resource ==
  {
    id: 'vesper.bloodlet',
    tier: 'basic',
    name: 'Bloodlet',
    description: 'Pay 15% of your max health to strike hard.',
    brief: 'Spend health to hit hard',
    ownerId: 'vesper',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    healthCostFraction: 0.15,
    effects: [{ type: 'damage', power: 85 }],
  },
  {
    id: 'vesper.siphon',
    tier: 'special',
    name: 'Siphon',
    description: 'Deal damage and heal for half of it.',
    brief: 'Damage and heal half',
    ownerId: 'vesper',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60, lifesteal: 0.5 }],
  },
  {
    id: 'vesper.undying',
    tier: 'unique',
    name: 'Undying',
    description: 'Gain 1 Undying. When an enemy falls, heal 50%, or rise if you are down.',
    brief: 'Heal or rise on a kill',
    ownerId: 'vesper',
    energyCost: 2,
    staminaCost: 30,
    target: 'self',
    effects: [{ type: 'status', kind: 'undying', stacks: 1, duration: PERMANENT }],
  },

  // == Thane - shields ==
  {
    id: 'thane.ward',
    tier: 'basic',
    name: 'Ward',
    description: 'Shield an ally for 25% of your own max health.',
    brief: 'Shield an ally',
    ownerId: 'thane',
    energyCost: 1,
    staminaCost: 25,
    target: 'oneAlly',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.25 }],
  },
  {
    id: 'thane.cover',
    tier: 'special',
    name: 'Cover',
    description: 'Shield the whole team, splitting 45% of your max health between them.',
    brief: 'Shield the whole team',
    ownerId: 'thane',
    energyCost: 2,
    staminaCost: 40,
    target: 'allAllies',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.45, split: true }],
  },
  {
    id: 'thane.brace',
    tier: 'unique',
    name: 'Brace',
    description: 'Give one ally 1 Defense Up.',
    brief: 'Give an ally Defense Up',
    ownerId: 'thane',
    energyCost: 0,
    staminaCost: 10,
    target: 'oneAlly',
    effects: [{ type: 'status', kind: 'defenseUp', stacks: 1, duration: PERMANENT }],
  },

  // ══ Neutral — no owner, no stamina, but the team must be able to act ══
  {
    id: 'team.regroup',
    tier: 'basic',
    name: 'Regroup',
    description: 'Draw 2 cards.',
    brief: 'Draw 2 cards',
    ownerId: null,
    energyCost: 1,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'draw', count: 2 }],
  },
  {
    id: 'team.forecast',
    tier: 'basic',
    name: 'Forecast',
    description: 'Look at the top 3 cards. Keep one, discard the rest.',
    brief: 'Keep one of the top 3',
    ownerId: null,
    energyCost: 0,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'revealAndKeep', look: 3 }],
  },
  {
    id: 'team.sift',
    tier: 'basic',
    name: 'Sift',
    description: 'Discard a card, then draw 2.',
    brief: 'Discard 1, draw 2',
    ownerId: null,
    energyCost: 1,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'discardThenDraw', draw: 2 }],
  },
  {
    id: 'team.poultice',
    tier: 'basic',
    name: 'Poultice',
    description: "Restore 15% of an ally's max health. Revives a downed ally.",
    brief: 'Heal or revive an ally',
    ownerId: null,
    energyCost: 1,
    staminaCost: 0,
    target: 'oneAlly',
    effects: [{ type: 'healPercent', fraction: 0.15 }],
  },
];

export const CARD_DEFS: Record<string, CardDefinition> = Object.fromEntries(
  CARD_LIST.map((card) => [card.id, card])
);

/**
 * The deck every save started with before deck building existed.
 *
 * Kept solely so the v2 to v3 save migration has something legal to hand an
 * existing player: three basics, two specials and one unique per character plus
 * six neutrals, which validates cleanly under the copy and budget caps. New
 * saves start with an empty deck and build it themselves.
 */
export const LEGACY_DEFAULT_DECK: DeckList = {
  'ivy.inject': 3,
  'ivy.disperse': 2,
  'ivy.cascade': 1,
  'saber.sever': 3,
  'saber.crossfade': 2,
  'saber.exsanguinate': 1,
  'cask.buckshot': 3,
  'cask.overdraw': 2,
  'cask.winded': 1,
  'team.regroup': 2,
  'team.forecast': 2,
  'team.sift': 1,
  'team.poultice': 1,
};

// ── Deck-building helpers, bound to this game's cards ───────────────────────
//
// `deckbuilding.ts` takes card definitions as an argument so it stays free of
// any dependency on content. These wrappers bind CARD_DEFS once so callers do
// not have to thread it through every call.

export function playerCardPool(party: readonly string[]) {
  return availableCards(CARD_DEFS, party);
}

export function playerCanAddCopy(deck: DeckList, party: readonly string[], cardId: string) {
  return canAddCopy(CARD_DEFS, deck, party, cardId);
}

export function playerDeckValidation(deck: DeckList, party: readonly string[]) {
  return validateDeck(CARD_DEFS, deck, party);
}

export function playerCardsForCharacter(deck: DeckList, characterId: string) {
  return countForCharacter(CARD_DEFS, deck, characterId);
}

export function prunePlayerDeck(deck: DeckList, party: readonly string[]) {
  return pruneToParty(CARD_DEFS, deck, party);
}

/** A full legal deck for a party. For tests and the balance probe only. */
export function defaultDeck(party: readonly string[]): DeckList {
  return defaultDeckFor(CARD_DEFS, party);
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
 * Builds the arena battle for a given party.
 *
 * Unknown or downed-out ids are dropped, and the party is capped at
 * `PARTY_SIZE`, so a corrupt save can only ever produce a smaller battle rather
 * than a broken one.
 */
export function createArenaBattle(
  equipped: readonly string[] = DEFAULT_PARTY,
  deck: DeckList = LEGACY_DEFAULT_DECK,
  seed = Date.now() % 2147483647
): CombatState {
  const party = equipped
    .slice(0, PARTY_SIZE)
    .map(characterById)
    .filter((character): character is Combatant => character !== undefined);

  const roster = party.length > 0 ? party : DEFAULT_PARTY.map((id) => characterById(id)!);

  const options: CreateCombatOptions = {
    combatants: [...roster, ...ENEMIES],
    deck: expandDeck(deck),
    seed,
  };

  return createCombat(options);
}
