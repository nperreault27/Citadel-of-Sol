import type { StatusEntry } from '@/game/combat/types';
import { StatusIcon } from './StatusIcon';
import { statusSummary } from './keywords';

interface Props {
  entry: StatusEntry;
  /** Called when the badge is tapped, to toggle its label. */
  onToggle?: (() => void) | undefined;
}

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
 *
 * Tapping one asks for its label, which the panel shows — the panel, not the
 * badge, because a label hung off a 20px badge at the edge of the row goes off
 * the side of the screen, and the panel is a box already known to be on it.
 *
 * It stays `role="img"` rather than becoming a button: this sits inside the
 * combatant's own button, and a button inside a button is invalid and swallows
 * the inner click.
 */
export function StatusBadge({ entry, onToggle }: Props) {
  // Taunt counts down in stacks, so its stack count *is* the turn counter and
  // belongs in the turns corner. Showing the same number twice would be noise.
  const stacksAreTurns = entry.duration.kind === 'perTurnStack';

  const turns =
    entry.duration.kind === 'turns'
      ? entry.duration.remaining
      : stacksAreTurns
        ? entry.stacks
        : null;

  const label = statusSummary(entry);

  return (
    <span
      className={`status status--${entry.kind}`}
      title={label}
      aria-label={label}
      role="img"
      onClick={
        onToggle
          ? (event) => {
              // Aiming a card at this combatant is the other thing a tap here
              // could mean, and it is not this one.
              event.stopPropagation();
              onToggle();
            }
          : undefined
      }
    >
      <span className="status__icon">
        <StatusIcon kind={entry.kind} />
      </span>

      {turns !== null && <span className="status__turns">{turns}</span>}
      {!stacksAreTurns && <span className="status__stacks">{entry.stacks}</span>}
    </span>
  );
}
