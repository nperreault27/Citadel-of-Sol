import { useEffect, useRef, useState } from 'react';

interface Props {
  current: number;
  max: number;
  /** Damage absorbed before health is touched. */
  shield?: number;
}

/** How long the drained sliver lingers before it catches up. */
const GHOST_HOLD_MS = 260;

/**
 * Health bar with a trailing "ghost" fill that shows how much was just lost.
 *
 * The front fill snaps to the new value immediately; a pale layer behind it
 * stays at the old value for a beat, then drains down to meet it. The gap
 * between the two *is* the damage — you see the size of the hit, not just the
 * result of it.
 *
 * Both layers are absolutely positioned in the same box rather than stacked, so
 * the ghost is only ever visible where the front fill has already retreated.
 */
export function HealthBar({ current, max, shield = 0 }: Props) {
  const safeMax = Math.max(1, max);
  const pct = Math.max(0, Math.min(100, (current / safeMax) * 100));

  // The shield rides on top of the health fill and is measured against the same
  // max, so a shield worth half your health looks like half a bar. It is capped
  // at the remaining space rather than overflowing the track, because a shield
  // sized from someone *else's* health can easily exceed your own.
  const shieldPct = Math.max(0, Math.min(100 - pct, (shield / safeMax) * 100));

  const [ghostPct, setGhostPct] = useState(pct);
  const previous = useRef(current);

  useEffect(() => {
    const dropped = current < previous.current;
    previous.current = current;

    if (!dropped) {
      // Healing (or a reset) should not leave a stale ghost behind the new,
      // larger fill — snap it into place.
      setGhostPct(pct);
      return;
    }

    // Hold the old width, then let the CSS transition drain it down.
    const timer = setTimeout(() => setGhostPct(pct), GHOST_HOLD_MS);
    return () => clearTimeout(timer);
  }, [current, pct]);

  return (
    <span className="bar bar--health">
      <span className="bar__ghost" style={{ width: `${ghostPct}%` }} />
      <span className="bar__fill" style={{ width: `${pct}%` }} />
      {shield > 0 && (
        <span className="bar__shield" style={{ left: `${pct}%`, width: `${shieldPct}%` }} />
      )}
    </span>
  );
}
