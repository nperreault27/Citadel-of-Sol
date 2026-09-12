import { StatusIcon } from './StatusIcon';
import type { Keyword } from './keywords';

interface Props {
  keywords: Keyword[];
}

/**
 * What a set of keywords mean, as a list.
 *
 * A card says "apply 1 Bleed" and leaves it there, which is fine on the card
 * and useless the moment someone wants to know what Bleed is — which is exactly
 * when this appears, under whatever used the word.
 *
 * Shared between the held card, which explains its own keywords, and the enemy
 * move sheet, which explains its whole move list at once. Weakness has to mean
 * the same thing in both, and the surest way to guarantee that is for both to
 * be the same list.
 */
export function KeywordList({ keywords }: Props) {
  if (keywords.length === 0) return null;

  return (
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
  );
}
