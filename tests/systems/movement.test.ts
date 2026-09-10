import { describe, expect, it } from 'vitest';
import { axesToVelocity, velocityToFacing } from '@/game/systems/movement';

describe('axesToVelocity', () => {
  it('returns zero for no input', () => {
    expect(axesToVelocity(0, 0, 140)).toEqual({ x: 0, y: 0 });
  });

  it('moves at full speed along a cardinal direction', () => {
    expect(axesToVelocity(1, 0, 140)).toEqual({ x: 140, y: 0 });
    expect(axesToVelocity(0, -1, 140)).toEqual({ x: 0, y: -140 });
  });

  it('does not let diagonals travel faster than cardinals', () => {
    // The bug this guards: multiplying each axis by speed independently gives a
    // magnitude of 140 * sqrt(2) ≈ 198 on a diagonal, so players learn to always
    // walk at 45°.
    const diagonal = axesToVelocity(1, 1, 140);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeCloseTo(140, 5);
  });

  it('preserves partial deflection so the player can walk slowly', () => {
    const half = axesToVelocity(0.5, 0, 140);
    expect(half.x).toBeCloseTo(70, 5);
  });

  it('clamps overshoot past the unit circle', () => {
    const overshoot = axesToVelocity(3, 4, 100); // magnitude 5
    expect(Math.hypot(overshoot.x, overshoot.y)).toBeCloseTo(100, 5);
  });
});

describe('velocityToFacing', () => {
  it('keeps the previous facing when stationary', () => {
    expect(velocityToFacing({ x: 0, y: 0 }, 'left')).toBe('left');
  });

  it('picks the dominant axis', () => {
    expect(velocityToFacing({ x: 10, y: 3 }, 'down')).toBe('right');
    expect(velocityToFacing({ x: 3, y: 10 }, 'up')).toBe('down');
    expect(velocityToFacing({ x: -10, y: -3 }, 'up')).toBe('left');
    expect(velocityToFacing({ x: 3, y: -10 }, 'down')).toBe('up');
  });

  it('resolves an exact 45° tie to the vertical axis rather than flickering', () => {
    expect(velocityToFacing({ x: 10, y: 10 }, 'up')).toBe('down');
  });
});

describe('axesToVelocity for click-to-move', () => {
  it('steers at full speed toward a distant waypoint', () => {
    // Callers pass a raw pixel delta, which is far outside the unit circle.
    const velocity = axesToVelocity(300, 0, 140);
    expect(velocity.x).toBeCloseTo(140, 5);
    expect(velocity.y).toBeCloseTo(0, 5);
  });

  it('keeps speed constant regardless of how far the waypoint is', () => {
    const near = axesToVelocity(10, 10, 140);
    const far = axesToVelocity(1000, 1000, 140);
    expect(Math.hypot(near.x, near.y)).toBeCloseTo(Math.hypot(far.x, far.y), 5);
  });
});
