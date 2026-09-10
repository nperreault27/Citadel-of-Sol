import type { CardDefinition, Combatant } from '@/game/combat/types';

interface Props {
  card: CardDefinition;
  owner: Combatant | null;
  playable: boolean;
  /** Why it can't be played, shown under the card when blocked. */
  blockedReason?: string | undefined;
  selected: boolean;
  markedForDiscard: boolean;
  onClick: () => void;
}

/**
 * One card in hand.
 *
 * Shows both costs, because they come out of different pools: energy is the
 * shared team budget for the turn, stamina is the owning character's own and is
 * what forces them to rest. A neutral card shows no owner and no stamina.
 */
export function CardView({
  card,
  owner,
  playable,
  blockedReason,
  selected,
  markedForDiscard,
  onClick,
}: Props) {
  const classes = ['card', playable ? '' : 'card--blocked', selected ? 'card--selected' : '', markedForDiscard ? 'card--discarding' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button type="button" className={classes} onClick={onClick} title={blockedReason ?? card.description}>
      <span className="card__head">
        <span className="card__owner">{owner ? owner.name : 'Team'}</span>
        <span className="card__energy" aria-label={`${card.energyCost} energy`}>
          {card.energyCost}
        </span>
      </span>

      <span className="card__name">{card.name}</span>
      <span className="card__text">{card.description}</span>

      <span className="card__foot">
        {card.staminaCost > 0 ? <span className="card__stamina">{card.staminaCost} stam</span> : <span className="card__stamina card__stamina--none">no stamina</span>}
      </span>

      {!playable && blockedReason && <span className="card__blocked">{blockedReason}</span>}
    </button>
  );
}
