/**
 * Movement maths. Pure — no Phaser import, no DOM, no store access.
 *
 * Everything in `systems/` follows that rule: scenes orchestrate, systems decide.
 * It is what makes the game logic testable without standing up a WebGL context.
 */

export interface Vector2 {
  x: number;
  y: number;
}

export type Facing = 'up' | 'down' | 'left' | 'right';

/**
 * Converts raw joystick axes into a velocity vector.
 *
 * Normalises the input vector so diagonal movement isn't ~1.41x faster than
 * cardinal movement — the classic bug from naively multiplying each axis by
 * speed independently.
 */
export function axesToVelocity(moveX: number, moveY: number, speed: number): Vector2 {
  const magnitude = Math.hypot(moveX, moveY);

  if (magnitude === 0) {
    return { x: 0, y: 0 };
  }

  // A magnitude below 1 (partial joystick deflection) is preserved so the player
  // can walk slowly; only overshoot past 1 gets clamped.
  const scale = (magnitude > 1 ? 1 / magnitude : 1) * speed;

  return { x: moveX * scale, y: moveY * scale };
}

/**
 * Picks a facing direction for sprite animation from a velocity vector.
 *
 * The dominant axis wins, so a mostly-rightward diagonal shows the side-facing
 * animation rather than flickering between two. Returns the previous facing when
 * stationary, so the sprite doesn't snap back to a default on release.
 */
export function velocityToFacing(velocity: Vector2, previous: Facing): Facing {
  if (velocity.x === 0 && velocity.y === 0) {
    return previous;
  }

  if (Math.abs(velocity.x) > Math.abs(velocity.y)) {
    return velocity.x > 0 ? 'right' : 'left';
  }

  return velocity.y > 0 ? 'down' : 'up';
}

/** Applies a deadzone, rescaling the remaining range so output still reaches 1. */
export function applyDeadzone(value: number, deadzone: number): number {
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;

  const rescaled = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(value) * rescaled;
}
