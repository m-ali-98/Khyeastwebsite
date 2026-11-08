import DEFAULT_STATE from '../../shared/contentDefaults.js';
import {
  IRAN_PROVINCES,
  findIranSalesCity,
  normalizePersianLocation,
  normalizeSalesRepresentatives,
  representativePhoneHref,
  salesRepresentativeProblem,
} from '../../shared/salesRepresentatives.js';
import {
  IRAN_MAP_VIEWBOX,
  IRAN_PROVINCE_SHAPES,
  projectIranCoordinate,
} from '../../src/data/iranMap.js';

let pass = 0;
let total = 0;
const leaks = [];
const check = (condition, label, detail = '') => {
  total += 1;
  if (condition) pass += 1;
  else leaks.push(`LEAK ${label}${detail ? ` — ${detail}` : ''}`);
};

const rows = DEFAULT_STATE.collections.salesRepresentatives;
const normalized = normalizeSalesRepresentatives(rows);
const provinceNames = new Set(rows.map((item) => item.province));
const mapNames = new Set(IRAN_PROVINCE_SHAPES.map((item) => item.fa));

check(rows.length === 47, 'all 47 supplied worksheet rows are seeded', String(rows.length));
check(provinceNames.size === 25, 'the worksheet covers 25 provinces', String(provinceNames.size));
check(salesRepresentativeProblem(rows) === null, 'the seeded collection passes strict persistence validation');
check(IRAN_PROVINCES.length === 31 && IRAN_PROVINCE_SHAPES.length === 31, 'catalogue and map both cover 31 Iranian provinces');
check(mapNames.size === 31 && IRAN_PROVINCE_SHAPES.every((item) => item.id && item.d), 'every map province has unique local SVG geometry');
check(rows.every((item) => mapNames.has(item.province)), 'every supplied representative maps to an Iran province');
check(normalized.length === rows.length && normalized.every((item) => item.active), 'normalization preserves all active seed rows');
check(rows.some((item) => item.city === 'بندرعباس' && item.phone === ''), 'a missing worksheet phone remains blank rather than fabricated');
check(rows.some((item) => item.city === 'تهران و اندیشه' && item.brands === 'دز'), 'worksheet city and brand detail is preserved');

const gorgan = findIranSalesCity('گرگان', 'گلستان');
check(gorgan?.latitude === 36.8427 && gorgan?.longitude === 54.4439, 'Gorgan receives its catalogued marker coordinates');
check(findIranSalesCity('گرگان', 'فارس') === null, 'a city cannot silently jump to a different selected province');
check(normalizePersianLocation('  كرج‌  ') === 'کرج', 'Persian location matching normalizes Arabic glyphs and spacing');
check(representativePhoneHref('09123456789') === 'tel:+989123456789', 'Iranian mobile numbers get a callable international href');
check(representativePhoneHref('') === '', 'missing phones do not create a fake call action');

const { width: viewWidth, height: viewHeight } = IRAN_MAP_VIEWBOX;
check(
  rows.every((item) => {
    const point = projectIranCoordinate(item.longitude, item.latitude);
    return point && point.x >= 0 && point.x <= viewWidth && point.y >= 0 && point.y <= viewHeight;
  }),
  'every worksheet coordinate projects inside the local Iran viewBox',
);

for (const [mutation, code, label] of [
  [(item) => { item.latitude = 99; }, 'invalid-coordinate', 'out-of-Iran coordinates are rejected'],
  [(item) => { item.latitude = String(item.latitude); }, 'invalid-coordinate', 'string coordinates are rejected at the API boundary'],
  [(item) => { item.active = 'false'; }, 'invalid-active', 'non-boolean active state is rejected'],
  [(item) => { item.phone = 'javascript:alert(1)'; }, 'invalid-phone', 'non-phone contact payloads are rejected'],
  [(item) => { item.province = 'خارج از ایران'; }, 'invalid-province', 'unknown provinces are rejected'],
  [(item, copy) => { item.id = copy[1].id; }, 'duplicate-id', 'duplicate representative IDs are rejected'],
]) {
  const copy = structuredClone(rows);
  mutation(copy[0], copy);
  check(salesRepresentativeProblem(copy)?.code === code, label);
}

for (const line of leaks) console.log(line);
console.log(`${pass}/${total}`);
if (pass !== total) process.exitCode = 1;
