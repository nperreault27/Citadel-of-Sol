import type { CardDefinition } from '@/game/combat/types';
import type { InspectedCard } from './CardDetail';
import { CardFace, faceClass, type FaceDetail } from './CardFace';
import { useHoldToInspect } from './useHoldToInspect';

interface Props {
  card: CardDefinition;
  playable: boolean;
  /** Why it can't be played, shown under the card when blocked. */
  blockedReason?: string | undefined;
  selected: boolean;
  markedForDiscard: boolean;
  /** How much of the face to draw — see `CardFace`. */
  detail?: FaceDetail;
  /** Called with this card while it is held down, and with null on release. */
  onInspect?: (card: InspectedCard | null) => void;
  onClick: () => void;
}

/**
 * One card in hand.
 *
 * The face itself comes from CardFace, shared with the deck builder; this adds
 * only the combat-specific state — playable, selected, marked for discard — and
 * the button wrapper.
 *
 * Tap plays it, hold shows it. A compact card has no room to say why it can't
 * be played, so that reason travels with the hold instead.
 *
 * The face is the same object at every size: what changes is how much of it is
 * drawn, which is `detail`'s job, not this one's.
 */
export function CardView({
  card,
  playable,
  blockedReason,
  selected,
  markedForDiscard,
  detail = 'full',
  onInspect,
  onClick,
}: Props) {
  const hold = useHoldToInspect((holding) => {
    if (!onInspect) return;
    onInspect(holding ? { card, blockedReason } : null);
  });

  const classes = [
    'card',
    faceClass(detail),
    playable ? '' : 'card--blocked',
    selected ? 'card--selected' : '',
    markedForDiscard ? 'card--discarding' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      // Drives the owner's colour, which the cascade resolves — see globals.css.
      data-owner={card.ownerId ?? 'team'}
      onClick={() => {
        // The player was reading, not playing.
        if (hold.consumeHold()) return;
        onClick();
      }}
      onPointerDown={hold.onPointerDown}
      onPointerMove={hold.onPointerMove}
      onPointerUp={hold.onPointerUp}
      onPointerLeave={hold.onPointerLeave}
      onPointerCancel={hold.onPointerCancel}
      onContextMenu={hold.onContextMenu}
      title={blockedReason ?? card.description}
    >
      <CardFace card={card} detail={detail} />

      {detail !== 'compact' && !playable && blockedReason && (
        <span className="card__blocked">{blockedReason}</span>
      )}
    </button>
  );
}
