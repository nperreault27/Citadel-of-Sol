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
  maxHealth: 230,
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

  // ══ Lyra — Fatigue ══
  {
    id: 'lyra.refrain',
    name: 'Refrain',
    description: 'Give one ally 1 Strength.',
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
    name: 'Dirge',
    description: 'Apply 1 Fatigue to one enemy.',
    ownerId: 'lyra',
    energyCost: 1,
    staminaCost: 25,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'fatigue', stacks: 1, duration: UNTIL_REST }],
  },
  {
    id: 'lyra.requiem',
    name: 'Requiem',
    description: 'Apply 1 Fatigue to all enemies — or 3 if only one remains.',
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
    name: 'Jab',
    description: 'Deal damage to one enemy.',
    ownerId: 'bruno',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 55 }],
  },
  {
    id: 'bruno.hook',
    name: 'Hook',
    description: 'Deal heavy damage to one enemy.',
    ownerId: 'bruno',
    energyCost: 2,
    staminaCost: 50,
    target: 'oneEnemy',
    // 2.5x a Jab.
    effects: [{ type: 'damage', power: 137 }],
  },
  {
    id: 'bruno.haymaker',
    name: 'Haymaker',
    description: 'Deal enormous damage. Bruno is spent for the rest of the turn.',
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
    name: 'Strike',
    description: 'Deal damage to one enemy.',
    ownerId: 'hollis',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    // Counter Attack fires at this same power — see COUNTER_ATTACK_POWER.
    effects: [{ type: 'damage', power: 45 }],
  },
  {
    id: 'hollis.goad',
    name: 'Goad',
    description: 'Taunt +1. Single-target attacks must hit Hollis. Area attacks ignore it.',
    ownerId: 'hollis',
    energyCost: 1,
    staminaCost: 20,
    target: 'self',
    effects: [{ type: 'status', kind: 'taunt', stacks: 1, duration: PER_TURN_STACK }],
  },
  {
    id: 'hollis.rebound',
    name: 'Rebound',
    description: 'Gain 3 Counter Attack. Each spends a stack to strike back when attacked.',
    ownerId: 'hollis',
    energyCost: 1,
    staminaCost: 25,
    target: 'self',
    effects: [{ type: 'status', kind: 'counter', stacks: 3, duration: PERMANENT }],
  },
  {
    id: 'hollis.ironclad',
    name: 'Ironclad',
    description: 'Take no damage until your next turn. Buffs and debuffs still apply.',
    ownerId: 'hollis',
    energyCost: 3,
    staminaCost: 40,
    target: 'self',
    effects: [{ type: 'status', kind: 'immunity', stacks: 1, duration: UNTIL_NEXT_TURN }],
  },

  // == Emrys - chain damage ==
  {
    id: 'emrys.bolt',
    name: 'Bolt',
    description: 'Deal damage to one enemy.',
    ownerId: 'emrys',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 55 }],
  },
  {
    id: 'emrys.arc',
    name: 'Arc',
    description: 'Strike an enemy, then keep arcing to any enemy while the lightning holds.',
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
    name: 'Reserve',
    description: 'Restore 40 stamina to an ally. Puts an exhausted ally back on their feet.',
    ownerId: 'emrys',
    energyCost: 1,
    staminaCost: 15,
    target: 'oneAlly',
    effects: [{ type: 'restoreStamina', amount: 40 }],
  },

  // == Vesper - health as a resource ==
  {
    id: 'vesper.bloodlet',
    name: 'Bloodlet',
    description: 'Pay 15% of your max health to strike hard.',
    ownerId: 'vesper',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    healthCostFraction: 0.15,
    effects: [{ type: 'damage', power: 85 }],
  },
  {
    id: 'vesper.siphon',
    name: 'Siphon',
    description: 'Deal damage and heal for half of it.',
    ownerId: 'vesper',
    energyCost: 1,
    staminaCost: 20,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60, lifesteal: 0.5 }],
  },
  {
    id: 'vesper.undying',
    name: 'Undying',
    description: 'Gain 1 Undying. When an enemy falls, heal 50%, or rise if you are down.',
    ownerId: 'vesper',
    energyCost: 2,
    staminaCost: 30,
    target: 'self',
    effects: [{ type: 'status', kind: 'undying', stacks: 1, duration: PERMANENT }],
  },

  // == Thane - shields ==
  {
    id: 'thane.ward',
    name: 'Ward',
    description: 'Shield an ally for 25% of your own max health.',
    ownerId: 'thane',
    energyCost: 1,
    staminaCost: 25,
    target: 'oneAlly',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.25 }],
  },
  {
    id: 'thane.cover',
    name: 'Cover',
    description: 'Shield the whole team, splitting 45% of your max health between them.',
    ownerId: 'thane',
    energyCost: 2,
    staminaCost: 40,
    target: 'allAllies',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.45, split: true }],
  },
  {
    id: 'thane.brace',
    name: 'Brace',
    description: 'Give one ally 1 Defense Up.',
    ownerId: 'thane',
    energyCost: 0,
    staminaCost: 10,
    target: 'oneAlly',
    effects: [{ type: 'status', kind: 'defenseUp', stacks: 1, duration: PERMANENT }],
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
  {
    id: 'team.forecast',
    name: 'Forecast',
    description: 'Look at the top 3 cards. Keep one, discard the rest.',
    ownerId: null,
    energyCost: 0,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'revealAndKeep', look: 3 }],
  },
  {
    id: 'team.sift',
    name: 'Sift',
    description: 'Discard a card, then draw 2.',
    ownerId: null,
    energyCost: 1,
    staminaCost: 0,
    target: 'none',
    effects: [{ type: 'discardThenDraw', draw: 2 }],
  },
  {
    id: 'team.poultice',
    name: 'Poultice',
    description: "Restore 15% of an ally's max health. Revives a downed ally.",
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
 * How many copies of each card a character contributes when equipped.
 *
 * Three of each basic, two of each special, one of each unique — so a typical
 * hand usually holds something playable for more than one character, and the
 * uniques feel like an occasion.
 */
const CHARACTER_DECKS: Record<string, string[]> = {
  ivy: [...repeat('ivy.inject', 3), ...repeat('ivy.disperse', 2), 'ivy.cascade'],
  saber: [...repeat('saber.sever', 3), ...repeat('saber.crossfade', 2), 'saber.exsanguinate'],
  cask: [...repeat('cask.buckshot', 3), ...repeat('cask.overdraw', 2), 'cask.winded'],
  lyra: [...repeat('lyra.refrain', 3), ...repeat('lyra.dirge', 2), 'lyra.requiem'],
  bruno: [...repeat('bruno.jab', 3), ...repeat('bruno.hook', 2), 'bruno.haymaker'],
  // Four cards rather than three, but the same six-card share of the pile, so
  // equipping Hollis doesn't crowd out the other two.
  hollis: [...repeat('hollis.strike', 3), 'hollis.goad', 'hollis.rebound', 'hollis.ironclad'],
  emrys: [...repeat('emrys.bolt', 3), ...repeat('emrys.arc', 2), 'emrys.reserve'],
  vesper: [...repeat('vesper.bloodlet', 3), ...repeat('vesper.siphon', 2), 'vesper.undying'],
  thane: [...repeat('thane.ward', 3), ...repeat('thane.cover', 2), 'thane.brace'],
};

/** Cards every deck gets, regardless of who is equipped. */
const NEUTRAL_DECK: string[] = [
  ...repeat('team.regroup', 2),
  ...repeat('team.forecast', 2),
  'team.sift',
  'team.poultice',
];

/**
 * Builds the shared draw pile from whoever is equipped.
 *
 * This is what the owner tag on every card was for: equip Lyra and her cards
 * enter the pile, bench her and they are gone. An unknown id contributes
 * nothing rather than throwing, so a stale save cannot break a battle.
 */
export function buildDeck(equipped: readonly string[]): string[] {
  const deck: string[] = [];
  for (const id of equipped) {
    deck.push(...(CHARACTER_DECKS[id] ?? []));
  }
  return [...deck, ...NEUTRAL_DECK];
}

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
 * Builds the arena battle for a given party.
 *
 * Unknown or downed-out ids are dropped, and the party is capped at
 * `PARTY_SIZE`, so a corrupt save can only ever produce a smaller battle rather
 * than a broken one.
 */
export function createArenaBattle(
  equipped: readonly string[] = DEFAULT_PARTY,
  seed = Date.now() % 2147483647
): CombatState {
  const party = equipped
    .slice(0, PARTY_SIZE)
    .map(characterById)
    .filter((character): character is Combatant => character !== undefined);

  const roster = party.length > 0 ? party : DEFAULT_PARTY.map((id) => characterById(id)!);

  const options: CreateCombatOptions = {
    combatants: [...roster, ...ENEMIES],
    deck: buildDeck(roster.map((character) => character.id)),
    seed,
  };

  return createCombat(options);
}
