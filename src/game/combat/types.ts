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

export type StatusKind =
  | 'strength'
  | 'weakness'
  | 'poison'
  | 'bleed'
  | 'fatigue'
  | 'taunt'
  | 'counter'
  | 'immunity'
  | 'undying'
  | 'defenseUp';

/**
 * How a status leaves play.
 *
 * - Strength / Weakness: `permanent`, lasting until the battle ends.
 * - Poison: `turns`, normally 2. Each application is its own countdown, so a
 *   target hit twice carries two independent stacks that expire separately.
 * - Bleed: `permanent`, but consumed a stack at a time by attacks rather than
 *   by any timer.
 * - Fatigue: `untilRest`, so it persists indefinitely on a character who never
 *   bottoms out — which is what makes it worth stacking.
 * - Taunt: `perTurnStack` — the stack count *is* the countdown, losing one at
 *   the end of each of the bearer's team turns.
 * - Counter: `permanent`, spent a stack at a time by incoming attacks.
 * - Immunity: `untilNextTurn`, cleared as the bearer's next team turn begins,
 *   so it covers exactly one enemy turn.
 * - Undying: `permanent`, spent a stack at a time when an enemy falls.
 */
export type StatusDuration =
  | { kind: 'permanent' }
  | { kind: 'turns'; remaining: number }
  | { kind: 'untilAttacked' }
  | { kind: 'untilRest' }
  | { kind: 'perTurnStack' }
  | { kind: 'untilNextTurn' };

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

  /**
   * Damage absorbed before health is touched.
   *
   * A resource rather than a status: it has a magnitude, is spent rather than
   * expiring, and needs its own place on the health bar. Poison ignores it
   * entirely, which is what makes damage-over-time the counter to shielding.
   */
  shield: number;

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
      /** Fraction of the damage dealt returned to the attacker as healing. */
      lifesteal?: number;
    }
  | { type: 'heal'; amount: number }
  /**
   * Heals a fraction of the target's own max health, so the card stays
   * meaningful on a 400-health tank and doesn't overheal a fragile one.
   */
  | { type: 'healPercent'; fraction: number }
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
  | { type: 'discardHandAndAttack'; power: number; bleedStacks: number }
  /**
   * Lyra's payoff: spreads a status across the enemy team, but concentrates it
   * when only one target is left — the same card reads as crowd control against
   * a group and as a finisher one-on-one.
   */
  | {
      type: 'focusedStatus';
      kind: StatusKind;
      stacks: number;
      /** Applied instead of `stacks` when there is exactly one target. */
      soloStacks: number;
      duration: StatusDuration;
    }
  /** Reveals the top `look` cards and asks the player to keep one. */
  | { type: 'revealAndKeep'; look: number }
  /** Asks the player to discard one card, then draws. */
  | { type: 'discardThenDraw'; draw: number }
  /**
   * Emrys's chain: hits the chosen target, then keeps arcing to a *different*
   * enemy while the rolls keep coming up. Nothing caps it but the roll, so the
   * chain can double back to an enemy it already hit.
   */
  | {
      type: 'chainDamage';
      power: number;
      /** Probability the chain jumps again after each hit. */
      continueChance: number;
      /** Safety valve, not a design cap — see the engine. */
      maxHits: number;
    }
  /** Restores stamina. Not damage, so Fatigue does not touch it. */
  | { type: 'restoreStamina'; amount: number }
  /**
   * Thane's shields, sized from the *caster's* max health rather than the
   * target's — his bulk is what he is handing out.
   */
  | {
      type: 'shield';
      fractionOfSourceMaxHealth: number;
      /** Divides the total between the targets instead of giving each the full amount. */
      split?: boolean;
    };

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

  /**
   * Fraction of the owner's max health spent to play this card.
   *
   * A cost rather than damage: it never drains stamina, spends Bleed, or
   * provokes a counter, and it can never be lethal — it stops at 1 health.
   */
  healthCostFraction?: number;
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
  | { type: 'shield'; targetId: CombatantId; amount: number }
  | { type: 'downed'; targetId: CombatantId };

/**
 * A choice a card is waiting on, mid-resolution.
 *
 * Cards that reveal or rummage need the player in the loop, which a pure
 * transition cannot do on its own. The engine parks in the `selecting` phase
 * with this describing the choice, and `resolveSelection` finishes the card.
 */
export interface PendingSelection {
  kind: 'keepOne' | 'discardOne';

  /**
   * The cards being chosen between.
   *
   * For `keepOne` these are held outside every pile — already off the draw pile
   * but not yet in hand or discard, so no card is ever lost if the battle ends
   * mid-choice.
   */
  cards: CardInstanceId[];

  /** Cards drawn once the choice is made. */
  drawAfter: number;

  prompt: string;
}

// ── Battle state ────────────────────────────────────────────────────────────

export type CombatPhase =
  /** Waiting for the player to choose a card. */
  | 'selectCard'
  /** A card is chosen and needs a target. */
  | 'selectTarget'
  /** Hand exceeds the limit at end of turn; player must discard down. */
  | 'discarding'
  /** A card is mid-resolution and needs the player to pick one card. */
  | 'selecting'
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

  /** The choice awaiting the player, during `selecting`. */
  selection: PendingSelection | null;

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
