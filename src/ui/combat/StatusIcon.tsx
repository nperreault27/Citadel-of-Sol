import type { StatusKind } from '@/game/combat/types';

/**
 * Status glyphs, drawn as inline SVG.
 *
 * SVG rather than emoji: emoji render at wildly different sizes and styles
 * across Android WebView versions, ignore `currentColor`, and cannot be
 * recoloured per status. These are solid shapes with no thin strokes, because
 * the badge renders at 20px on a phone and hairlines disappear at that size.
 */
export function StatusIcon({ kind }: { kind: StatusKind }) {
  switch (kind) {
    case 'poison':
      // A stoppered vial with liquid in the lower half and a rising bubble.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M9 2h6a1 1 0 0 1 0 2h-.5v3.2l4.1 9.6A4 4 0 0 1 14.9 22H9.1a4 4 0 0 1-3.7-5.2L9.5 7.2V4H9a1 1 0 0 1 0-2Zm2.5 2v3.6a1 1 0 0 1-.08.4L8.9 14h6.2l-2.52-6a1 1 0 0 1-.08-.4V4h-1Z" />
          <circle cx="12" cy="17.5" r="1.6" opacity="0.55" />
        </svg>
      );

    case 'bleed':
      // A blood droplet.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2.2c4.2 5.4 6.8 8.9 6.8 12A6.8 6.8 0 0 1 5.2 14.2c0-3.1 2.6-6.6 6.8-12Z" />
          <path d="M9.4 13.4a2.6 2.6 0 0 0 2.6 4.4 4.6 4.6 0 0 1-2.6-4.4Z" opacity="0.45" />
        </svg>
      );

    case 'strength':
      // A thick upward arrow.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 3 21 13h-5v8H8v-8H3l9-10Z" />
        </svg>
      );

    case 'weakness':
      // The same arrow, inverted.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 21 3 11h5V3h8v8h5l-9 10Z" />
        </svg>
      );
  }
}
