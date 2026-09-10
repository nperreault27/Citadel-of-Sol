import { useGameStore } from '@/state/useGameStore';
import { EventBus } from '@/bridge/EventBus';

export function PauseMenu() {
  const phase = useGameStore((s) => s.phase);

  if (phase !== 'paused') return null;

  return (
    <div className="pause">
      <div className="pause__panel">
        <h2 className="pause__title">Paused</h2>

        <button
          type="button"
          className="button"
          onClick={() => EventBus.emit('ui:resume')}
        >
          Resume
        </button>

        <button
          type="button"
          className="button button--secondary"
          onClick={() => EventBus.emit('ui:request-save')}
        >
          Save now
        </button>
      </div>
    </div>
  );
}
