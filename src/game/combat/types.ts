/**
 * Combat data model.
 *
 * Everything under `src/game/combat/` is pure TypeScript — no Phaser import, no
 * DOM, no store access — following the same rule as `src/game/systems/`. The
 * engine is a set of pure transitions over an immutable `CombatState`, so the
 * rules can be unit tested without a WebGL context and replayed deterministically
 * from a seed.
 */

export type Team = 'player' | 'enemy';

export type CombatantId = string;
export type CardDefId = string;

/** Identifies one physical copy of a card, so duplicates stay distinguishable. */
export type CardInstanceId = string;

// ── Statuses ────────────────────────────────────────────────────────────────

export type StatusKind = 'strength' | 'weakness' | 'poison' | 'bleed';

/**
 * How a status leaves play.
 *
 * - Strength / Weakness: `permanent`, lasting until the battle ends.
 * - Poison: `turns`, normally 2. Each application is its own countdown, so a
 *   target hit twice carries two independent stacks that expire separately.
 * - Bleed: `permanent`, but consumed a stack at a time by attacks rather than
 *   by any timer.
 */
export type StatusDuration =
  | { kind: 'permanent' }
  | { kind: 'turns'; remaining: number }
  | { kind: 'untilAttacked' };

export interface StatusEntry {
  kind: StatusKind;
  stacks: number;
  duration: StatusDuration;
}

// ── Combatants ──────────────────────────────────────────────────────────────

export interface Combatant {
  id: CombatantId;
  name: string;
  team: Team;

  health: number;
  maxHealth: number;

  /** Base 100 for most characters; spent by acting and drained by taking hits. */
  stamina: number;
  maxStamina: number;

  attack: number;
  defense: number;
  speed: number;

  statuses: StatusEntry[];

  /** Health hit 0. Out of the fight until revived; cards keep circulating. */
  downed: boolean;

  /**
   * Stamina hit 0 this turn, so this character cannot act for the remainder of
   * it. Cleared and stamina refilled during end-of-turn upkeep.
   */
  resting: boolean;
}

// ── Cards ───────────────────────────────────────────────────────────────────

export type TargetKind = 'oneAlly' | 'allAllies' | 'oneEnemy' | 'allEnemies' | 'self' | 'none';

/**
 * Extra card power derived from the target's state, added to the card's base
 * power before the attack resolves.
 *
 * `missingStamina` drives Cask's Overdraw: `bonusPower × missingFraction ^
 * exponent`. An exponent above 1 keeps the bonus small until the target is
 * genuinely worn down, then spikes — which is what makes committing to the
 * drain plan pay off rather than being a flat bonus you get for free.
 */
export interface MissingStaminaScaling {
  kind: 'missingStamina';
  bonusPower: number;
  exponent: number;
}

export type DamageScaling = MissingStaminaScaling;

export type CardEffect =
  | {
      type: 'damage';
      /**
       * Percentage of the attacker's effective Attack. Power 60 means the hit
       * lands at 60% of the user's Attack before the target's mitigation.
       */
      power: number;
      scaling?: DamageScaling;
    }
  | { type: 'heal'; amount: number }
  | { type: 'status'; kind: StatusKind; stacks: number; duration: StatusDuration }
  | { type: 'draw'; count: number }
  /** Reduces the target's stamina directly. `'all'` empties the bar outright. */
  | { type: 'drainStamina'; amount: number | 'all' }
  /**
   * Ivy's payoff: lengthens every Poison countdown already on the target.
   *
   * Applied after a fresh stack in Cascade, so the new stack is extended too —
   * the card spreads poison and buys it more time to tick.
   */
  | { type: 'extendPoison'; turns: number }
  /**
   * Saber's payoff: discards the rest of the hand and makes one free attack per
   * card discarded, each at a random living enemy.
   */
  | { type: 'discardHandAndAttack'; power: number; bleedStacks: number };

