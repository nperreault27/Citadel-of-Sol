import type { CardDefinition } from '@/game/combat/types';

/**
 * How much of the card to draw.
 *
 * - `compact` — hand-sized: the name and the two costs as badges, nothing else.
 *   The rules text is what makes a card wide, and a hand of them will not fit
 *   across a phone.
 * - `brief` — the deck builder: a line saying what the card is for.
 * - `full` — the rules text, exactly.
 *
 * Everything trimmed is one hold away, wherever the card is shown.
 */
export type FaceDetail = 'compact' | 'brief' | 'full';

/**
 * The class that sizes a card for how much of the face it draws.
 *
 * Height belongs to the detail level, not to the screen the card happens to be
 * on: a card showing a name and a brief is the same card whether it is in the
 * deck builder or a discard prompt, and it should be the same size in both.
 */
export function faceClass(detail: FaceDetail): string {
  return `card--${detail}`;
}

interface Props {
  card: CardDefinition;
  detail?: FaceDetail;
}

/**
 * The visual face of a card: name, what it does, and what it costs.
 *
 * Both costs sit in the bottom-right corner, because they are read together:
 * what a card asks for is energy *and* stamina, and a player deciding what to
 * play is comparing the pair against what they have. Always the same corner, so
 * a row of cards can be priced by scanning one edge.
 *
 * A compact card prices itself in badges — a gold pip for energy, a blue one
 * for stamina — because at hand width there is no room to name either. Anywhere
 * the card is bigger the stamina cost is spelled out.
 *
 * Whose card it is isn't written anywhere: the card wears its owner's colour
 * instead, set by `data-owner` on the wrapper.
 *
 * Renders no interactive element of its own. The hand wraps it in a button, the
 * deck builder pairs it with a stepper, and neither has to reimplement the
 * layout.
 */
export function CardFace({ card, detail = 'full' }: Props) {
  const compact = detail === 'compact';

  return (
    <>
      <span className="card__name">{card.name}</span>

      {detail === 'brief' && <span className="card__text">{card.brief}</span>}
      {detail === 'full' && <span className="card__text">{card.description}</span>}

      <span className="card__foot">
        {card.staminaCost > 0 ? (
          <span className="card__stamina" aria-label={`${card.staminaCost} stamina`}>
            {compact ? card.staminaCost : `${card.staminaCost} stamina`}
          </span>
        ) : (
          !compact && <span className="card__stamina card__stamina--none">no stamina</span>
        )}

        {/* Last, so the pip lands in the corner itself. */}
        <span className="card__energy" aria-label={`${card.energyCost} energy`}>
          {card.energyCost}
        </span>
      </span>
    </>
  );
}
