import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createGameConfig } from './config';

/**
 * Mounts the Phaser game into a bare container div, exactly once.
 *
 * This component renders an empty div and nothing else — React never reconciles
 * anything inside the canvas container, so the game loop is entirely outside
 * React's control. All communication goes through the EventBus and the store.
 */
export function PhaserGame() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // ── StrictMode guard ────────────────────────────────────────────────────
    // React 19 StrictMode runs effects mount → unmount → mount in development.
    // Without this, the first game survives the fake unmount and the second
    // mount stacks another canvas on top of it: two running game loops, doubled
    // input handling, and half the framerate. This is the single most common
    // bug in a React + Phaser setup, and it only reproduces in dev.
    if (gameRef.current) return;

    // Belt and braces: Phaser defers part of its teardown to the next game step,
    // so a canvas can outlive destroy() if the game is torn down before it has
    // finished booting. Clearing the container makes the mount idempotent
    // regardless of how the previous instance went away.
    container.replaceChildren();

    const game = new Phaser.Game(createGameConfig(container));
    gameRef.current = game;

    return () => {
      // `true` removes the canvas from the DOM as well as tearing down the game.
      game.destroy(true);
      gameRef.current = null;

      // Deliberately NOT calling EventBus.clear() here. UI components that are
      // still mounted hold their own subscriptions, and clearing the whole bus
      // would silently unsubscribe them. Each scene removes its own listeners on
      // SHUTDOWN instead.
    };
  }, []);

  return <div ref={containerRef} className="game-canvas" aria-hidden="true" />;
}
