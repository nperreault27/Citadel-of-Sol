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

    case 'fatigue':
      // An hourglass: time and effort draining away.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M5 2h14a1 1 0 0 1 0 2h-1v2.2a5 5 0 0 1-1.9 3.93L13.6 12l2.5 1.87A5 5 0 0 1 18 17.8V20h1a1 1 0 0 1 0 2H5a1 1 0 0 1 0-2h1v-2.2a5 5 0 0 1 1.9-3.93L10.4 12 7.9 10.13A5 5 0 0 1 6 6.2V4H5a1 1 0 0 1 0-2Zm3 2v2.2a3 3 0 0 0 1.1 2.33L12 10.75l2.9-2.22A3 3 0 0 0 16 6.2V4H8Zm4 10.75-2.9 2.22A3 3 0 0 0 8 17.8V20h8v-2.2a3 3 0 0 0-1.1-2.33L12 14.75Z" />
        </svg>
      );

    case 'taunt':
      // A shout: a mouth with sound arcs coming off it.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M11 4.2a1 1 0 0 0-1.6-.8L5.3 7H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.3l4.1 3.6a1 1 0 0 0 1.6-.8V4.2Z" />
          <path d="M15.4 8.3a1 1 0 0 1 1.4.1 5.5 5.5 0 0 1 0 7.2 1 1 0 0 1-1.5-1.3 3.5 3.5 0 0 0 0-4.6 1 1 0 0 1 .1-1.4Z" />
          <path d="M18.4 5.2a1 1 0 0 1 1.4.1 9.5 9.5 0 0 1 0 13.4 1 1 0 1 1-1.5-1.3 7.5 7.5 0 0 0 0-10.8 1 1 0 0 1 .1-1.4Z" opacity="0.6" />
        </svg>
      );

    case 'counter':
      // Crossed blades: a blow answered.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M4.6 3.2 3.2 4.6l8.1 8.1 1.4-1.4-8.1-8.1Zm14.8 0-8.1 8.1 1.4 1.4 8.1-8.1-1.4-1.4Z" />
          <path d="M13.4 13.4 12 14.8l4.3 4.3a2 2 0 1 0 2.8-2.8l-5.7-2.9Zm-2.8 0-5.7 2.9a2 2 0 1 0 2.8 2.8L12 14.8l-1.4-1.4Z" />
        </svg>
      );

    case 'immunity':
      // A shield with a solid centre.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2 4 5.2v6.3c0 4.6 3.3 8.8 8 10.5 4.7-1.7 8-5.9 8-10.5V5.2L12 2Zm0 2.2 6 2.4v4.9c0 3.5-2.4 6.8-6 8.3-3.6-1.5-6-4.8-6-8.3V6.6l6-2.4Z" />
          <path d="M12 7.2 8 8.8v2.7c0 2 1.5 3.9 4 4.9 2.5-1 4-2.9 4-4.9V8.8l-4-1.6Z" opacity="0.65" />
        </svg>
      );

    case 'undying':
      // A drop cradled in a crescent: blood held back from the dark.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2.6c3.4 4.5 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2.1-5.5 5.5-10Z" />
          <path d="M3.4 12.4a1 1 0 0 1 1.2.8 7.5 7.5 0 0 0 14.8 0 1 1 0 1 1 2 .4 9.5 9.5 0 0 1-18.8 0 1 1 0 0 1 .8-1.2Z" opacity="0.7" />
        </svg>
      );

    case 'defenseUp':
      // A shield with an upward chevron: protection, raised.
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 2 4 5.2v6.3c0 4.6 3.3 8.8 8 10.5 4.7-1.7 8-5.9 8-10.5V5.2L12 2Zm0 2.2 6 2.4v4.9c0 3.5-2.4 6.8-6 8.3-3.6-1.5-6-4.8-6-8.3V6.6l6-2.4Z" />
          <path d="m12 7.4 4 4.4h-2.4v3.6h-3.2v-3.6H8l4-4.4Z" />
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
