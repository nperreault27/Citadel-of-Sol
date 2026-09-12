import { useState } from 'react';
import { useGameStore } from '@/state/useGameStore';
import { useCombatStore } from '@/state/useCombatStore';
import { HUD } from './HUD';
import { ActionButton } from './ActionButton';
import { DialogModal } from './DialogModal';
import { LoadingScreen } from './LoadingScreen';
import { PauseMenu } from './PauseMenu';
import { SaveResetNotice } from './SaveResetNotice';
import { CombatScreen } from './combat/CombatScreen';
import { EncounterScreen } from './combat/EncounterScreen';
import { RosterScreen } from './combat/RosterScreen';
import { DeckScreen } from './combat/DeckScreen';

/**
 * Everything drawn on top of the canvas.
 *
 * The overlay root sets `pointer-events: none` in CSS and each interactive
 * widget sets it back to `auto`. That is what makes click-to-move work: a tap
 * on empty space falls straight through to the Phaser canvas and becomes a move
 * order, while taps on buttons and panels are consumed by the UI.
 *
 * An active battle replaces the overworld interface entirely — the two share no
 * screen space, so there's nothing to reconcile between them.
 */
export function UIOverlay() {
  const phase = useGameStore((s) => s.phase);
  const inBattle = useCombatStore((s) => s.battle !== null);

  // Local, not in a store: nothing outside this component cares which pre-battle
  // sheet happens to be open. What was *chosen* on them does live in the store —
  // the battle outlives these screens.
  //
  // The order is fight, then party, then deck: who to bring and what to bring
  // are both answers to the question the fight asks, so the fight is picked
  // first and Back walks the same path in reverse.
  const [prep, setPrep] = useState<'none' | 'encounter' | 'roster' | 'deck'>('none');

  const isPlaying = phase === 'playing';

  return (
    <div className="overlay">
      <LoadingScreen />
      <SaveResetNotice />

      {inBattle ? (
        <CombatScreen />
      ) : (
        isPlaying && (
          <>
            <HUD onOpenRoster={() => setPrep('encounter')} />
            <ActionButton />

            {prep === 'encounter' && (
              <EncounterScreen
                onPick={() => setPrep('roster')}
                onClose={() => setPrep('none')}
              />
            )}
            {prep === 'roster' && (
              <RosterScreen
                onClose={() => setPrep('encounter')}
                onBuildDeck={() => setPrep('deck')}
              />
            )}
            {prep === 'deck' && <DeckScreen onBack={() => setPrep('roster')} />}
          </>
        )
      )}

      <DialogModal />
      <PauseMenu />
    </div>
  );
}
