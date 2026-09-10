import { COMBAT_CONTENT } from '@/game/combat/content';
import { cardDefOf } from '@/game/combat/engine';
import { pendingSelection } from '@/state/combatStore';
import { getCombatActions, useCombatStore } from '@/state/useCombatStore';
import { CardView } from './CardView';

/**
 * The prompt for a card that is waiting on the player to pick a card.
 *
 * Covers both shapes: `keepOne` shows cards revealed off the top of the deck,
 * `discardOne` shows the hand. Either way the interaction is the same — tap
 * one — so they share a component rather than duplicating the strip.
 *
 * Rendered as a modal layer because the choice must be made before anything
 * else can happen; leaving the hand tappable underneath would let the player
 * start a second card mid-resolution.
 */
export function SelectionStrip() {
  const battle = useCombatStore((s) => s.battle);
  const selection = useCombatStore(pendingSelection);

  if (!battle || !selection) return null;

  return (
    <div className="selection">
      <div className="selection__panel">
        <p className="selection__prompt">{selection.prompt}</p>

        <div className="selection__cards">
          {selection.cards.map((instanceId) => {
            const def = cardDefOf(battle, COMBAT_CONTENT, instanceId);
            if (!def) return null;

            const owner = def.ownerId ? (battle.combatants[def.ownerId] ?? null) : null;

            return (
              <CardView
                key={instanceId}
                card={def}
                owner={owner}
                // Every choice is legal here — this is a pick, not a play, so
                // energy and stamina are irrelevant.
                playable
                selected={false}
                markedForDiscard={selection.kind === 'discardOne'}
                onClick={() => getCombatActions().chooseCard(instanceId)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
