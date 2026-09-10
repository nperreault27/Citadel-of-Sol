import { useGameStore } from '@/state/useGameStore';
import { EventBus } from '@/bridge/EventBus';

/**
 * Health and inventory readout.
 *
 * Each value is pulled with its own narrow selector, so picking up an item
 * re-renders the inventory count without touching the health pips.
 */
export function HUD() {
  const health = useGameStore((s) => s.health);
  const maxHealth = useGameStore((s) => s.maxHealth);
  const itemCount = useGameStore((s) => s.inventory.length);

  return (
    <div className="hud">
      <div className="hud__health" aria-label={`Health ${health} of ${maxHealth}`}>
        {Array.from({ length: maxHealth }, (_, i) => (
          <span key={i} className={i < health ? 'pip pip--full' : 'pip'} />
        ))}
      </div>

      <div className="hud__right">
        <span className="hud__items">{itemCount} items</span>
        <button
          type="button"
          className="button button--ghost"
          onClick={() => EventBus.emit('ui:pause')}
          aria-label="Pause"
        >
          ‖
        </button>
      </div>
    </div>
  );
}
