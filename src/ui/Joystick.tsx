import { useEffect, useRef } from 'react';
import { resetMoveAxis, setMoveAxis } from '@/bridge/inputState';
import { applyDeadzone } from '@/game/systems/movement';

const RADIUS = 56;
const KNOB_RADIUS = 26;
const DEADZONE = 0.15;

/**
 * Virtual thumbstick.
 *
 * Holds no React state at all. The knob is positioned by writing a transform
 * straight onto its DOM node, and the axes go into the shared `inputState`
 * object. Routing either through `useState` would re-render this component on
 * every pointermove — 60 to 120 times a second while walking — which is exactly
 * the stutter the architecture is built to avoid.
 */
export function Joystick() {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const knobRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;

    const moveKnob = (dx: number, dy: number) => {
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const update = (event: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;

      let dx = event.clientX - centreX;
      let dy = event.clientY - centreY;

      // Clamp the knob inside the base ring while letting the *input* magnitude
      // saturate at 1, so dragging further just keeps running at full speed.
      const distance = Math.hypot(dx, dy);
      if (distance > RADIUS) {
        dx = (dx / distance) * RADIUS;
        dy = (dy / distance) * RADIUS;
      }

      moveKnob(dx, dy);
      setMoveAxis(applyDeadzone(dx / RADIUS, DEADZONE), applyDeadzone(dy / RADIUS, DEADZONE));
    };

    const onPointerDown = (event: PointerEvent) => {
      if (pointerIdRef.current !== null) return; // ignore a second finger
      pointerIdRef.current = event.pointerId;

      // Capture so the drag keeps tracking after the finger leaves the element —
      // players routinely slide well outside the ring.
      base.setPointerCapture(event.pointerId);
      base.classList.add('joystick--active');
      update(event);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      update(event);
    };

    const release = (event: PointerEvent) => {
      if (event.pointerId !== pointerIdRef.current) return;
      pointerIdRef.current = null;

      if (base.hasPointerCapture(event.pointerId)) {
        base.releasePointerCapture(event.pointerId);
      }

      base.classList.remove('joystick--active');
      moveKnob(0, 0);
      resetMoveAxis();
    };

    base.addEventListener('pointerdown', onPointerDown);
    base.addEventListener('pointermove', onPointerMove);
    base.addEventListener('pointerup', release);
    // pointercancel matters as much as pointerup on Android: the system steals
    // the pointer for the notification shade or a back gesture, and without this
    // the player keeps walking into a wall forever.
    base.addEventListener('pointercancel', release);
    base.addEventListener('lostpointercapture', release);

    return () => {
      base.removeEventListener('pointerdown', onPointerDown);
      base.removeEventListener('pointermove', onPointerMove);
      base.removeEventListener('pointerup', release);
      base.removeEventListener('pointercancel', release);
      base.removeEventListener('lostpointercapture', release);
      resetMoveAxis();
    };
  }, []);

  return (
    <div
      ref={baseRef}
      className="joystick"
      style={{ width: RADIUS * 2, height: RADIUS * 2 }}
      role="application"
      aria-label="Movement joystick"
    >
      <div
        ref={knobRef}
        className="joystick__knob"
        style={{ width: KNOB_RADIUS * 2, height: KNOB_RADIUS * 2 }}
      />
    </div>
  );
}
