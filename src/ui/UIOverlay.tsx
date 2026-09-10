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
import { RosterScreen } from './combat/RosterScreen';

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

  // Local, not in a store: nothing outside this component cares whether the
  // party sheet happens to be open.
  const [rosterOpen, setRosterOpen] = useState(false);

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
            <HUD onOpenRoster={() => setRosterOpen(true)} />
            <ActionButton />
            {rosterOpen && <RosterScreen onClose={() => setRosterOpen(false)} />}
          </>
        )
      )}

      <DialogModal />
      <PauseMenu />
    </div>
  );
}
