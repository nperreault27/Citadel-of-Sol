import { beforeEach, describe, expect, it } from 'vitest';
import { gameStore, toSaveData } from '@/state/store';
import { CURRENT_SAVE_VERSION, createNewSave } from '@/save/schema';

const initial = gameStore.getState();

beforeEach(() => {
  gameStore.setState(initial, true);
});

describe('health', () => {
  it('clamps damage at zero', () => {
    gameStore.getState().damage(999);
    expect(gameStore.getState().health).toBe(0);
  });

  it('clamps healing at max', () => {
    gameStore.getState().damage(5);
    gameStore.getState().heal(999);
    expect(gameStore.getState().health).toBe(gameStore.getState().maxHealth);
  });

  it('raises the ceiling and the value together', () => {
    gameStore.getState().setHealth(15, 20);
    expect(gameStore.getState().health).toBe(15);
    expect(gameStore.getState().maxHealth).toBe(20);
  });

  it('clamps a value above a newly lowered max', () => {
    gameStore.getState().setHealth(50, 8);
    expect(gameStore.getState().health).toBe(8);
  });
});

describe('inventory', () => {
  it('stacks a repeated item rather than duplicating the row', () => {
    gameStore.getState().addItem('potion');
    gameStore.getState().addItem('potion', 2);

    expect(gameStore.getState().inventory).toEqual([{ itemId: 'potion', quantity: 3 }]);
  });

  it('keeps distinct items separate', () => {
    gameStore.getState().addItem('potion');
    gameStore.getState().addItem('key');

    expect(gameStore.getState().inventory).toHaveLength(2);
  });

  it('drops a row once its quantity reaches zero', () => {
    gameStore.getState().addItem('key', 2);
    gameStore.getState().removeItem('key', 2);

    expect(gameStore.getState().inventory).toEqual([]);
  });

  it('does not leave a negative quantity behind', () => {
    gameStore.getState().addItem('key');
    gameStore.getState().removeItem('key', 5);

    expect(gameStore.getState().inventory).toEqual([]);
  });
});

describe('flags', () => {
  it('records a flag once only', () => {
    gameStore.getState().setFlag('chest-1');
    gameStore.getState().setFlag('chest-1');

    expect(gameStore.getState().visitedFlags).toEqual(['chest-1']);
  });

  it('keeps the same array reference when nothing changed', () => {
    gameStore.getState().setFlag('chest-1');
    const before = gameStore.getState().visitedFlags;
    gameStore.getState().setFlag('chest-1');

    // Identity stability matters: WorldScene's autosave subscription compares
    // these by reference, so a no-op write must not trigger a save.
    expect(gameStore.getState().visitedFlags).toBe(before);
  });

  it('reads a flag back', () => {
    expect(gameStore.getState().hasFlag('chest-1')).toBe(false);
    gameStore.getState().setFlag('chest-1');
    expect(gameStore.getState().hasFlag('chest-1')).toBe(true);
  });
});

describe('dialog', () => {
  it('walks through lines and closes past the last one', () => {
    gameStore.getState().openDialog('Sign', ['one', 'two']);
    expect(gameStore.getState().dialog?.lineIndex).toBe(0);

    gameStore.getState().advanceDialog();
    expect(gameStore.getState().dialog?.lineIndex).toBe(1);

    gameStore.getState().advanceDialog();
    expect(gameStore.getState().dialog).toBeNull();
  });

  it('advancing with no dialog open is harmless', () => {
    expect(() => gameStore.getState().advanceDialog()).not.toThrow();
    expect(gameStore.getState().dialog).toBeNull();
  });
});

describe('hydrateFromSave', () => {
  it('copies save values into the store', () => {
    const save = createNewSave();
    save.player.health = 3;
    save.player.maxHealth = 12;
    save.world.visitedFlags = ['a'];
    save.inventory = [{ itemId: 'key', quantity: 1 }];

    gameStore.getState().hydrateFromSave(save, false);

    const state = gameStore.getState();
    expect(state.health).toBe(3);
    expect(state.maxHealth).toBe(12);
    expect(state.visitedFlags).toEqual(['a']);
    expect(state.inventory).toEqual([{ itemId: 'key', quantity: 1 }]);
  });

  it('does not alias the save arrays', () => {
    // Sharing the array would let later gameplay mutate the loaded save object.
    const save = createNewSave();
    save.world.visitedFlags = ['a'];

    gameStore.getState().hydrateFromSave(save, false);
    gameStore.getState().setFlag('b');

    expect(save.world.visitedFlags).toEqual(['a']);
  });

  it('surfaces a reset save to the UI', () => {
    gameStore.getState().hydrateFromSave(createNewSave(), true);
    expect(gameStore.getState().saveWasReset).toBe(true);
  });
});

describe('toSaveData', () => {
  it('takes position from the caller and everything else from the store', () => {
    gameStore.getState().addItem('key');
    gameStore.getState().setFlag('chest-1');
    gameStore.getState().damage(2);

    const save = toSaveData({ x: 100, y: 200, facing: 'left' }, CURRENT_SAVE_VERSION);

    expect(save.player.x).toBe(100);
    expect(save.player.y).toBe(200);
    expect(save.player.facing).toBe('left');
    expect(save.player.health).toBe(8);
    expect(save.world.visitedFlags).toEqual(['chest-1']);
    expect(save.inventory).toEqual([{ itemId: 'key', quantity: 1 }]);
  });

  it('produces something the schema accepts', async () => {
    const { saveDataSchema } = await import('@/save/schema');
    const save = toSaveData({ x: 0, y: 0, facing: 'down' }, CURRENT_SAVE_VERSION);

    expect(saveDataSchema.safeParse(save).success).toBe(true);
  });
});
