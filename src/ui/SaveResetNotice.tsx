import { useGameStore } from '@/state/useGameStore';
import { gameStore } from '@/state/store';

/**
 * Shown when a corrupt or unmigratable save was discarded on boot.
 *
 * Telling the player is the point: silently dropping progress looks identical to
 * a bug, and this is the one moment where saying so costs nothing.
 */
export function SaveResetNotice() {
  const wasReset = useGameStore((s) => s.saveWasReset);

  if (!wasReset) return null;

  return (
    <div className="notice" role="status">
      <p>Your previous save couldn&apos;t be read, so a new game was started.</p>
      <button
        type="button"
        className="button button--ghost"
        onClick={() => gameStore.setState({ saveWasReset: false })}
      >
        Dismiss
      </button>
    </div>
  );
}
