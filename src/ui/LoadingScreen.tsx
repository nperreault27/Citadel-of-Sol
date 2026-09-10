import { useGameStore } from '@/state/useGameStore';

/** Covers the canvas until the world is ready. */
export function LoadingScreen() {
  const phase = useGameStore((s) => s.phase);
  const progress = useGameStore((s) => s.loadProgress);

  if (phase !== 'booting' && phase !== 'loading') return null;

  return (
    <div className="loading">
      <p className="loading__title">Loading</p>
      <div className="loading__track">
        <div className="loading__bar" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </div>
  );
}
