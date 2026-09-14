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
  | 'defenseUp'
  | 'defenseDown';

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

  /**
   * What kind of thing this is, where `id` is which one.
   *
   * Four Ratkin are four combatants with four ids, one move list and one
   * sprite. Anything keyed by *kind* — `enemyActions`, `COMBATANT_FRAMES` —
   * looks up through here, so adding a fifth Ratkin costs nothing but an entry
   * in the squad.
   *
   * Absent on the player's characters, who are each one of a kind; lookups fall
   * back to `id` for them.
   */
  archetype?: string;

  /**
   * Who called this combatant in, if it did not start the fight.
   *
   * Carries three rules at once: a summoner may only have so many of these
   * alive, they are struck from the board when they fall rather than lying
   * there as corpses, and they leave with their summoner when it falls.
   */
  summonedBy?: CombatantId;

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

  /**
   * Fraction of attack damage that gets through while anyone else on this
   * combatant's side is still standing. Absent means no such guard.
   *
   * The Broodmother's: her brood shields her, so clearing it is how you get to
   * her. Attacks only — Poison skips it for the same reason it skips Defense.
   */
  damageTakenWithAllies?: number;

  /** Poison never lands on this combatant, and so never ticks. */
  poisonImmune?: boolean;

  statuses: StatusEntry[];

  /** Health hit 0. Out of the fight until revived; cards keep circulating. */
  downed: boolean;

  /**
   * Stamina hit 0, so this character is benched and takes extra damage.
   *
   * A rest always covers a full turn: exhaust yourself on your own turn and you
   * are still down through the whole of the enemy's, waking as it ends.
   */
  resting: boolean;

  /**
   * Whether this character was already resting when the current turn opened.
   *
   * Engine bookkeeping, refreshed at every turn start, and what makes "rest for
   * a full turn" precise — only a rest that was already running when the turn
   * began ends when that turn does. A rest that starts mid-turn, from a heavy
   * card or a stamina drain landing, waits for the next one.
   */
  restingSinceTurnStart?: boolean;
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
  | {
      type: 'status';
      kind: StatusKind;
      stacks: number;
      duration: StatusDuration;
      /**
       * Odds of landing, rolled per target. Absent means it always lands.
       *
       * Rolled from the battle seed like every other roll, so a coin-flip Bleed
       * replays the same way from the same seed.
       */
      chance?: number;
    }
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
   * Emrys's chain: hits the chosen target, then keeps arcing while the rolls
   * keep coming up. Nothing caps it but the rolls, so the chain can double back
   * to an enemy it already hit.
   */
  | {
      type: 'chainDamage';
      power: number;
      /** Probability the chain jumps again after each hit. */
      continueChance: number;
      /**
       * Probability a jump lands on someone other than the enemy just struck.
       *
       * Separate from `continueChance` because they answer different questions:
       * that one is how long the chain runs, this one is how far it spreads.
       * With nobody else standing the bolt stays put whatever this says, which
       * is what keeps a chain into a lone enemy worth its stamina.
       */
      redirectChance: number;
      /** Safety valve, not a design cap — see the engine. */
      maxHits: number;
    }
  /** Restores stamina. Not damage, so Fatigue does not touch it. `'all'` fills the bar. */
  | { type: 'restoreStamina'; amount: number | 'all' }
  /**
   * The Pyromancer's payoff: pulls every copy of one card out of the draw pile
   * into the discard, and casts it once for each copy plus `extra`.
   *
   * The copies are cast, not played — no stamina, and nothing lands in hand. Hand and discard are left alone: only what is still waiting in the
   * draw pile is spent.
   */
  | { type: 'castCopiesFromDrawPile'; cardId: CardDefId; extra: number }
  /**
   * Thane's shields, sized from the *caster's* max health rather than the
   * target's — his bulk is what he is handing out.
   */
  | {
      type: 'shield';
      fractionOfSourceMaxHealth: number;
      /** Divides the total between the targets instead of giving each the full amount. */
      split?: boolean;
    }
  /**
   * Calls fresh combatants onto the summoner's own side.
   *
   * Targets nothing: the summoner is the only input, so this ignores
   * `targetIds` entirely and reads `sourceId` instead.
   *
   * The cap is per summoner and counts only what it currently has standing, so
   * a brood refills as it is cleared but never outgrows the board. Without one
   * a summoner outpaces any amount of damage, and the arena's even spacing has
   * no answer to twelve combatants in a row.
   */
  | {
      type: 'summon';
      /** Key into `CombatContent.summonable`. */
      archetype: string;
      count: number;
      /** Most that may be alive from this summoner at once. */
      max: number;
    };

/**
 * How many copies of a card a deck may hold: basics 4, everything else 2.
 *
 * For a character with three cards that is eight copies against a seven-card
 * budget, so every character has to cut something. Hollis and Marlo, with extra
 * cards, have to cut more.
 */
export type CardTier = 'basic' | 'special' | 'unique';

export interface CardDefinition {
  id: CardDefId;
  name: string;
  description: string;

