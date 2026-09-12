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

// ── The bestiary ────────────────────────────────────────────────────────────
//
// Each entry below is an archetype — a *kind* of enemy, not one on the field.
// Teams further down instantiate them, numbering the copies. Everything keyed
// by kind (move lists, sprite frames) is keyed by the archetype id, so a team
// of four costs one move list and one frame.

interface FoeStats {
  health: number;
  attack: number;
  defense: number;
  speed: number;
  stamina: number;
}

/** An archetype, at full health with nothing on it. */
function foe(archetype: string, name: string, stats: FoeStats): Combatant {
  return {
    id: archetype,
    archetype,
    name,
    team: 'enemy',
    health: stats.health,
    maxHealth: stats.health,
    stamina: stats.stamina,
    maxStamina: stats.stamina,
    attack: stats.attack,
    defense: stats.defense,
    speed: stats.speed,
    statuses: [],
    shield: 0,
    downed: false,
    resting: false,
  };
}

/**
 * `count` of an archetype, ready to put on the field.
 *
 * Copies are numbered in both id and name, because the player has to be able to
 * tell them apart on two screens at once — the panel row and the arena. A lone
 * enemy keeps its bare name: "Bulwark", not "Bulwark 1".
 */
function squad(base: Combatant, count: number): Combatant[] {
  if (count === 1) return [{ ...base }];

  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `${base.archetype ?? base.id}${index + 1}`,
    name: `${base.name} ${index + 1}`,
  }));
}

export const OGRE = foe('ogre', 'Ogre', {
  health: 400,
  attack: 110,
  defense: 40,
  speed: 6,
  stamina: 140,
});

export const IMP = foe('imp', 'Imp', {
  health: 120,
  attack: 70,
  defense: 15,
  speed: 9,
  stamina: 80,
});

/** Fragile and fast, and there are always more of them than you want. */
export const RATKIN = foe('ratkin', 'Ratkin', {
  health: 120,
  attack: 72,
  defense: 12,
  speed: 15,
  stamina: 70,
});

/** Defense 72 is 41% damage taken. Raw power is the wrong tool. */
export const BULWARK = foe('bulwark', 'Bulwark', {
  health: 420,
  attack: 92,
  defense: 72,
  speed: 3,
  stamina: 120,
});

/** Soft, and makes the Bulwark worse every turn it is allowed to live. */
export const ACOLYTE = foe('acolyte', 'Acolyte', {
  health: 100,
  attack: 45,
  defense: 10,
  speed: 11,
  stamina: 60,
});

/** Cask's mechanic, pointed the other way. */
export const SAPPER = foe('sapper', 'Sapper', {
  health: 250,
  attack: 82,
  defense: 25,
  speed: 12,
  stamina: 90,
});

/** Hands out shields sized from its own modest bulk. Kill it first. */
export const CANTOR = foe('cantor', 'Cantor', {
  health: 160,
  attack: 50,
  defense: 30,
  speed: 10,
  stamina: 100,
});

export const WARDEN = foe('warden', 'Warden', {
  health: 230,
  attack: 88,
  defense: 40,
  speed: 7,
  stamina: 100,
});

/** Heals off your losses as well as its own hits. */
export const REVENANT = foe('revenant', 'Revenant', {
  health: 360,
  attack: 100,
  defense: 35,
  speed: 11,
  stamina: 110,
});

export const GHOUL = foe('ghoul', 'Ghoul', {
  health: 130,
  attack: 65,
  defense: 20,
  speed: 9,
  stamina: 70,
});

/** Punishes hitting often. One big blow costs far less than five small ones. */
export const HEXWEAVER = foe('hexweaver', 'Hexweaver', {
  health: 190,
  attack: 72,
  defense: 30,
  speed: 13,
  stamina: 85,
});

/** Alone on purpose: every "if only one enemy remains" payoff turns on here. */
export const TYRANT = foe('tyrant', 'Tyrant', {
  health: 780,
  attack: 125,
  defense: 55,
  speed: 8,
  stamina: 160,
});

/**
 * Barely dangerous herself — Attack 55 and one weak swing. The brood does the
 * damage, which is what makes her the clock rather than the threat.
 */
export const BROODMOTHER = foe('broodmother', 'Broodmother', {
  health: 620,
  attack: 55,
  defense: 60,
  speed: 4,
  stamina: 150,
});

