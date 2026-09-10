import { useEffect, useRef, useState } from 'react';
import { combatStore } from '@/state/combatStore';
import type { CombatantId } from '@/game/combat/types';

interface Props {
  combatantId: CombatantId;
}

interface Floater {
  id: number;
  text: string;
  kind: 'damage' | 'heal' | 'poison' | 'drain';
}

/** Matches the CSS animation duration; the node is dropped once it finishes. */
const FLOAT_LIFETIME_MS = 900;

let nextFloaterId = 0;

/**
 * Damage and healing numbers that rise off a combatant panel.
 *
 * Driven by `battle.events` rather than by diffing health, so it can label
 * *why* the number happened — a poison tick reads differently from a hit, and a
 * Bleed-doubled hit is worth calling out. Diffing health could only ever show a
 * bare number.
 *
 * Subscribes to the store directly instead of taking props: these appear and
 * vanish on their own timers, and routing that through the parent would
 * re-render every panel on each frame of the animation.
 */
export function FloatingNumbers({ combatantId }: Props) {
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    const unsubscribe = combatStore.subscribe((state, previous) => {
      const events = state.battle?.events ?? [];
      // Same state object means nothing advanced; an empty list means the
      // transition touched nobody worth animating.
      if (events.length === 0 || state.battle === previous.battle) return;

      const added: Floater[] = [];

      for (const event of events) {
        switch (event.type) {
          case 'attack':
            if (event.targetId === combatantId && event.damage > 0) {
              added.push({
                id: nextFloaterId++,
                text: event.bleed ? `-${event.damage} ✦` : `-${event.damage}`,
                kind: 'damage',
              });
            }
            break;
          case 'poison':
            if (event.targetId === combatantId) {
              added.push({ id: nextFloaterId++, text: `-${event.damage}`, kind: 'poison' });
            }
            break;
          case 'heal':
            if (event.targetId === combatantId) {
              added.push({
                id: nextFloaterId++,
                text: event.revived ? 'REVIVED' : `+${event.amount}`,
                kind: 'heal',
              });
            }
            break;
          case 'drain':
            if (event.targetId === combatantId && event.amount > 0) {
              added.push({ id: nextFloaterId++, text: `-${event.amount} stam`, kind: 'drain' });
            }
            break;
          default:
            break;
        }
      }

      if (added.length === 0) return;

      setFloaters((existing) => [...existing, ...added]);

      const timer = setTimeout(() => {
        const ids = new Set(added.map((floater) => floater.id));
        setFloaters((existing) => existing.filter((floater) => !ids.has(floater.id)));
      }, FLOAT_LIFETIME_MS);

      timers.current.push(timer);
    });

    return () => {
      unsubscribe();
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
    };
  }, [combatantId]);

  if (floaters.length === 0) return null;

  return (
    <span className="floaters" aria-hidden="true">
      {floaters.map((floater, index) => (
        <span
          key={floater.id}
          className={`floater floater--${floater.kind}`}
          // Stagger simultaneous numbers so an area attack doesn't stack them
          // into one illegible blob.
          style={{ animationDelay: `${index * 90}ms` }}
        >
          {floater.text}
        </span>
      ))}
    </span>
  );
}
