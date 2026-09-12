import { cardPower, enemyStaminaCost } from '@/game/combat/engine';
import type { EnemyAction } from '@/game/combat/types';
import { faceClass } from './CardFace';

interface Props {
  action: EnemyAction;
  /** This move's weight as a share of the enemy's whole list, 0–1. */
  share: number;
}

/**
 * One enemy move, drawn as a card.
 *
 * An enemy's move is the same kind of object as a player's card — a name, what
 * it does, and what it costs — so it is worth the same frame, and the player
 * reads both the same way. The economics differ, which is the whole reason this
 * doesn't just render a `CardFace`: an enemy spends no energy and holds no
 * deck, so the corner that prices a player card has nothing to say here.
 *
 * What goes there instead is how often the move comes up. That is the thing a
 * player actually wants off this screen — an Ogre that sweeps one turn in four
 * is a different fight from one that sweeps every other turn — and it is
 * scouting rather than a telegraphed intent, which the engine still withholds.
 *
 * Not a button. There is nothing to do to an enemy's card: the sheet shows the
 * full rules text already, and its keywords are explained underneath it.
 */
export function MoveCard({ action, share }: Props) {
  const power = cardPower(action);
  const stamina = enemyStaminaCost(action);

  return (
    <div className={`card card--move ${faceClass('full')}`} data-owner="enemy">
      <span className="card__name">{action.name}</span>

      {power !== null && <span className="card__power">Power {power}</span>}

      <span className="card__text">{action.description}</span>

      <span className="card__foot">
        {stamina > 0 && (
          <span className="card__stamina" aria-label={`${stamina} stamina`}>
            {stamina} stamina
          </span>
        )}

        <span className="card__share" aria-label={`Used ${Math.round(share * 100)}% of the time`}>
          {Math.round(share * 100)}%
        </span>
      </span>
    </div>
  );
}
