import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventBus } from '@/bridge/EventBus';

afterEach(() => {
  EventBus.clear();
});

describe('EventBus', () => {
  it('delivers a payload to a subscriber', () => {
    const handler = vi.fn();
    EventBus.on('preload:progress', handler);

    EventBus.emit('preload:progress', { progress: 0.5 });

    expect(handler).toHaveBeenCalledWith({ progress: 0.5 });
  });

  it('delivers void events with no payload', () => {
    const handler = vi.fn();
    EventBus.on('ui:action-pressed', handler);

    EventBus.emit('ui:action-pressed');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fans out to every subscriber', () => {
    const a = vi.fn();
    const b = vi.fn();
    EventBus.on('game:paused', a);
    EventBus.on('game:paused', b);

    EventBus.emit('game:paused');

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function usable as a useEffect cleanup', () => {
    const handler = vi.fn();
    const unsubscribe = EventBus.on('game:paused', handler);

    unsubscribe();
    EventBus.emit('game:paused');

    expect(handler).not.toHaveBeenCalled();
    expect(EventBus.listenerCount('game:paused')).toBe(0);
  });

  it('unsubscribing twice is harmless', () => {
    const unsubscribe = EventBus.on('game:paused', vi.fn());
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();
  });

  it('once fires exactly once', () => {
    const handler = vi.fn();
    EventBus.once('game:resumed', handler);

    EventBus.emit('game:resumed');
    EventBus.emit('game:resumed');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(EventBus.listenerCount('game:resumed')).toBe(0);
  });

  it('lets a handler unsubscribe itself mid-dispatch without skipping others', () => {
    // Iterating the live Set would skip the second handler here.
    const calls: string[] = [];

    const unsubscribeFirst = EventBus.on('game:paused', () => {
      calls.push('first');
      unsubscribeFirst();
    });
    EventBus.on('game:paused', () => calls.push('second'));

    EventBus.emit('game:paused');

    expect(calls).toEqual(['first', 'second']);
  });

  it('emitting an event with no listeners is a no-op', () => {
    expect(() => EventBus.emit('world:ready', { mapKey: 'overworld' })).not.toThrow();
  });

  it('keeps events isolated from one another', () => {
    const paused = vi.fn();
    EventBus.on('game:paused', paused);

    EventBus.emit('game:resumed');

    expect(paused).not.toHaveBeenCalled();
  });
});
