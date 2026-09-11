import { useState } from 'react';
import { COMBAT_CONTENT } from '@/game/combat/content';
import { cardDefOf } from '@/game/combat/engine';
import { pendingSelection } from '@/state/combatStore';
import { getCombatActions, useCombatStore } from '@/state/useCombatStore';
import { CardDetail, type InspectedCard } from './CardDetail';
import { CardView } from './CardView';
import { cardRowProps } from './cardRows';

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
  const [inspected, setInspected] = useState<InspectedCard | null>(null);

  if (!battle || !selection) return null;

  return (
    <div className="selection">
      <div className="selection__panel">
        <p className="selection__prompt">{selection.prompt}</p>

        <div {...cardRowProps('selection__cards', selection.cards.length)}>
          {selection.cards.map((instanceId) => {
            const def = cardDefOf(battle, COMBAT_CONTENT, instanceId);
            if (!def) return null;

            return (
              <CardView
                key={instanceId}
                card={def}
                // Every choice is legal here — this is a pick, not a play, so
                // energy and stamina are irrelevant.
                playable
                selected={false}
                // Nothing here is marked yet. Red means "this card is going",
                // which is true of the one the player picks and of none of the
                // ones they are picking between — the prompt above says which
                // way the choice runs.
                markedForDiscard={false}
                // A line each, not the full rules: `discardOne` lays out the
                // whole hand, and a wall of rules text is not how a player picks
                // which card to bin. The hold is here too if they want it.
                detail="brief"
                onInspect={setInspected}
                onClick={() => getCombatActions().chooseCard(instanceId)}
              />
            );
          })}
        </div>
      </div>

      <CardDetail card={inspected} onDismiss={() => setInspected(null)} />
    </div>
  );
}
