const foldDigits = (value) => String(value || '')
  .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
  .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

/** Convert an Iranian local or international number to a callable E.164 URI
 * value. Office numbers are Admin-managed, so tolerate spaces, punctuation,
 * Persian/Arabic digits, and an optional `tel:` prefix. */
export function iranPhoneE164(value) {
  const compact = foldDigits(value)
    .trim()
    .replace(/^tel:/i, '')
    .replace(/[\s\-()./]/g, '');

  let national = '';
  if (/^\+98\d+$/.test(compact)) national = compact.slice(3);
  else if (/^0098\d+$/.test(compact)) national = compact.slice(4);
  else if (/^98\d+$/.test(compact)) national = compact.slice(2);
  else if (/^0\d+$/.test(compact)) national = compact.slice(1);
  else if (/^\d+$/.test(compact)) national = compact;

  return /^\d{10}$/.test(national) ? `+98${national}` : '';
}

const toArabicDigits = (value) => value.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);

/** International display for non-Persian visitors. Iranian landlines use a
 * two-digit area code after +98; mobiles use the familiar three-digit prefix. */
export function internationalPhoneDisplay(value, locale = 'en') {
  const e164 = iranPhoneE164(value);
  if (!e164) return '';
  const national = e164.slice(3);
  const groups = national.startsWith('9')
    ? [national.slice(0, 3), national.slice(3, 6), national.slice(6)]
    : [national.slice(0, 2), national.slice(2, 6), national.slice(6)];
  const display = `+98 ${groups.join(' ')}`;
  return locale === 'ar' ? toArabicDigits(display) : display;
}
