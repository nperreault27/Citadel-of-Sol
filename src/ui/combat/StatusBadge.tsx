import type { StatusEntry } from '@/game/combat/types';
import { StatusIcon } from './StatusIcon';

const LABELS: Record<StatusEntry['kind'], string> = {
  poison: 'Poison',
  bleed: 'Bleed',
  strength: 'Strength',
  weakness: 'Weakness',
  fatigue: 'Fatigue',
  taunt: 'Taunt',
  counter: 'Counter Attack',
  immunity: 'Immunity',
  undying: 'Undying',
  defenseUp: 'Defense Up',
};

/**
 * One status entry: an icon, its stack count, and its countdown.
 *
 * Rendered per *entry* rather than per kind. Poison stacks each carry their own
 * timer, so a target hit on consecutive turns genuinely holds two separate
 * poisons expiring a turn apart — collapsing them into one badge would force us
 * to invent a single number that describes neither.
 *
 * The countdown only appears for statuses that actually fall off per turn.
 * Strength, Weakness and Bleed have no clock, so showing one would be a lie.
 */
export function StatusBadge({ entry }: { entry: StatusEntry }) {
  // Taunt counts down in stacks, so its stack count *is* the turn counter and
  // belongs in the turns corner. Showing the same number twice would be noise.
  const stacksAreTurns = entry.duration.kind === 'perTurnStack';

  const turns =
    entry.duration.kind === 'turns'
      ? entry.duration.remaining
      : stacksAreTurns
        ? entry.stacks
        : null;

  const label =
    turns !== null && stacksAreTurns
      ? `${LABELS[entry.kind]}, ${turns} ${turns === 1 ? 'turn' : 'turns'} remaining`
      : `${LABELS[entry.kind]}, ${entry.stacks} ${entry.stacks === 1 ? 'stack' : 'stacks'}` +
        (turns === null ? '' : `, ${turns} ${turns === 1 ? 'turn' : 'turns'} remaining`);

  return (
    <span className={`status status--${entry.kind}`} title={label} aria-label={label} role="img">
      <span className="status__icon">
        <StatusIcon kind={entry.kind} />
      </span>

      {turns !== null && <span className="status__turns">{turns}</span>}
      {!stacksAreTurns && <span className="status__stacks">{entry.stacks}</span>}
    </span>
  );
}
