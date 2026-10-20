/* Browser wrapper around the sanitizer shared with the Node persistence
   boundary. Keeping one whitelist prevents client/server policy drift. */
export { sanitizeHtml } from '../../shared/sanitizeHtml.js';

/* Tiny inline highlight markup for plain texts: [[accent part]] */
export function renderHighlight(text = '') {
  const parts = String(text).split(/\[\[(.+?)\]\]/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? <em key={index}>{part}</em> : <span key={index}>{part}</span>
  );
}
