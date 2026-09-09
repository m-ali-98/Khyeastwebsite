# Brand assets

The official company mark. `logo.png` is the source of truth — every surface of
the site points at it, so replacing that one file updates the logo everywhere.

## Files

| File | Size | Used for |
| --- | --- | --- |
| `logo.png` | 837x800 | the mark itself, everywhere on the site |
| `apple-touch-icon.png` | 188x180 | iOS home screen |
| `favicon-64.png` | 67x64 | browser tab |
| `favicon-32.png` | 33x32 | browser tab, smaller displays |
| `logo-original.png` | 837x800 | the untouched supplied artwork, kept for reference |

All are transparent RGBA PNGs, trimmed so there is no padding baked in around
the mark.

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
| Browser tab / iOS (`index.html`) | full colour |

## Replacing the logo

Drop a new PNG at `public/assets/brand/logo.png`. Two requirements:

- **Transparent background.** The white rendering on dark grounds is a
  `brightness(0) invert(1)` filter, which only touches inked pixels. A white
  box behind the mark would become a black box.
- **Trimmed**, with no surrounding padding, or it will look undersized next to
  the wordmark.

If the new artwork has a different aspect ratio, update `RATIO` at the top of
`src/components/Logo.jsx` to match. It only reserves the correct box so the
navbar does not reflow while the image decodes; `object-fit: contain` prevents
any stretching regardless.

Regenerate the icon files from the new artwork at the sizes in the table above.