/** 40 health and Attack 95: dies to anything, ruins you if ignored. */
export const CHITTERLING = foe('chitterling', 'Chitterling', {
  health: 40,
  attack: 95,
  defense: 5,
  speed: 16,
  stamina: 40,
});

// ── Enemy teams ─────────────────────────────────────────────────────────────

export type EnemyTier = 1 | 2 | 3;

export interface EnemyTeam {
  id: string;
  name: string;
  tier: EnemyTier;
  /** The question this fight asks of a party, in a line. */
  pitch: string;
  members: Combatant[];
}

/**
 * Every fight in the game.
 *
 * Each team asks one question a party can either answer or not — armour, swarm,
 * exhaustion, protection, attrition, retaliation. That is what makes choosing
 * three of nine characters a decision: there is no party that is right for all
 * of these, which is the entire point of having more than one.
 *
 * Tiers 1 and 2 are side-grades within themselves, not a ladder. Tier is a
 * rough difficulty band, and the fights inside one are meant to be taken in any
 * order.
 *
 * Every number here is a first pass, eyeballed against the original Ogre fight.
 * Run `npm run balance` after touching any of it.
 */
export const ENEMY_TEAMS: EnemyTeam[] = [
  {
    id: 'arena',
    name: 'Ogre and Imps',
    tier: 1,
    pitch: 'One big threat and two small ones.',
    members: [...squad(OGRE, 1), ...squad(IMP, 2)],
  },
  {
    id: 'pack',
    name: 'Ratkin Pack',
    tier: 1,
    pitch: 'Do you have an answer to numbers?',
    members: squad(RATKIN, 5),
  },
  {
    id: 'wall',
    name: 'Bulwark and Acolyte',
    tier: 1,
    pitch: 'Can you get through armour?',
    members: [...squad(BULWARK, 1), ...squad(ACOLYTE, 1)],
  },
  {
    id: 'sappers',
    name: 'The Sappers',
    tier: 1,
    pitch: 'Can you fight tired?',
    members: squad(SAPPER, 3),
  },
  {
    id: 'choir',
    name: 'The Choir',
    tier: 2,
    pitch: 'Can you kill the right thing first?',
    members: [...squad(CANTOR, 1), ...squad(WARDEN, 2)],
  },
  {
    id: 'revenant',
    name: 'The Revenant',
    tier: 2,
    pitch: 'Can you afford to lose anyone?',
    members: [...squad(REVENANT, 1), ...squad(GHOUL, 2)],
  },
  {
    id: 'hexweavers',
    name: 'The Hexweavers',
    tier: 2,
    pitch: 'Can you play around a counter?',
    members: squad(HEXWEAVER, 3),
  },
  {
    id: 'tyrant',
    // Written as a tier 2 side-grade and moved up on the evidence: the probe
    // puts a greedy AI at 31% here against 77-85% across the rest of tier 2.
    // That is a capstone, not a variation.
    name: 'The Tyrant',
    tier: 3,
    pitch: 'One enemy, and it hits like all of them.',
    members: squad(TYRANT, 1),
  },
  {
    id: 'brood',
    name: 'The Broodmother',
    tier: 3,
    pitch: 'Can you spend your turns on the right target?',
    members: squad(BROODMOTHER, 1),
  },
];

export function enemyTeamById(id: string): EnemyTeam | undefined {
  return ENEMY_TEAMS.find((team) => team.id === id);
}

/** The fight a fresh save is pointed at, and the fallback for an unknown id. */
export const DEFAULT_ENCOUNTER = 'arena';

/** The teams of one tier, in declaration order. */
export function teamsOfTier(tier: EnemyTier): EnemyTeam[] {
  return ENEMY_TEAMS.filter((team) => team.tier === tier);
}

/** Every tier that has a team in it, ascending. */
export function enemyTiers(): EnemyTier[] {
  return [...new Set(ENEMY_TEAMS.map((team) => team.tier))].sort((a, b) => a - b);
}

/**
 * The team the arena currently fights.
 *
 * One line, because encounter selection does not exist yet — point this at a
 * different team to play it. When a picker arrives this becomes a default
 * rather than the only option.
 */
export const ENEMIES: Combatant[] = enemyTeamById(DEFAULT_ENCOUNTER)!.members;

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
//
// Move lists are keyed by archetype, so every Ratkin on the field shares one.
//
// Two rules shape everything here:
//
//   Support targets the whole team, never one ally. `enemyTargets` picks a
//   single target uniformly at random, with no idea who needs it — a one-ally
//   heal would land on a full-health enemy as readily as a dying one. An
//   `allAllies` effect has nothing to get wrong.
//
//   Weights are public. The move sheet prints each move's share of the roll, so
//   a list reads as a personality: a 3/1 split says "mostly hits you, and
//   sometimes does the frightening thing".

