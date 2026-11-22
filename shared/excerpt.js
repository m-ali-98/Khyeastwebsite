/** Repair legacy excerpts which were saved after a character-level cut.
 * Keep the editorial source unchanged; the final token before a trailing
 * ellipsis may be incomplete, so display the preceding whole words instead. */
export function wordBoundaryExcerpt(value) {
  const text = String(value ?? '').trim();
  if (!/\S…$/.test(text)) return text;
  return text.replace(/\s+\S+…$/, '…');
}
