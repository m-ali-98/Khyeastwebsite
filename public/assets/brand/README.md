# Brand assets

## `logo.png` — the official company mark

**This file is currently a transparent placeholder. Replace it with the real
logo.**

The build sandbox has no outbound network access beyond the npm registry, so
the official artwork could not be downloaded automatically. Every part of the
site already points at this path — drop the real file here and the logo appears
everywhere at once, with no code changes:

```
public/assets/brand/logo.png
```

### Where it is used

| Location | Rendering |
| --- | --- |
| Navbar (`src/components/Layout.jsx`) | knocked out to white over the hero, full colour once the bar turns light on scroll |
| Footer (`src/components/Layout.jsx`) | knocked out to white |
| Admin login card (`src/admin/AdminApp.jsx`) | full colour |
| Admin sidebar (`src/admin/AdminApp.jsx`) | knocked out to white |
| Browser tab + iOS home screen (`index.html`) | full colour |
| First-paint boot splash (`index.html`) | full colour, white in dark mode |

### Requirements for the file

- **PNG with a transparent background.** The white-knockout used on dark
  grounds is a `brightness(0) invert(1)` filter, which only works if the
  background is actually transparent — a white box would turn into a black box.
- **Trimmed**, with no baked-in padding around the mark, or it will look
  undersized next to the wordmark.
- Around **600–800 px tall** is plenty. The largest on-screen use is 78 px, so
  that covers 3× retina with room to spare.

### If the aspect ratio is not 1210 × 1280

Update `RATIO` at the top of `src/components/Logo.jsx`. It only reserves the
correct box before the image decodes, so the navbar does not reflow on load —
it does not stretch the artwork (`object-fit: contain` guards that).

### Optional: a crisper tab icon

A raster favicon at small sizes is acceptable but not ideal. If a vector
version of the mark exists, save it as `public/favicon.svg` and restore the
icon link in `index.html` to:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
```
