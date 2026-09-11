import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

/** How long a press has to last before it counts as a look rather than a tap. */
export const HOLD_MS = 320;

/** How far a finger may drift mid-press and still count as holding still. */
const SLOP_PX = 12;

export interface HoldHandlers {
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  /**
   * Whether the press that just ended was a hold. Reading it clears it, so the
   * click that follows a look does not also play the card.
   */
  consumeHold: () => boolean;
}

/**
 * Press and hold to look at something. It stays up once it is up.
 *
 * `onHold(true)` fires once the press has lasted long enough. Letting go does
 * *not* end it — a look you have to keep a thumb on is a look you cannot read,
 * since the thumb is over the thing you are reading. Closing it is the caller's
 * business: whatever it puts on screen takes the next tap.
 *
 * `onHold(false)` therefore fires for one reason only: the element went away
 * mid-look, and what it was showing has to go with it.
 *
 * The pointer is deliberately not captured: without capture a finger sliding
 * off the element raises `pointerleave`, which cancels a press that had not yet
 * become a hold.
 */
export function useHoldToInspect(onHold: (holding: boolean) => void): HoldHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const holding = useRef(false);
  const wasHold = useRef(false);

  // Held in a ref, not closed over: showing the card re-renders the hand, which
  // hands us a fresh callback, and a handler bound to the old one would either
  // go stale or tear the look down the instant it opened.
  const latest = useRef(onHold);
  useEffect(() => {
    latest.current = onHold;
  }, [onHold]);

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    origin.current = null;
  }, []);

  // A card can leave the hand mid-look — played, discarded, battle over — and
  // the look has to close with it.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (holding.current) latest.current(false);
    },
    []
  );

  // Letting go, or sliding off, only abandons a press that has not yet become a
  // hold. Once it has, the look is open and stays open.
  const stop = useCallback(() => {
    cancelTimer();
  }, [cancelTimer]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent) => {
      cancelTimer();
      wasHold.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        holding.current = true;
        wasHold.current = true;
        latest.current(true);
      }, HOLD_MS);
    },
    [cancelTimer]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const from = origin.current;
      if (!from || holding.current) return;
      const drifted =
        Math.abs(event.clientX - from.x) > SLOP_PX || Math.abs(event.clientY - from.y) > SLOP_PX;
      if (drifted) cancelTimer();
    },
    [cancelTimer]
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,

    // Android raises a context menu on long press, which would slam a selection
    // callout over the card the player is trying to read.
    onContextMenu: useCallback((event: ReactMouseEvent) => event.preventDefault(), []),

    consumeHold: useCallback(() => {
      const held = wasHold.current;
      wasHold.current = false;
      return held;
    }, []),
  };
}
