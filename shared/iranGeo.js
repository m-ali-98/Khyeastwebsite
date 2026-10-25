/* ==========================================================================
   Iranian provinces.

   A province list is a closed set, so it is a <select> and validated on the
   server. City is free text: a complete شهرستان/بخش dataset is thousands of
   rows that would have to be kept current, and a wrong-but-confident list is
   worse for a village address than letting someone type where they live.
   ========================================================================== */
export const PROVINCES = [
  'آذربایجان شرقی',
  'آذربایجان غربی',
  'اردبیل',
  'اصفهان',
  'البرز',
  'ایلام',
  'بوشهر',
  'تهران',
  'چهارمحال و بختیاری',
  'خراسان جنوبی',
  'خراسان رضوی',
  'خراسان شمالی',
  'خوزستان',
  'زنجان',
  'سمنان',
  'سیستان و بلوچستان',
  'فارس',
  'قزوین',
  'قم',
  'کردستان',
  'کرمان',
  'کرمانشاه',
  'کهگیلویه و بویراحمد',
  'گلستان',
  'گیلان',
  'لرستان',
  'مازندران',
  'مرکزی',
  'هرمزگان',
  'همدان',
  'یزد',
];

export const isProvince = (v) => PROVINCES.includes(String(v || '').trim());

/** Iranian postal codes are exactly 10 digits. The fourth digit is never 5
 *  and the code never starts with 0 — rules worth enforcing, because a
 *  mistyped code means a parcel that does not arrive. Persian digits are
 *  folded first, since that is what a Persian keyboard produces. */
export function normalizePostal(raw) {
  const digits = String(raw || '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(digits)) return null;
  if (digits[0] === '0' || digits[3] === '5') return null;
  return digits;
}
