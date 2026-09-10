import type { StatusEntry } from '@/game/combat/types';
import { StatusIcon } from './StatusIcon';

const LABELS: Record<StatusEntry['kind'], string> = {
  poison: 'Poison',
  bleed: 'Bleed',
  strength: 'Strength',
  weakness: 'Weakness',
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
  const turns = entry.duration.kind === 'turns' ? entry.duration.remaining : null;

  const label =
    `${LABELS[entry.kind]}, ${entry.stacks} ${entry.stacks === 1 ? 'stack' : 'stacks'}` +
    (turns === null ? '' : `, ${turns} ${turns === 1 ? 'turn' : 'turns'} remaining`);

  return (
    <span className={`status status--${entry.kind}`} title={label} aria-label={label} role="img">
      <span className="status__icon">
        <StatusIcon kind={entry.kind} />
      </span>

      {turns !== null && <span className="status__turns">{turns}</span>}
      <span className="status__stacks">{entry.stacks}</span>
    </span>
  );
}
