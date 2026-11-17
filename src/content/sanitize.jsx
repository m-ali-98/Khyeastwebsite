/* Browser wrapper around the sanitizer shared with the Node persistence
   boundary. Keeping one whitelist prevents client/server policy drift. */
export {
  sanitizeHtml,
  sanitizeHtmlResult,
  RICH_TEXT_COLOR_IDS,
  RICH_TEXT_TABLE_LIMITS,
} from '../../shared/sanitizeHtml.js';

export function richTextRejectionMessage(result) {
  const limit = result?.limit ? new Intl.NumberFormat('fa-IR').format(result.limit) : '';
  if (result?.code === 'input-too-large') return `متن بیش از حد بزرگ است؛ حداکثر ${limit} نویسه مجاز است. هیچ تغییری ذخیره نشد.`;
  if (result?.code === 'node-limit') return `ساختار HTML بیش از ${limit} گره دارد. متن را ساده‌تر کنید؛ هیچ تغییری ذخیره نشد.`;
  if (result?.code === 'depth-limit') return `ساختار HTML بیش از ${limit} سطح تو‌در‌تو دارد. متن را ساده‌تر کنید؛ هیچ تغییری ذخیره نشد.`;
  return 'HTML این متن قابل پردازش نیست. ساختار آن را اصلاح کنید؛ هیچ تغییری ذخیره نشد.';
}

/* Tiny inline highlight markup for plain texts: [[accent part]] */
export function renderHighlight(text = '') {
  const parts = String(text).split(/\[\[(.+?)\]\]/g);
  return parts.map((part, index) =>
    index % 2 === 1 ? <em key={index}>{part}</em> : <span key={index}>{part}</span>
  );
}
