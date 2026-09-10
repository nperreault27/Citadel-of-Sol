import { useGameStore } from '@/state/useGameStore';
import { HUD } from './HUD';
import { Joystick } from './Joystick';
import { ActionButton } from './ActionButton';
import { DialogModal } from './DialogModal';
import { LoadingScreen } from './LoadingScreen';
import { PauseMenu } from './PauseMenu';
import { SaveResetNotice } from './SaveResetNotice';

/**
 * Everything drawn on top of the canvas.
 *
 * The overlay root sets `pointer-events: none` in CSS and each interactive
 * widget sets it back to `auto`. That way a tap on empty space falls straight
 * through to the Phaser canvas underneath without anyone hand-managing hit
 * regions, while buttons and the joystick still receive their own events.
 */
export function UIOverlay() {
  const phase = useGameStore((s) => s.phase);
  const isPlaying = phase === 'playing';

  return (
    <div className="overlay">
      <LoadingScreen />
      <SaveResetNotice />

      {isPlaying && (
        <>
          <HUD />
          <Joystick />
          <ActionButton />
        </>
      )}

      <DialogModal />
      <PauseMenu />
    </div>
  );
}