const OGRE_ACTIONS: EnemyAction[] = [
  {
    id: 'ogre.smash',
    name: 'Smash',
    description: 'Deal heavy damage to one of your party.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 80 }],
  },
  {
    id: 'ogre.sweep',
    name: 'Sweep',
    description: 'Deal damage to your whole party.',
    weight: 1,
    target: 'allEnemies',
    effects: [{ type: 'damage', power: 45 }],
  },
];

const IMP_ACTIONS: EnemyAction[] = [
  {
    id: 'imp.scratch',
    name: 'Scratch',
    description: 'Deal damage to one of your party.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60 }],
  },
  {
    id: 'imp.jinx',
    name: 'Jinx',
    description: 'Apply 1 Weakness to one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'weakness', stacks: 1, duration: PERMANENT }],
  },
];

// ══ Ratkin Pack — "do you have an answer to numbers?" ══
//
// Four of them, so the board-wide cards stop being luxuries. Also the fight
// where Hollis's Rebound earns its slot: three Counter stacks against four
// separate attackers is three free hits a turn.

const RATKIN_ACTIONS: EnemyAction[] = [
  {
    id: 'ratkin.gnash',
    name: 'Gnash',
    description: 'Deal damage to one of your party.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 55 }],
  },
  {
    id: 'ratkin.swarm',
    name: 'Swarm',
    description: 'Deal light damage to your whole party.',
    weight: 1,
    target: 'allEnemies',
    effects: [{ type: 'damage', power: 28 }],
  },
];

// ══ Bulwark and Acolyte — "can you get through armour?" ══
//
// Defense 72 guts raw damage. Poison does not care: it ticks a percentage of
// max health and ignores Defense entirely, so this is the fight that argues for
// Ivy. The Acolyte makes the wall thicker every turn it lives, which is the
// other half of the lesson — kill the right one first.

const BULWARK_ACTIONS: EnemyAction[] = [
  {
    id: 'bulwark.slam',
    name: 'Slam',
    description: 'Deal heavy damage to one of your party.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 85 }],
  },
  {
    id: 'bulwark.tremor',
    name: 'Tremor',
    description: 'Deal damage to your whole party.',
    weight: 1,
    target: 'allEnemies',
    effects: [{ type: 'damage', power: 45 }],
  },
];

const ACOLYTE_ACTIONS: EnemyAction[] = [
  {
    id: 'acolyte.litany',
    name: 'Litany',
    description: 'Give every enemy 1 Defense Up.',
    weight: 2,
    target: 'allAllies',
    effects: [{ type: 'status', kind: 'defenseUp', stacks: 1, duration: PERMANENT }],
  },
  {
    id: 'acolyte.rebuke',
    name: 'Rebuke',
    description: 'Deal light damage to one of your party.',
    weight: 2,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 40 }],
  },
];

// ══ The Sappers — "can you fight tired?" ══
//
// Cask's drain and Lyra's Fatigue, aimed at the player. Fatigue multiplies
// every later stamina loss, so the two moves compound: the longer this runs,
// the more each Sap takes. Emrys's Reserve goes from filler to essential.

const SAPPER_ACTIONS: EnemyAction[] = [
  {
    id: 'sapper.sap',
    name: 'Sap',
    description: 'Deal damage to one of your party and drain 55 stamina.',
    weight: 3,
    target: 'oneEnemy',
    effects: [
      // Draining to zero benches a character for the rest of the turn, but
      // upkeep then hands the bar back in full and clears the Fatigue with it —
      // so the drain buys tempo, not attrition. The damage is what actually
      // closes the fight, and without it the Sappers were an inconvenience
      // rather than a threat.
      { type: 'damage', power: 62 },
      { type: 'drainStamina', amount: 55 },
    ],
  },
  {
    id: 'sapper.enervate',
    name: 'Enervate',
    description: 'Apply 1 Fatigue to your whole party.',
    weight: 1,
    target: 'allEnemies',
    effects: [{ type: 'status', kind: 'fatigue', stacks: 1, duration: UNTIL_REST }],
  },
];