export interface CardDefinition {
  id: CardDefId;
  name: string;
  description: string;

  /**
   * The character who acts when this card is played, or `null` for a neutral
   * card — a team effect that isn't any one character acting. Neutral cards
   * cost no stamina, but still need at least one character able to act.
   */
  ownerId: CombatantId | null;

  energyCost: number;
  /** Ignored for neutral cards, which never spend stamina. */
  staminaCost: number;

  target: TargetKind;
  effects: CardEffect[];

  /**
   * Energy refunded if playing this card leaves any target's stamina at zero.
   * Drives Overdraw's "if this empties a character's stamina, gain an energy".
   */
  energyOnStaminaEmpty?: number;
}

export interface CardInstance {
  instanceId: CardInstanceId;
  definitionId: CardDefId;
}

// ── Enemy behaviour ─────────────────────────────────────────────────────────

/**
 * Enemies don't hold decks or energy. Each turn they pick one action from a
 * weighted list. Intents are deliberately NOT telegraphed to the player.
 */
export interface EnemyAction {
  id: string;
  name: string;
  weight: number;
  target: TargetKind;
  effects: CardEffect[];
}

// ── Animation events ────────────────────────────────────────────────────────

/**
 * What just happened, in a form the presentation layer can play back.
 *
 * The engine records these on every transition and clears them at the start of
 * the next one, so `state.events` always describes exactly the step that just
 * resolved. Without this the arena could only diff numbers — it would know a
 * combatant lost 40 health but not who hit them, whether it was a poison tick,
 * or whether the hit was doubled by Bleed.
 */
export type CombatEvent =
  | { type: 'attack'; sourceId: CombatantId; targetId: CombatantId; damage: number; bleed: boolean }
  | { type: 'poison'; targetId: CombatantId; damage: number }
  | { type: 'heal'; targetId: CombatantId; amount: number; revived: boolean }
  | { type: 'drain'; targetId: CombatantId; amount: number; emptied: boolean }
  | { type: 'status'; targetId: CombatantId; kind: StatusKind; stacks: number }
  | { type: 'downed'; targetId: CombatantId };

// ── Battle state ────────────────────────────────────────────────────────────

export type CombatPhase =
  /** Waiting for the player to choose a card. */
  | 'selectCard'
  /** A card is chosen and needs a target. */
  | 'selectTarget'
  /** Hand exceeds the limit at end of turn; player must discard down. */
  | 'discarding'
  /** Enemy team is acting. */
  | 'enemyTurn'
  | 'victory'
  | 'defeat';

export interface CombatState {
  combatants: Record<CombatantId, Combatant>;
  /** Display and iteration order, kept separate so records stay unordered. */
  playerOrder: CombatantId[];
  enemyOrder: CombatantId[];

  /** Increments once per full round (player turn + enemy turn). */
  round: number;
  activeTeam: Team;

  energy: number;
  maxEnergy: number;

  cards: Record<CardInstanceId, CardInstance>;
  drawPile: CardInstanceId[];
  hand: CardInstanceId[];
  discardPile: CardInstanceId[];
  handLimit: number;

  phase: CombatPhase;
  /** The card awaiting a target, during `selectTarget`. */
  pendingCard: CardInstanceId | null;

  /** Deterministic RNG state, so a battle replays identically from a seed. */
  seed: number;

  /**
   * Enemies still waiting to act this enemy turn.
   *
   * The enemy turn resolves one combatant at a time rather than all at once, so
   * the UI can animate each attack in turn. An atomic enemy turn would hand
   * React a single jump from "before" to "after" with nothing to show.
   */
  enemyQueue: CombatantId[];

  /** What the most recent transition did. Replaced on every transition. */
  events: CombatEvent[];

  log: string[];
}

/** Everything static the engine needs to resolve a battle. */
export interface CombatContent {
  cardDefs: Record<CardDefId, CardDefinition>;
  enemyActions: Record<CombatantId, EnemyAction[]>;
}
