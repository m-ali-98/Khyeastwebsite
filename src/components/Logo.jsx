/*
  Official company mark — Khuzestan Yeast.

  Drawn as vector geometry rather than a bitmap so it stays sharp at every
  size, keeps a transparent background, and can be recoloured per context
  (the footer and the dark nav need a solid light version of it).

  Geometry is authored in a 1210x1280 space to match the source artwork's
  proportions; `size` scales the height and the width follows.
*/

const W = 1210;
const H = 1280;

/* The three strokes of the monogram, in drawing order. */
const STROKES = [
  /* upper-left: the horizontal bar and the long V that drops from it */
  'M92 148 H420',
  'M92 148 L405 548',
  'M512 296 L403 520',
  /* the spine: top-right bar, the long diagonal down to the baseline,
     and the foot that runs back to the right */
  'M680 148 H1068',
  'M680 148 L214 1178',
  'M214 1178 H614',
  /* lower-right chevron */
  'M898 676 L762 958 L1158 1190',
];

export default function Logo({ size = 46, variant = 'gradient', className = 'nav__logo-mark' }) {
  /* `solid` paints the mark in the inherited text colour, which is what the
     dark navbar and the footer need; `gradient` is the brand rendering. */
  const solid = variant === 'solid';
  const gid = 'ky-logo-grad';

  return (
    <svg
      className={className}
      width={(size * W) / H}
      height={size}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      {!solid && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0%" stopColor="#F2660A" />
            <stop offset="45%" stopColor="#D8390C" />
            <stop offset="100%" stopColor="#8A0F0B" />
          </linearGradient>
        </defs>
      )}
      <g
        fill="none"
        stroke={solid ? 'currentColor' : `url(#${gid})`}
        strokeWidth="52"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {STROKES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}
