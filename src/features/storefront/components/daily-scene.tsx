import { useId } from "react";

import type { DailySceneMotif } from "@/features/storefront/domain/daily-scene-theme";

const LEAF = "M0 0 C12 -18 34 -22 50 -6 C34 9 14 10 0 0 Z";

/** One soft plant branch: a curved stem with leaves, drawn as a shadow, never as an object. */
function Branch({ className }: { className: string }) {
  const leaves: [number, number, number, number][] = [
    [0, 0, -30, 1],
    [14, 22, 20, 0.9],
    [30, 40, -45, 1.1],
    [44, 66, 10, 0.95],
    [60, 86, -35, 1.05],
    [72, 112, 25, 0.85],
  ];
  return (
    <g className={className}>
      <path d="M0 0 C20 40 50 80 80 130" fill="none" strokeWidth="2.5" />
      {leaves.map(([x, y, rotate, scale]) => (
        <path
          key={`${x}-${y}`}
          d={LEAF}
          transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}
        />
      ))}
    </g>
  );
}

/**
 * The wall of the «today's category» scene: window light, soft rays and plant shadows drawn in
 * SVG, coloured by the category theme through CSS variables. It is decoration only (hidden from
 * assistive technology) and stays behind the products, text and buttons. Drawn for a left-to-right
 * page; the stylesheet mirrors it on Arabic pages so the window always sits on the products' side.
 */
export function DailySceneWall({ motif }: { motif: DailySceneMotif }) {
  const id = useId().replace(/:/g, "");
  const wall = `${id}-wall`;
  const glow = `${id}-glow`;
  const sky = `${id}-sky`;
  const ray = `${id}-ray`;
  const blur = `${id}-blur`;
  const soft = `${id}-soft`;
  const tile = `${id}-tile`;

  return (
    <svg
      className="daily-scene-wall"
      viewBox="0 0 800 360"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={wall} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="daily-scene-stop-wall-top" />
          <stop offset="1" className="daily-scene-stop-wall-bottom" />
        </linearGradient>
        <radialGradient id={glow} cx="0.7" cy="0.3" r="0.6">
          <stop offset="0" className="daily-scene-stop-light" stopOpacity="0.95" />
          <stop offset="1" className="daily-scene-stop-light" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" className="daily-scene-stop-light" />
        </linearGradient>
        <linearGradient id={ray} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={blur} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id={soft} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="10" />
        </filter>
        <pattern id={tile} width="44" height="44" patternUnits="userSpaceOnUse">
          <path d="M44 0 H0 V44" fill="none" className="daily-scene-line" />
        </pattern>
      </defs>

      <rect width="800" height="360" fill={`url(#${wall})`} />
      {motif === "tiles" ? (
        <rect y="150" width="800" height="210" fill={`url(#${tile})`} />
      ) : null}
      <ellipse cx="560" cy="110" rx="340" ry="230" fill={`url(#${glow})`} />

      {motif === "arch" ? (
        <g className="daily-scene-window">
          <path
            d="M470 330 V150 A110 110 0 0 1 690 150 V330 Z"
            fill={`url(#${sky})`}
          />
          <path
            d="M470 330 V150 A110 110 0 0 1 690 150 V330 M580 40 V330 M470 200 H690"
            fill="none"
            className="daily-scene-frame"
          />
        </g>
      ) : (
        <g className="daily-scene-window">
          <rect x="480" y="18" width="200" height="150" rx="10" fill={`url(#${sky})`} />
          <path
            d="M480 28 a10 10 0 0 1 10 -10 H670 a10 10 0 0 1 10 10 V168 H480 Z M580 18 V168"
            fill="none"
            className="daily-scene-frame"
          />
        </g>
      )}

      {/* Sunlight falling from the window towards the text panel. */}
      <g filter={`url(#${soft})`} opacity="0.55">
        <path d="M500 30 L585 30 L430 360 L300 360 Z" fill={`url(#${ray})`} />
        <path d="M610 30 L670 30 L560 360 L470 360 Z" fill={`url(#${ray})`} />
      </g>

      {/* Plant shadows: one in focus at the corner, one cast softly on the wall. */}
      <g filter={`url(#${blur})`}>
        <g transform="translate(730 -10) scale(1.25)">
          <Branch className="daily-scene-leaves" />
        </g>
        <g transform="translate(790 60) scale(-1 1) rotate(-12)">
          <Branch className="daily-scene-leaves" />
        </g>
      </g>
      <g filter={`url(#${soft})`} transform="translate(360 40) scale(1.1)">
        <Branch className="daily-scene-leaves daily-scene-leaves--cast" />
      </g>
    </svg>
  );
}
