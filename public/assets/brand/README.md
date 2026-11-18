# Brand assets

The official company mark. The master lives in `assets-src/brand/` and is NOT
deployed; this folder holds only what the browser downloads.

## Files

| File | Size | Used for |
| --- | --- | --- |
| `logo.webp` | 268x256, ~12 KB | the transparent mark used throughout the site |
| `apple-touch-icon.png` | 180x180 | iOS home screen |
| `favicon-64.png` | 64x64 | browser tabs and high-density displays |
| `favicon-32.png` | 32x32 | browser tabs and smaller displays |

The favicon variants use a crimson gradient tile with the official mark knocked out
in white, keeping the logo legible at small sizes. The iOS icon is square and
full-bleed so the platform can apply its own mask.

Masters, kept out of `public/` so they are never shipped:

| File | Size | Used for |
| --- | --- | --- |
| `assets-src/brand/logo.png` | 837x800, 152 KB | source of truth for `logo.webp` |
| `assets-src/brand/logo-original.png` | 837x800 | the untouched supplied artwork, for reference |

The mark is never drawn larger than 72 px (the boot splash), so the 256px WebP
is already 3x oversampled; the 152 KB master was being downloaded in full to
paint a 46 px navbar logo.

`logo.webp` is transparent RGBA and trimmed so there is no padding baked in
around the mark. The favicon PNGs are square RGBA canvases with subtly rounded,
transparent corners; the Apple touch icon is a full-bleed square. Each centers
the white mark over the brand gradient.

## Colour

The supplied artwork runs orange (`#f86100`) to dark maroon (`#770101`), which
read as a different brand next to the site accent. `logo.png` is therefore a
recoloured version, mapped onto the site crimson ramp top to bottom:

| Position | Colour |
| --- | --- |
| 0% | `#e92044` |
| 42% | `#c91134` |
| 78% | `#8d0a25` |
| 100% | `#5c0618` |

The recolour preserves per-pixel shading rather than flattening the mark: each
pixel keeps its brightness *relative to* the artwork's own gradient at that
height, so antialiased edges stay smooth. `logo-original.png` is the unmodified
file if the original palette is ever wanted back.

## Where the mark appears

| Location | Rendering |
| --- | --- |
| Navbar (`src/components/Layout.jsx`) | white over the hero, full colour once the bar turns light on scroll |
| Footer (`src/components/Layout.jsx`) | white |
| Admin login card (`src/admin/AdminApp.jsx`) | full colour |
| Admin sidebar (`src/admin/AdminApp.jsx`) | white |
| Boot splash (`index.html`) | full colour, white in dark mode |
| Browser tab / iOS (`index.html`) | white mark on the crimson gradient for high contrast |

## Replacing the logo

Drop a new PNG at `assets-src/brand/logo.png`, then regenerate the deployed
logo and icons:

```bash
node scripts/logo-webp.mjs
node scripts/favicon.mjs
```

Two requirements:

- **Transparent background.** The white rendering on dark grounds is a
  `brightness(0) invert(1)` filter, which only touches inked pixels. A white
  box behind the mark would become a black box.
- **Trimmed**, with no surrounding padding, or it will look undersized next to
  the wordmark.

If the new artwork has a different aspect ratio, update `RATIO` at the top of
`src/components/Logo.jsx` to match. It only reserves the correct box so the
navbar does not reflow while the image decodes; `object-fit: contain` prevents
any stretching regardless.

The favicon generator keeps the source mark's alpha as a white knockout and
renders the favicon and Apple touch icon at the dimensions listed above.