// ══ The Choir — "can you kill the right thing first?" ══
//
// The Cantor's shields are sized off its own health, exactly as Thane's are, so
// killing it is worth far more than the 160 health it is holding. Poison walks
// straight through the shields, which is the same reason Ivy answers Thane.

const CANTOR_ACTIONS: EnemyAction[] = [
  {
    id: 'cantor.hymn',
    name: 'Bulwark Hymn',
    description: 'Shield every enemy, sized from the Cantor’s own health.',
    weight: 2,
    target: 'allAllies',
    effects: [{ type: 'shield', fractionOfSourceMaxHealth: 0.35 }],
  },
  {
    id: 'cantor.anthem',
    name: 'Anthem',
    description: 'Give every enemy 1 Strength.',
    weight: 1,
    target: 'allAllies',
    effects: [{ type: 'status', kind: 'strength', stacks: 1, duration: PERMANENT }],
  },
  {
    id: 'cantor.rebuke',
    name: 'Rebuke',
    description: 'Deal light damage to one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 45 }],
  },
];

const WARDEN_ACTIONS: EnemyAction[] = [
  {
    id: 'warden.crush',
    name: 'Crush',
    description: 'Deal heavy damage to one of your party.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 75 }],
  },
  {
    id: 'warden.guard',
    name: 'Guard',
    description: 'The Warden gains 1 Defense Up.',
    weight: 1,
    target: 'self',
    effects: [{ type: 'status', kind: 'defenseUp', stacks: 1, duration: PERMANENT }],
  },
];

// ══ The Revenant — "can you afford to lose anyone?" ══
//
// Undying pays out to the *opposing* team when a combatant falls, so the
// Revenant's stack cashes in when one of the player's party goes down: half its
// health back, for free, as a reward for your worst turn. Letting someone drop
// is not a setback here, it is a gift to the other side.

const REVENANT_ACTIONS: EnemyAction[] = [
  {
    id: 'revenant.drain',
    name: 'Drain',
    description: 'Deal damage to one of your party and heal for half of it.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 70, lifesteal: 0.5 }],
  },
  {
    id: 'revenant.gorge',
    name: 'Gorge',
    description: 'The Revenant gains 1 Undying, healing it when one of your party falls.',
    weight: 1,
    target: 'self',
    effects: [{ type: 'status', kind: 'undying', stacks: 1, duration: PERMANENT }],
  },
];

const GHOUL_ACTIONS: EnemyAction[] = [
  {
    id: 'ghoul.rend',
    name: 'Rend',
    description: 'Deal damage to one of your party.',
    weight: 3,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 55 }],
  },
  {
    id: 'ghoul.feast',
    name: 'Feast',
    description: 'Deal light damage to one of your party and heal for all of it.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 35, lifesteal: 1 }],
  },
];

// ══ The Hexweavers — "can you play around a counter?" ══
//
// Counter fires on being attacked, even when the blow is blocked, and spends a
// stack each time. So it prices hits, not damage: Emrys's Arc and Saber's
// Exsanguinate walk into one counter per strike, while a single Haymaker eats
// exactly one. Poison ticks are not attacks and provoke nothing at all.

const HEXWEAVER_ACTIONS: EnemyAction[] = [
  {
    id: 'hexweaver.lash',
    name: 'Lash',
    description: 'Deal damage to one of your party.',
    weight: 2,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 60 }],
  },
  {
    id: 'hexweaver.curse',
    name: 'Curse',
    description: 'Apply 1 Weakness to one of your party.',
    weight: 2,
    target: 'oneEnemy',
    effects: [{ type: 'status', kind: 'weakness', stacks: 1, duration: PERMANENT }],
  },
  {
    id: 'hexweaver.thornmail',
    name: 'Thornmail',
    description: 'Give every enemy 2 Counter Attack.',
    weight: 1,
    target: 'allAllies',
    effects: [{ type: 'status', kind: 'counter', stacks: 2, duration: PERMANENT }],
  },
];

// ══ The Tyrant — "one enemy, and it hits like all of them" ══
//
// Being alone is the design. Every "if only one enemy remains" payoff the
// roster has and never gets to use turns on here: Requiem's tripled Fatigue,
// Goad with exactly one attacker to soak, Winded stealing a whole turn rather
// than a third of one.

