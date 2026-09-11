import { cardPower } from '@/game/combat/engine';
import type { CardDefinition } from '@/game/combat/types';
import { CardFace, faceClass } from './CardFace';
import { StatusIcon } from './StatusIcon';
import { cardKeywords } from './keywords';

/** Everything a held card needs to show, gathered by the card that was held. */
export interface InspectedCard {
  card: CardDefinition;
  /** Why it can't be played, if it can't. */
  blockedReason?: string | undefined;
}

interface Props {
  card: InspectedCard | null;
  onDismiss: () => void;
}

/**
 * The full card, blown up over the screen while a card is held down.
 *
 * This is where the rules text went when hand cards were cut down to a name and
 * a price, and where Power is shown at all — it is a percentage of the user's
 * Attack rather than a damage number, so it means nothing at a glance and
 * everything once you are deciding between two cards.
 *
 * A card that deals in keywords explains them underneath itself. "Apply 1
 * Bleed" assumes the player knows what Bleed is, and the one moment they are
 * asking about a card is the moment to answer that.
 *
 * It outlives the press that opened it, so it takes the next tap to close —
 * anywhere at all, since it covers everything. Dismissing on `pointerdown`
 * rather than `click` is what keeps the opening press from closing it on the
 * way out: that release is a `pointerup` here with no `pointerdown` behind it.
 */
export function CardDetail({ card, onDismiss }: Props) {
  if (!card) return null;

  const power = cardPower(card.card);
  const keywords = cardKeywords(card.card);

  return (
    <div className="card-detail" role="presentation" onPointerDown={onDismiss}>
      <div className="card-detail__stack">
        <div
          className={`card card--detail ${faceClass('full')}`}
          data-owner={card.card.ownerId ?? 'team'}
        >
          <CardFace card={card.card} />

          {power !== null && <span className="card__power">Power {power}</span>}
          {card.blockedReason && <span className="card__blocked">{card.blockedReason}</span>}
        </div>

        {keywords.length > 0 && (
          <ul className="keywords">
            {keywords.map((keyword) => (
              <li key={keyword.kind} className="keywords__entry">
                <span className={`status status--${keyword.kind} keywords__icon`}>
                  <span className="status__icon">
                    <StatusIcon kind={keyword.kind} />
                  </span>
                </span>

                <span className="keywords__name">{keyword.label}</span>
                <p className="keywords__text">{keyword.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
