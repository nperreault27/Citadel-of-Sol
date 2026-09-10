import { useGameStore, getGameActions } from '@/state/useGameStore';

/**
 * Dialog box. Tapping anywhere on it advances a line; the last line closes it.
 *
 * Rendering this in React rather than Phaser is the whole reason for the split
 * architecture — text wrapping, fonts and safe-area-aware layout are things the
 * browser already does well and a canvas does not.
 */
export function DialogModal() {
  const dialog = useGameStore((s) => s.dialog);

  if (!dialog) return null;

  const line = dialog.lines[dialog.lineIndex] ?? '';
  const isLast = dialog.lineIndex >= dialog.lines.length - 1;

  return (
    <div
      className="dialog"
      role="dialog"
      aria-live="polite"
      onPointerDown={(event) => {
        event.preventDefault();
        getGameActions().advanceDialog();
      }}
    >
      {dialog.speaker && <p className="dialog__speaker">{dialog.speaker}</p>}
      <p className="dialog__line">{line}</p>
      <p className="dialog__hint">{isLast ? 'Tap to close' : 'Tap to continue'}</p>
    </div>
  );
}