const TYRANT_ACTIONS: EnemyAction[] = [
  {
    id: 'tyrant.cleave',
    name: 'Cleave',
    description: 'Deal heavy damage to your whole party.',
    weight: 3,
    target: 'allEnemies',
    effects: [{ type: 'damage', power: 70 }],
  },
  {
    id: 'tyrant.execute',
    name: 'Execute',
    description: 'Deal enormous damage to one of your party.',
    weight: 2,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 120 }],
  },
  {
    id: 'tyrant.sunder',
    name: 'Sunder',
    description: 'Apply 1 Weakness to your whole party and drain 25 stamina from each.',
    weight: 1,
    target: 'allEnemies',
    effects: [
      { type: 'status', kind: 'weakness', stacks: 1, duration: PERMANENT },
      { type: 'drainStamina', amount: 25 },
    ],
  },
  {
    id: 'tyrant.enrage',
    name: 'Enrage',
    description: 'The Tyrant gains 2 Strength.',
    weight: 1,
    target: 'self',
    effects: [{ type: 'status', kind: 'strength', stacks: 2, duration: PERMANENT }],
  },
];

// ══ The Broodmother — "can you spend your turns on the right target?" ══
//
// She barely hurts you. Attack 55 and one weak swing, against a brood that hits
// for roughly twice what she does — which is the whole design. Every turn poses
// the same question: clear the Chitterlings, which does nothing to win, or hit
// the mother and take the brood's full damage for another round.
//
// It is the one fight here where killing is mandatory and never progress. Three
// rules hold it together, and all three live outside this list: summons arrive
// too late to join the enemy queue and so act a turn later, the cap stops the
// brood outgrowing any answer, and the brood is swept off the board when she
// falls, so she is unambiguously the clock.

const BROOD_CAP = 4;

const BROODMOTHER_ACTIONS: EnemyAction[] = [
  {
    id: 'broodmother.spawn',
    name: 'Spawn Brood',
    description: 'Call in 2 Chitterlings. They act from next turn.',
    weight: 2,
    // Summoning reads the summoner, not a target — see the effect's own note.
    target: 'none',
    effects: [{ type: 'summon', archetype: 'chitterling', count: 2, max: BROOD_CAP }],
  },
  {
    id: 'broodmother.shriek',
    name: 'Shriek',
    description: 'Apply 1 Fatigue to your whole party.',
    weight: 2,
    target: 'allEnemies',
    effects: [{ type: 'status', kind: 'fatigue', stacks: 1, duration: UNTIL_REST }],
  },
  {
    id: 'broodmother.lash',
    name: 'Lash',
    description: 'Deal light damage to one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 50 }],
  },
];

/** One move, and it is the only reason the brood is frightening. */
const CHITTERLING_ACTIONS: EnemyAction[] = [
  {
    id: 'chitterling.savage',
    name: 'Savage',
    description: 'Deal heavy damage to one of your party.',
    weight: 1,
    target: 'oneEnemy',
    effects: [{ type: 'damage', power: 95 }],
  },
];

export const COMBAT_CONTENT: CombatContent = {
  cardDefs: CARD_DEFS,
  summonable: {
    chitterling: CHITTERLING,
  },
  enemyActions: {
    ogre: OGRE_ACTIONS,
    imp: IMP_ACTIONS,
    ratkin: RATKIN_ACTIONS,
    bulwark: BULWARK_ACTIONS,
    acolyte: ACOLYTE_ACTIONS,
    sapper: SAPPER_ACTIONS,
    cantor: CANTOR_ACTIONS,
    warden: WARDEN_ACTIONS,
    revenant: REVENANT_ACTIONS,
    ghoul: GHOUL_ACTIONS,
    hexweaver: HEXWEAVER_ACTIONS,
    tyrant: TYRANT_ACTIONS,
    broodmother: BROODMOTHER_ACTIONS,
    chitterling: CHITTERLING_ACTIONS,
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
  seed = Date.now() % 2147483647,
  encounter: string = DEFAULT_ENCOUNTER
): CombatState {
  const party = equipped
    .slice(0, PARTY_SIZE)
    .map(characterById)
    .filter((character): character is Combatant => character !== undefined);

  const roster = party.length > 0 ? party : DEFAULT_PARTY.map((id) => characterById(id)!);

  // An unknown id falls back rather than throwing, for the same reason a corrupt
  // party does: a bad value should cost the player the fight they picked, not
  // the ability to start one.
  const team = enemyTeamById(encounter) ?? enemyTeamById(DEFAULT_ENCOUNTER)!;

  const options: CreateCombatOptions = {
    combatants: [...roster, ...team.members],
    deck: expandDeck(deck),
    seed,
  };

  return createCombat(options);
}
