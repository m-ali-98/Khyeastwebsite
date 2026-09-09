/*
  Official company mark — Khuzestan Yeast.

  This renders the real artwork from public/assets/brand/logo.png rather than a
  hand-traced approximation, so the mark on screen is exactly the file the
  company signed off on.

  Contexts differ in what they need from it:
    - `gradient` (default) paints the artwork as-is, for light backgrounds.
    - `solid` knocks it out to a single flat colour via a brightness/invert
      filter. The dark navbar and footer need this: the artwork fades into a
      near-black ground at its maroon end, so tinting it to plain white keeps
      the whole mark legible instead of losing its lower half.

  The source PNG has a transparent background, which is what makes the filter
  trick work — it only ever touches the inked pixels.
*/

/* Intrinsic proportions of the trimmed artwork, used to reserve the right box
   before the image decodes so the navbar never reflows on load. */
const RATIO = 837 / 800;

export default function Logo({ size = 46, variant = 'gradient', className = 'nav__logo-mark' }) {
  const solid = variant === 'solid';

  return (
    <img
      className={`${className}${solid ? ' is-solid' : ''}`}
      src="/assets/brand/logo.png"
      alt=""
      aria-hidden="true"
      width={Math.round(size * RATIO)}
      height={size}
      decoding="async"
      /* the mark is above the fold in the navbar — never lazy-load it */
      loading="eager"
      draggable="false"
    />
  );
}
