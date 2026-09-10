import type { GameEventName, GameEvents } from './events';

type Handler = (payload: never) => void;

/**
 * The single channel for discrete events between Phaser and React.
 *
 * Deliberately dependency-free — it does NOT wrap `Phaser.Events.EventEmitter`.
 * Two reasons:
 *
 *  1. Importing Phaser pulls in a WebGL renderer, which does not initialise under
 *     jsdom. Keeping the bus engine-free means bridge and UI logic stay unit
 *     testable without a headless GPU.
 *  2. Nothing in `bridge/` should depend on either framework, so the UI layer and
 *     the engine layer are each replaceable without touching this contract.
 *
 * Usage rule: this carries *discrete* events only — things that happen a handful
 * of times a second at most. Per-frame data belongs in `inputState`, and durable
 * game state belongs in the store.
 */
class TypedEventBus {
  private readonly handlers = new Map<GameEventName, Set<Handler>>();

  on<E extends GameEventName>(event: E, handler: (payload: GameEvents[E]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler);

    // Returning an unsubscribe closure makes this directly usable as a React
    // useEffect cleanup, which is the shape every consumer actually wants.
    return () => this.off(event, handler);
  }

  once<E extends GameEventName>(event: E, handler: (payload: GameEvents[E]) => void): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<E extends GameEventName>(event: E, handler: (payload: GameEvents[E]) => void): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as Handler);
    if (set.size === 0) this.handlers.delete(event);
  }

  emit<E extends VoidEventName>(event: E): void;
  emit<E extends PayloadEventName>(event: E, payload: GameEvents[E]): void;
  emit<E extends GameEventName>(event: E, payload?: GameEvents[E]): void {
    const set = this.handlers.get(event);
    if (!set) return;

    // Iterate a copy: a handler is allowed to unsubscribe itself (or others)
    // during dispatch without corrupting this loop.
    for (const handler of [...set]) {
      (handler as (p: GameEvents[E] | undefined) => void)(payload);
    }
  }

  /** Drops every listener. Called when the Phaser game is destroyed. */
  clear(): void {
    this.handlers.clear();
  }

  /** Test helper — how many listeners are attached to an event. */
  listenerCount(event: GameEventName): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

/** Events whose payload is `void` — emitted with no second argument. */
type VoidEventName = {
  [E in GameEventName]: GameEvents[E] extends void ? E : never;
}[GameEventName];

/** Events that require a payload argument. */
type PayloadEventName = Exclude<GameEventName, VoidEventName>;

export const EventBus = new TypedEventBus();
export type { TypedEventBus };