  /**
   * The card in a few words, for where the full text will not fit — the deck
   * builder shows a dozen cards at once and has room for a line each.
   *
   * It says what the card is for, not what it does exactly: numbers, stacks and
   * edge cases belong in `description`, which is one hold away wherever this
   * is shown.
   */
  brief: string;

  /** Drives the per-card copy limit when deck building. */
  tier: CardTier;

  /**
   * The character who acts when this card is played, or `null` for a neutral
   * card — a team effect that isn't any one character acting. Neutral cards
   * cost no stamina, but still need at least one character able to act, and
   * are used up when played.
   */
  ownerId: CombatantId | null;

  /**
   * What playing this costs its owner. The only cost a card has: there is no
   * energy, so this is the whole of what stops a card being played. Ignored for
   * neutral cards, which never spend stamina.
   */
  staminaCost: number;

  target: TargetKind;
  effects: CardEffect[];

  /**
   * Stamina given back to the owner if playing this card leaves any target's
   * stamina at zero, capped at what the card actually cost. Drives Overdraw's
   * "free if it empties them".
   */
  staminaRefundOnEmpty?: number;

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
 * The effects an enemy may actually use.
 *
 * Four of the card effects are meaningless from an enemy, because they reach
 * for a deck and a hand that only the player has — and two of them are worse
 * than meaningless. `revealAndKeep` and `discardThenDraw` park the battle in
 * the `selecting` phase mid-enemy-turn, which `stepEnemyTurn`'s own guard then
 * refuses to resume: the fight hard-locks with no way out.
 *
 * Excluding them here makes that a compile error instead of something found
 * three playtests later, and costs nothing at runtime — this is a strict subset
 * of `CardEffect`, so the shared `applyEffects` takes it unchanged.
 */
export type EnemyEffect = Exclude<
  CardEffect,
  {
    type:
      | 'draw'
      | 'revealAndKeep'
      | 'discardThenDraw'
      | 'discardHandAndAttack'
      | 'castCopiesFromDrawPile';
  }
>;

/**
 * Enemies don't hold decks. Each turn they pick one action from a
 * weighted list. Intents are deliberately NOT telegraphed to the player.
 *
 * The move list itself is not an intent, though, and the UI shows it on demand:
 * knowing the Ogre has a sweep is scouting, knowing it is about to sweep is the
 * thing being withheld. That is what `description` is for.
 */
export interface EnemyAction {
  id: string;
  name: string;

  /**
   * What the move does, written from the player's side of the fight.
   *
   * A card's `oneEnemy` means the player's enemy; an enemy action's means one
   * of the player's party, and the same words would say the opposite thing to
   * whoever is reading. So these name the party outright rather than relying on
   * a "them" that flips depending on who owns the card.
   */
  description: string;

  /**
   * Relative odds of being chosen, among the moves that have a legal target.
   * Not a fixed probability: a move with nothing to hit drops out of the roll
   * and the rest divide its share.
   */
  weight: number;

  target: TargetKind;
  effects: EnemyEffect[];
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

  cards: Record<CardInstanceId, CardInstance>;
  drawPile: CardInstanceId[];
  hand: CardInstanceId[];
  discardPile: CardInstanceId[];
  /**
   * Cards used up for the rest of the battle — neutral cards, once played.
   *
   * Kept as a pile rather than dropped, so every card instance is still
   * accounted for somewhere and the UI can say how many are gone.
   */
  exhaustPile: CardInstanceId[];
  handLimit: number;

  phase: CombatPhase;
  /** The card awaiting a target, during `selectTarget`. */
  pendingCard: CardInstanceId | null;

  /** The choice awaiting the player, during `selecting`. */
  selection: PendingSelection | null;

  /** Deterministic RNG state, so a battle replays identically from a seed. */
  seed: number;

  /**
   * Counter behind summoned combatants' ids.
   *
   * On the state rather than in a module so ids derive from the battle and
   * nothing else. A module-level counter would leak across battles and a
   * timestamp would differ every run — either way two plays of the same seed
   * would stop matching, which is the one guarantee the replay and the balance
   * probe both rest on.
   */
  nextSummon: number;

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

  /**
   * Move lists, keyed by archetype — so every Ratkin on the field shares one
   * rather than each needing its own entry.
   */
  enemyActions: Record<string, EnemyAction[]>;

  /**
   * Templates a `summon` effect can call in, keyed by archetype.
   *
   * Here rather than imported by the engine, which stays free of content: a
   * summon names a kind, and this is where the engine is told what that kind is.
   *
   * Optional, because most fights have nothing that summons and should not have
   * to declare an empty bestiary to say so.
   */
  summonable?: Record<string, Combatant>;

  /**
   * How hard each archetype leans toward the party member it likes the look of,
   * from 0 (an even roll) to 1 (the full lean). See `targetWeights`.
   *
   * Optional, and anything left out uses the default lean, so a test with one
   * made-up enemy does not have to declare a personality for it.
   */
  enemyTargeting?: Record<string, { focus: number }>;
}
