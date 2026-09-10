import { beforeEach, describe, expect, it } from 'vitest';
import { inputState, resetMoveAxis, setMoveAxis } from '@/bridge/inputState';

beforeEach(() => {
  resetMoveAxis();
});

describe('inputState', () => {
  it('stores the axes that were set', () => {
    setMoveAxis(0.5, -0.25);

    expect(inputState.moveX).toBe(0.5);
    expect(inputState.moveY).toBe(-0.25);
    expect(inputState.active).toBe(true);
  });

  it('clamps out-of-range axes', () => {
    setMoveAxis(4, -9);

    expect(inputState.moveX).toBe(1);
    expect(inputState.moveY).toBe(-1);
  });

  it('resets to neutral and inactive', () => {
    setMoveAxis(1, 1);
    resetMoveAxis();

    expect(inputState.moveX).toBe(0);
    expect(inputState.moveY).toBe(0);
    expect(inputState.active).toBe(false);
  });

  it('keeps a stable object identity so the scene can hold the reference', () => {
    // WorldScene captures this object once at import; replacing it rather than
    // mutating it would silently stop input reaching the game.
    const reference = inputState;
    setMoveAxis(1, 0);
    resetMoveAxis();

    expect(reference).toBe(inputState);
  });
});
