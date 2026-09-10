/**
 * The complete contract between the Phaser world and the React UI.
 *
 * Every event that crosses the boundary is declared here with its payload type,
 * so both sides are checked against the same definition. If it isn't in this
 * map, it doesn't cross.
 *
 * Naming convention: `<source>:<past-tense-fact>` for things that happened,
 * `<source>:<imperative>` for things being requested.
 */

/** Discrete facts the game world reports up to the UI. */
export interface GameToUiEvents {
  'preload:progress': { progress: number };
  'preload:complete': void;
  'world:ready': { mapKey: string };
  'player:moved-tile': { tileX: number; tileY: number };
  'player:health-changed': { current: number; max: number };
  'dialog:open': { speaker: string; lines: string[] };
  'loot:acquired': { itemId: string; quantity: number };
  'game:paused': void;
  'game:resumed': void;
}

/** Commands the UI sends down into the game world. */
export interface UiToGameEvents {
  'ui:pause': void;
  'ui:resume': void;
  'ui:dialog-choice': { choiceIndex: number };
  'ui:action-pressed': void;
  'ui:request-save': void;
}

export type GameEvents = GameToUiEvents & UiToGameEvents;

export type GameEventName = keyof GameEvents;

/**
 * Payload for a given event. Events declared as `void` take no payload argument,
 * which the EventBus overloads enforce at the call site.
 */
export type GameEventPayload<E extends GameEventName> = GameEvents[E];
