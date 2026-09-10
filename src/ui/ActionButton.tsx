import { EventBus } from '@/bridge/EventBus';

/**
 * The single context action — talk, examine, advance dialog.
 *
 * Fires on pointerdown rather than click: a click waits for pointerup, which
 * adds perceptible latency on touch and feels mushy in a game.
 */
export function ActionButton() {
  return (
    <button
      type="button"
      className="action-button"
      onPointerDown={(event) => {
        event.preventDefault();
        EventBus.emit('ui:action-pressed');
      }}
      aria-label="Action"
    >
      A
    </button>
  );
}
