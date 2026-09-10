import { useEffect } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { EventBus } from '@/bridge/EventBus';
import { gameStore } from '@/state/store';
import { saveService } from '@/save';

/**
 * Android hardware back button and app lifecycle.
 *
 * Play reviewers do check back-button behaviour, and an app that ignores back or
 * quits straight out of gameplay reads as broken. The rule implemented here is
 * the one players expect from a game:
 *
 *   dialog open  → close the dialog
 *   playing      → open the pause menu
 *   paused       → leave the app (state is already flushed on pause)
 */
export function useAndroidLifecycle(): void {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const handles: PluginListenerHandle[] = [];
    let cancelled = false;

    const register = (handle: Promise<PluginListenerHandle>) => {
      void handle.then((resolved) => {
        // The component can unmount before the plugin resolves; remove
        // immediately rather than leaking a listener.
        if (cancelled) void resolved.remove();
        else handles.push(resolved);
      });
    };

    register(
      App.addListener('backButton', () => {
        const state = gameStore.getState();

        if (state.dialog) {
          state.closeDialog();
          return;
        }

        if (state.phase === 'paused') {
          void saveService.flush().finally(() => void App.exitApp());
          return;
        }

        EventBus.emit('ui:pause');
      })
    );

    register(
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) return;

        // Backgrounding is the last reliable moment before Android may kill the
        // process, so force any debounced write out now. Pausing also clears the
        // active move path, so the player doesn't return to find themselves
        // still walking somewhere they no longer remember tapping.
        void saveService.flush();
        EventBus.emit('ui:pause');
      })
    );

    return () => {
      cancelled = true;
      for (const handle of handles) void handle.remove();
    };
  }, []);
}
