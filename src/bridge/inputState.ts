/**
 * Per-frame input, shared as a plain mutable object.
 *
 * The React joystick writes to this on pointer events; `WorldScene.update()`
 * reads it 60 times a second. It is deliberately NOT React state and NOT in the
 * Zustand store: routing a joystick through either would re-render the component
 * tree on every pointermove, which is exactly the stutter this architecture
 * exists to avoid.
 *
 * Mutation is the point here. Do not replace the object identity — both sides
 * hold the same reference.
 */
export interface InputState {
  /** Normalised horizontal axis, -1 (left) to 1 (right). */
  moveX: number;
  /** Normalised vertical axis, -1 (up) to 1 (down). */
  moveY: number;
  /** True while the joystick is being touched at all. */
  active: boolean;
}

export const inputState: InputState = {
  moveX: 0,
  moveY: 0,
  active: false,
};

/** Sets the movement axes, clamping each to the [-1, 1] range the scene expects. */
export function setMoveAxis(x: number, y: number): void {
  inputState.moveX = clamp(x, -1, 1);
  inputState.moveY = clamp(y, -1, 1);
  inputState.active = true;
}

/**
 * Zeroes the axes. Call on pointer up/cancel — and note that `pointercancel`
 * matters as much as `pointerup` on Android, where the system can steal a
 * pointer mid-drag (notification shade, back gesture) and leave the player
 * walking into a wall forever if only `pointerup` is handled.
 */
export function resetMoveAxis(): void {
  inputState.moveX = 0;
  inputState.moveY = 0;
  inputState.active = false;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
