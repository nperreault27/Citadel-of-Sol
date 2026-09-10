import type { Combatant } from '@/game/combat/types';
import { HealthBar } from './HealthBar';
import { FloatingNumbers } from './FloatingNumbers';
import { StatusBadge } from './StatusBadge';

interface Props {
  combatant: Combatant;
  /** True while this combatant is a legal target for the pending card. */
  targetable: boolean;
  onSelect: (id: string) => void;
  compact?: boolean;
}

/**
 * One combatant's readout: health, stamina, statuses — and the click target for
 * aiming a card.
 *
 * Health and stamina are the two bars the design calls for, kept visually
 * distinct: health is a solid bar, stamina a thinner one beneath it. Attack,
 * Defense and Speed exist on the combatant but aren't shown here; they don't
 * change moment to moment, so spending scarce phone screen on them would crowd
 * out the numbers that do.
 */
export function CombatantPanel({ combatant, targetable, onSelect, compact = false }: Props) {
  const staminaPct = Math.max(0, (combatant.stamina / combatant.maxStamina) * 100);

  const classes = [
    'unit',
    compact ? 'unit--compact' : '',
    combatant.downed ? 'unit--downed' : '',
    combatant.resting ? 'unit--resting' : '',
    targetable ? 'unit--targetable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      disabled={!targetable}
      onClick={() => onSelect(combatant.id)}
      aria-label={`${combatant.name}, ${combatant.health} of ${combatant.maxHealth} health`}
    >
      <FloatingNumbers combatantId={combatant.id} />

      <span className="unit__row">
        <span className="unit__name">{combatant.name}</span>
        <span className="unit__hp">
          {combatant.health}/{combatant.maxHealth}
        </span>
      </span>

      <HealthBar current={combatant.health} max={combatant.maxHealth} />

      <span className="bar bar--stamina">
        <span className="bar__fill" style={{ width: `${staminaPct}%` }} />
      </span>

      <span className="unit__tags">
        {combatant.downed && <span className="tag tag--downed">Down</span>}
        {combatant.resting && !combatant.downed && <span className="tag tag--resting">Resting</span>}

        {/* One badge per entry, not per kind — see StatusBadge for why. */}
        {combatant.statuses.map((entry, index) => (
          <StatusBadge key={`${entry.kind}-${index}`} entry={entry} />
        ))}
      </span>
    </button>
  );
}
