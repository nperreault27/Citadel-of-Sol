import type { Combatant } from '@/game/combat/types';
import { statusSummary } from './keywords';
import { HealthBar } from './HealthBar';
import { FloatingNumbers } from './FloatingNumbers';
import { StatusBadge } from './StatusBadge';

interface Props {
  combatant: Combatant;
  /** True while this combatant is a legal target for the pending card. */
  targetable: boolean;
  onSelect: (id: string) => void;
  /** Index of the status whose label is showing, or null for none. */
  openStatus?: number | null;
  onToggleStatus?: ((index: number) => void) | undefined;
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
export function CombatantPanel({
  combatant,
  targetable,
  onSelect,
  openStatus = null,
  onToggleStatus,
  compact = false,
}: Props) {
  const staminaPct = Math.max(0, (combatant.stamina / combatant.maxStamina) * 100);
  const openEntry = openStatus === null ? null : (combatant.statuses[openStatus] ?? null);

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
      // Only the party is colour-coded; enemies are left neutral.
      {...(combatant.team === 'player' ? { 'data-owner': combatant.id } : {})}
      // `aria-disabled`, not `disabled`: the status badges inside this button
      // are tappable in their own right, and a disabled button is dead to
      // pointer events — its children never see one either.
      aria-disabled={!targetable}
      onClick={() => {
        if (!targetable) return;
        onSelect(combatant.id);
      }}
      aria-label={
        `${combatant.name}, ${combatant.health} of ${combatant.maxHealth} health` +
        (combatant.shield > 0 ? `, ${combatant.shield} shield` : '')
      }
    >
      <FloatingNumbers combatantId={combatant.id} />

      {/*
        The tapped badge's label, laid across the panel rather than hung off the
        badge. A 20px badge at the end of the row has no room beside it — a
        label centred on one runs off the side of the screen, and the panel is a
        box already known to be on it. Transparent to input, so the tap that
        closes it reaches the badge underneath.
      */}
      {openEntry && <span className="unit__tip">{statusSummary(openEntry)}</span>}

      <span className="unit__row">
        <span className="unit__name">{combatant.name}</span>
        <span className="unit__hp">
          {combatant.health}/{combatant.maxHealth}
          {combatant.shield > 0 && <span className="unit__shield">+{combatant.shield}</span>}
        </span>
      </span>

      <HealthBar
        current={combatant.health}
        max={combatant.maxHealth}
        shield={combatant.shield}
      />

      <span className="bar bar--stamina">
        <span className="bar__fill" style={{ width: `${staminaPct}%` }} />
      </span>

      <span className="unit__tags">
        {combatant.downed && <span className="tag tag--downed">Down</span>}
        {combatant.resting && !combatant.downed && <span className="tag tag--resting">Resting</span>}

        {/* One badge per entry, not per kind — see StatusBadge for why. */}
        {combatant.statuses.map((entry, index) => (
          <StatusBadge
            key={`${entry.kind}-${index}`}
            entry={entry}
            onToggle={onToggleStatus ? () => onToggleStatus(index) : undefined}
          />
        ))}
      </span>
    </button>
  );
}
