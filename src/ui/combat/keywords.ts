import {
  BLEED_MULTIPLIER,
  COUNTER_ATTACK_POWER,
  FATIGUE_MULTIPLIER,
  POISON_TICK_FRACTION,
  STRENGTH_MULTIPLIER,
  UNDYING_HEAL_FRACTION,
  WEAKNESS_MULTIPLIER,
} from '@/game/combat/stats';
import type { CardDefinition, StatusEntry, StatusKind } from '@/game/combat/types';

/** A tuning fraction as a percentage, for text that quotes one. */
const pct = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/**
 * A stacking multiplier as the percentage it moves a stat by.
 *
 * Players think in "30% more Attack", not in "x1.3" — and the multipliers are
 * stored the way the maths wants them, not the way a card explains them. The
 * rounding absorbs the float error in 1.3 - 1.
 */
const shift = (multiplier: number): string => pct(Math.abs(multiplier - 1));

export interface Keyword {
  kind: StatusKind;
  label: string;
  /**
   * What it does, in a sentence — the effect and its number, nothing else.
   *
   * The numbers are interpolated from the tuning constants in `stats.ts` rather
   * than written out, because balance moves and prose does not follow it. Retune
   * Bleed and this text retunes with it; hardcode a 2 here and the game quietly
   * starts lying to the player the day that constant changes.
   *
   * Edge cases are deliberately left out. A player reading this is mid-decision,
   * not studying: whether a blocked hit still spends the stack matters far less,
   * in that moment, than being able to read the line at all.
   */
  text: string;
}

/**
 * The keyword glossary, and the only place a status is named.
 *
 * A card says "apply 1 Bleed" and assumes the player knows what Bleed is. This
 * is where they find out, and it is also where the status badges get their
 * names, so a keyword cannot be called one thing on a card and another on the
 * fighter wearing it.
 */
export const KEYWORDS: Record<StatusKind, Keyword> = {
  poison: {
    kind: 'poison',
    label: 'Poison',
    text: `At the end of every turn, deals ${pct(POISON_TICK_FRACTION)} of this character's health per stack.`,
  },
  bleed: {
    kind: 'bleed',
    label: 'Bleed',
    text: `The next attack this character takes deals ${BLEED_MULTIPLIER}x damage and spends 1 stack.`,
  },
  strength: {
    kind: 'strength',
    label: 'Strength',
    text: `Increases this character's Attack by ${shift(STRENGTH_MULTIPLIER)} per stack.`,
  },
  weakness: {
    kind: 'weakness',
    label: 'Weakness',
    text: `Reduces this character's Attack by ${shift(WEAKNESS_MULTIPLIER)} per stack.`,
  },
  fatigue: {
    kind: 'fatigue',
    label: 'Fatigue',
    text: `Increases every stamina loss by ${shift(FATIGUE_MULTIPLIER)} per stack.`,
  },
  taunt: {
    kind: 'taunt',
    label: 'Taunt',
    text: 'Single-target attacks must hit this character. Spends 1 stack each turn.',
  },
  counter: {
    kind: 'counter',
    label: 'Counter Attack',
    text: `When attacked, spends 1 stack to strike back at Power ${COUNTER_ATTACK_POWER}.`,
  },
  immunity: {
    kind: 'immunity',
    label: 'Immunity',
    text: "Blocks all damage until this character's next turn.",
  },
  undying: {
    kind: 'undying',
    label: 'Undying',
    text: `When an enemy falls, spends 1 stack to heal ${pct(UNDYING_HEAL_FRACTION)} of this character's health, or revive them.`,
  },
  defenseUp: {
    kind: 'defenseUp',
    label: 'Defense Up',
    text: `Increases this character's Defense by ${shift(STRENGTH_MULTIPLIER)} per stack.`,
  },
};

/**
 * One status a fighter is carrying, as a sentence: name, stacks, countdown.
 *
 * Taunt counts down in stacks, so its stack count *is* its turn counter and
 * saying both would be saying the same number twice.
 */
export function statusSummary(entry: StatusEntry): string {
  const stacksAreTurns = entry.duration.kind === 'perTurnStack';

  const turns =
    entry.duration.kind === 'turns'
      ? entry.duration.remaining
      : stacksAreTurns
        ? entry.stacks
        : null;

  const name = KEYWORDS[entry.kind].label;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  if (turns !== null && stacksAreTurns) return `${name}, ${plural(turns, 'turn')} remaining`;

  const stacks = `${name}, ${plural(entry.stacks, 'stack')}`;
  return turns === null ? stacks : `${stacks}, ${plural(turns, 'turn')} remaining`;
}

/** The statuses a card's effects actually apply. */
function appliedBy(card: CardDefinition): StatusKind[] {
  const kinds: StatusKind[] = [];

  for (const effect of card.effects) {
    if (effect.type === 'status' || effect.type === 'focusedStatus') kinds.push(effect.kind);
    // Saber's payoff bleeds everything it hits without saying "status" anywhere.
    else if (effect.type === 'discardHandAndAttack') kinds.push('bleed');
    else if (effect.type === 'extendPoison') kinds.push('poison');
  }

  return kinds;
}

/**
 * The keywords a card needs to explain.
 *
 * Both what it applies and what it names, because neither alone is enough:
 * Ironclad grants Immunity without ever printing the word, and Cascade talks
 * about Poison it may not be the one to have applied. Order follows the
 * glossary, so a card explains its keywords the same way every time.
 */
export function cardKeywords(card: CardDefinition): Keyword[] {
  const applied = new Set(appliedBy(card));
  const description = card.description.toLowerCase();

  return Object.values(KEYWORDS).filter(
    (keyword) => applied.has(keyword.kind) || description.includes(keyword.label.toLowerCase())
  );
}
