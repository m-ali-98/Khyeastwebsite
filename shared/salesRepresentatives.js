/* Sales representatives are Persian-site content stored inside the existing
   `collections` editorial section. Keeping this model schema-free lets Admin
   add/remove locations without changing SQLite's operational contract. */

export const MAX_SALES_REPRESENTATIVES = 250;

export const IRAN_PROVINCES = Object.freeze([
  ['IR-03', 'آذربایجان شرقی'], ['IR-04', 'آذربایجان غربی'], ['IR-24', 'اردبیل'],
  ['IR-10', 'اصفهان'], ['IR-30', 'البرز'], ['IR-16', 'ایلام'], ['IR-18', 'بوشهر'],
  ['IR-23', 'تهران'], ['IR-14', 'چهارمحال و بختیاری'], ['IR-29', 'خراسان جنوبی'],
  ['IR-09', 'خراسان رضوی'], ['IR-28', 'خراسان شمالی'], ['IR-06', 'خوزستان'],
  ['IR-19', 'زنجان'], ['IR-20', 'سمنان'], ['IR-11', 'سیستان و بلوچستان'],
  ['IR-07', 'فارس'], ['IR-26', 'قزوین'], ['IR-25', 'قم'], ['IR-12', 'کردستان'],
  ['IR-08', 'کرمان'], ['IR-05', 'کرمانشاه'], ['IR-17', 'کهگیلویه و بویراحمد'],
  ['IR-27', 'گلستان'], ['IR-01', 'گیلان'], ['IR-15', 'لرستان'], ['IR-02', 'مازندران'],
  ['IR-00', 'مرکزی'], ['IR-22', 'هرمزگان'], ['IR-13', 'همدان'], ['IR-21', 'یزد'],
].map(([code, name]) => Object.freeze({ code, name })));

/* Common commercial centres plus every city in the supplied representative
   worksheet. Admin uses this catalogue only to fill map coordinates; a custom
   city remains possible by entering latitude/longitude manually. */
export const IRAN_SALES_CITIES = Object.freeze([
  ['آذربایجان شرقی', 'تبریز', 38.0800, 46.2919],
  ['آذربایجان شرقی', 'مراغه', 37.3892, 46.2370],
  ['آذربایجان غربی', 'ارومیه', 37.5527, 45.0761],
  ['آذربایجان غربی', 'خوی', 38.5503, 44.9521],
  ['اردبیل', 'اردبیل', 38.2498, 48.2933],
  ['اصفهان', 'اصفهان', 32.6539, 51.6660],
  ['اصفهان', 'کاشان', 33.9850, 51.4099],
  ['البرز', 'کرج', 35.8400, 50.9391],
  ['ایلام', 'ایلام', 33.6374, 46.4227],
  ['ایلام', 'مهران', 33.1222, 46.1646],
  ['بوشهر', 'بوشهر', 28.9234, 50.8203],
  ['تهران', 'تهران', 35.6892, 51.3890],
  ['تهران', 'تهران و اندیشه', 35.7000, 51.1800],
  ['تهران', 'اندیشه', 35.6803, 50.9781],
  ['تهران', 'شهر ری', 35.5729, 51.4409],
  ['تهران', 'ملارد', 35.6659, 50.9767],
  ['تهران', 'بهارستان', 35.5331, 51.1608],
  ['چهارمحال و بختیاری', 'شهرکرد', 32.3256, 50.8644],
  ['خراسان جنوبی', 'بیرجند', 32.8649, 59.2262],
  ['خراسان رضوی', 'مشهد', 36.2972, 59.6067],
  ['خراسان شمالی', 'بجنورد', 37.4747, 57.3290],
  ['خوزستان', 'اهواز', 31.3183, 48.6706],
  ['خوزستان', 'دزفول', 32.3831, 48.4236],
  ['خوزستان', 'اندیمشک', 32.4619, 48.3480],
  ['زنجان', 'زنجان', 36.6743, 48.4845],
  ['سمنان', 'سمنان', 35.5769, 53.3921],
  ['سیستان و بلوچستان', 'زاهدان', 29.4963, 60.8629],
  ['فارس', 'شیراز', 29.5918, 52.5837],
  ['فارس', 'مرودشت', 29.8742, 52.8025],
  ['قزوین', 'قزوین', 36.2688, 50.0041],
  ['قم', 'قم', 34.6416, 50.8746],
  ['کردستان', 'سنندج', 35.3219, 46.9862],
  ['کردستان', 'مریوان', 35.5183, 46.1827],
  ['کرمان', 'کرمان', 30.2839, 57.0834],
  ['کرمان', 'جیرفت', 28.6751, 57.7372],
  ['کرمانشاه', 'کرمانشاه', 34.3142, 47.0650],
  ['کرمانشاه', 'اسلام آباد غرب', 34.1094, 46.5275],
  ['کهگیلویه و بویراحمد', 'یاسوج', 30.6682, 51.5879],
  ['گلستان', 'گرگان', 36.8427, 54.4439],
  ['گلستان', 'کردکوی', 36.7931, 54.1103],
  ['گیلان', 'رشت', 37.2808, 49.5832],
  ['گیلان', 'تالش', 37.8013, 48.9070],
  ['گیلان', 'آستانه اشرفیه', 37.2596, 49.9444],
  ['لرستان', 'خرم آباد', 33.4878, 48.3558],
  ['مازندران', 'ساری', 36.5633, 53.0601],
  ['مازندران', 'بابل', 36.5513, 52.6784],
  ['مرکزی', 'اراک', 34.0917, 49.6892],
  ['هرمزگان', 'بندرعباس', 27.1832, 56.2666],
  ['همدان', 'همدان', 34.7989, 48.5150],
  ['همدان', 'نهاوند', 34.1885, 48.3769],
  ['یزد', 'یزد', 31.8974, 54.3569],
].map(([province, city, latitude, longitude]) => Object.freeze({ province, city, latitude, longitude })));

const plainRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export const normalizePersianLocation = (value) => String(value || '')
  .normalize('NFKC')
  .replace(/[يى]/g, 'ی')
  .replace(/ك/g, 'ک')
  .replace(/[\u200c\s]+/g, ' ')
  .trim();

export function findIranSalesCity(city, province = '') {
  const wantedCity = normalizePersianLocation(city);
  const wantedProvince = normalizePersianLocation(province);
  if (!wantedCity) return null;
  const exact = IRAN_SALES_CITIES.find((item) => (
    normalizePersianLocation(item.city) === wantedCity &&
    (!wantedProvince || normalizePersianLocation(item.province) === wantedProvince)
  ));
  if (exact || wantedProvince) return exact || null;
  return IRAN_SALES_CITIES.find((item) => normalizePersianLocation(item.city) === wantedCity) || null;
}

export function salesRepresentativeProblem(value) {
  if (!Array.isArray(value)) return { code: 'not-array', index: -1 };
  if (value.length > MAX_SALES_REPRESENTATIVES) return { code: 'too-many', index: -1 };
  const ids = new Set();
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!plainRecord(item)) return { code: 'invalid-row', index };
    if (['id', 'province', 'city', 'name', 'phone', 'brands'].some((key) => typeof item[key] !== 'string')) {
      return { code: 'invalid-field-type', index };
    }
    if (typeof item.active !== 'boolean') return { code: 'invalid-active', index };
    if (typeof item.latitude !== 'number' || typeof item.longitude !== 'number') {
      return { code: 'invalid-coordinate', index };
    }
    const id = String(item.id || '').trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 120) return { code: 'invalid-id', index };
    if (ids.has(id)) return { code: 'duplicate-id', index };
    ids.add(id);
    const province = normalizePersianLocation(item.province);
    const city = normalizePersianLocation(item.city);
    const name = String(item.name || '').trim();
    if (!IRAN_PROVINCES.some((entry) => entry.name === province)) return { code: 'invalid-province', index };
    if (city.length < 2 || city.length > 100) return { code: 'invalid-city', index };
    if (name.length < 2 || name.length > 200) return { code: 'invalid-name', index };
    const phone = item.phone.trim();
    const phoneDigits = phone.match(/[0-9۰-۹٠-٩]/g)?.length || 0;
    if (
      phone.length > 40 ||
      (phone && (!/^[0-9۰-۹٠-٩+().\-\s]+$/.test(phone) || phoneDigits < 7 || phoneDigits > 15))
    ) return { code: 'invalid-phone', index };
    if (String(item.brands || '').trim().length > 200) return { code: 'invalid-brands', index };
    const latitude = Number(item.latitude);
    const longitude = Number(item.longitude);
    if (!Number.isFinite(latitude) || latitude < 24 || latitude > 40 ||
        !Number.isFinite(longitude) || longitude < 44 || longitude > 64) {
      return { code: 'invalid-coordinate', index };
    }
  }
  return null;
}

export function normalizeSalesRepresentatives(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_SALES_REPRESENTATIVES).filter(plainRecord).map((item) => ({
    id: String(item.id || '').trim().slice(0, 120),
    province: normalizePersianLocation(item.province).slice(0, 100),
    city: normalizePersianLocation(item.city).slice(0, 100),
    name: String(item.name || '').normalize('NFKC').trim().slice(0, 200),
    phone: String(item.phone || '').normalize('NFKC').trim().slice(0, 40),
    brands: String(item.brands || '').normalize('NFKC').trim().slice(0, 200),
    latitude: Math.round(Number(item.latitude) * 1e6) / 1e6,
    longitude: Math.round(Number(item.longitude) * 1e6) / 1e6,
    active: item.active !== false,
  }));
}

const latinDigits = (value) => String(value || '')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

export function representativePhoneHref(value) {
  const phone = latinDigits(value).replace(/[^\d+]/g, '');
  if (!phone) return '';
  if (/^09\d{9}$/.test(phone)) return `tel:+98${phone.slice(1)}`;
  if (/^9\d{9}$/.test(phone)) return `tel:+98${phone}`;
  if (/^\+?98\d{10}$/.test(phone)) return `tel:+${phone.replace(/^\+/, '')}`;
  return `tel:${phone}`;
}


/* Initial Persian sales network transcribed from the supplied company worksheet. */
export const DEFAULT_SALES_REPRESENTATIVES = Object.freeze([
  {
    "id": "sales-rep-001",
    "province": "آذربایجان شرقی",
    "city": "تبریز",
    "name": "حسین شعربافی پور",
    "phone": "09120529660",
    "brands": "دزمایه و نان مایه",
    "latitude": 38.08,
    "longitude": 46.2919,
    "active": true
  },
  {
    "id": "sales-rep-002",
    "province": "آذربایجان شرقی",
    "city": "تبریز",
    "name": "امیر کرباسی",
    "phone": "09141130119",
    "brands": "شتاب مایه",
    "latitude": 38.08,
    "longitude": 46.2919,
    "active": true
  },
  {
    "id": "sales-rep-003",
    "province": "آذربایجان شرقی",
    "city": "مراغه",
    "name": "مهدی احمد پور پارسا",
    "phone": "09141769709",
    "brands": "نان مایه",
    "latitude": 37.3892,
    "longitude": 46.237,
    "active": true
  },
  {
    "id": "sales-rep-004",
    "province": "آذربایجان غربی",
    "city": "ارومیه",
    "name": "میثم مرسلی",
    "phone": "09308419995",
    "brands": "دز",
    "latitude": 37.5527,
    "longitude": 45.0761,
    "active": true
  },
  {
    "id": "sales-rep-005",
    "province": "آذربایجان غربی",
    "city": "ارومیه",
    "name": "کیوان قره آغاجی رزم",
    "phone": "09144479537",
    "brands": "دز",
    "latitude": 37.5527,
    "longitude": 45.0761,
    "active": true
  },
  {
    "id": "sales-rep-006",
    "province": "آذربایجان غربی",
    "city": "خوی",
    "name": "مهدی جلالی",
    "phone": "09147299694",
    "brands": "دز",
    "latitude": 38.5503,
    "longitude": 44.9521,
    "active": true
  },
  {
    "id": "sales-rep-007",
    "province": "اردبیل",
    "city": "اردبیل",
    "name": "قیوم تبادلی",
    "phone": "09147069369",
    "brands": "دزمایه",
    "latitude": 38.2498,
    "longitude": 48.2933,
    "active": true
  },
  {
    "id": "sales-rep-008",
    "province": "اصفهان",
    "city": "اصفهان",
    "name": "شرکت گنجینه نان رسان اسپادانا ( سعید دری)",
    "phone": "09139129780",
    "brands": "دزمایه و ایکس پاور",
    "latitude": 32.6539,
    "longitude": 51.666,
    "active": true
  },
  {
    "id": "sales-rep-009",
    "province": "اصفهان",
    "city": "اصفهان",
    "name": "شرکت بهین مایه نقش جهان (آقای نباتی نژاد)",
    "phone": "09131191151",
    "brands": "شتاب مایه",
    "latitude": 32.6539,
    "longitude": 51.666,
    "active": true
  },
  {
    "id": "sales-rep-010",
    "province": "اصفهان",
    "city": "کاشان",
    "name": "حسین معروفی",
    "phone": "09367343032",
    "brands": "دزمایه",
    "latitude": 33.985,
    "longitude": 51.4099,
    "active": true
  },
  {
    "id": "sales-rep-011",
    "province": "البرز",
    "city": "کرج",
    "name": "حسین فرهمندنیا",
    "phone": "09123606625",
    "brands": "دز",
    "latitude": 35.84,
    "longitude": 50.9391,
    "active": true
  },
  {
    "id": "sales-rep-012",
    "province": "البرز",
    "city": "کرج",
    "name": "سعید دری",
    "phone": "09139129780",
    "brands": "نان",
    "latitude": 35.84,
    "longitude": 50.9391,
    "active": true
  },
  {
    "id": "sales-rep-013",
    "province": "ایلام",
    "city": "مهران",
    "name": "محمود پورعزیزی",
    "phone": "09189447383",
    "brands": "دز",
    "latitude": 33.1222,
    "longitude": 46.1646,
    "active": true
  },
  {
    "id": "sales-rep-014",
    "province": "بوشهر",
    "city": "بوشهر",
    "name": "فرشاد چهارلنگ بتوند",
    "phone": "09163417786",
    "brands": "دز",
    "latitude": 28.9234,
    "longitude": 50.8203,
    "active": true
  },
  {
    "id": "sales-rep-015",
    "province": "خراسان رضوی",
    "city": "مشهد",
    "name": "حمیدرضا کافی",
    "phone": "09155073234",
    "brands": "دز",
    "latitude": 36.2972,
    "longitude": 59.6067,
    "active": true
  },
  {
    "id": "sales-rep-016",
    "province": "خراسان رضوی",
    "city": "مشهد",
    "name": "وحید اسلامی",
    "phone": "09155034695",
    "brands": "نان مایه",
    "latitude": 36.2972,
    "longitude": 59.6067,
    "active": true
  },
  {
    "id": "sales-rep-017",
    "province": "خوزستان",
    "city": "اندیمشک",
    "name": "امین حسنوند",
    "phone": "09369794722",
    "brands": "دز - نان",
    "latitude": 32.4619,
    "longitude": 48.348,
    "active": true
  },
  {
    "id": "sales-rep-018",
    "province": "سیستان و بلوچستان",
    "city": "زاهدان",
    "name": "شرکت پخش الوند پروتئین مهراد ( احمد گلپور)",
    "phone": "09154418316",
    "brands": "دز",
    "latitude": 29.4963,
    "longitude": 60.8629,
    "active": true
  },
  {
    "id": "sales-rep-019",
    "province": "فارس",
    "city": "شیراز",
    "name": "شرکت کیمیا طبیعت ثابت ( آقای ثابت )",
    "phone": "0917914235",
    "brands": "دز",
    "latitude": 29.5918,
    "longitude": 52.5837,
    "active": true
  },
  {
    "id": "sales-rep-020",
    "province": "فارس",
    "city": "مرودشت",
    "name": "سید کریم احراری",
    "phone": "09171284370",
    "brands": "دز",
    "latitude": 29.8742,
    "longitude": 52.8025,
    "active": true
  },
  {
    "id": "sales-rep-021",
    "province": "قم",
    "city": "قم",
    "name": "آقای شکوری",
    "phone": "09100584041",
    "brands": "دز",
    "latitude": 34.6416,
    "longitude": 50.8746,
    "active": true
  },
  {
    "id": "sales-rep-022",
    "province": "قم",
    "city": "قم",
    "name": "شرکت تعاونی نانوایان قم (آقای افروز)",
    "phone": "09122526358",
    "brands": "دز",
    "latitude": 34.6416,
    "longitude": 50.8746,
    "active": true
  },
  {
    "id": "sales-rep-023",
    "province": "قزوین",
    "city": "قزوین",
    "name": "مجتبی حاجی فتحعلی",
    "phone": "09122811531",
    "brands": "دز",
    "latitude": 36.2688,
    "longitude": 50.0041,
    "active": true
  },
  {
    "id": "sales-rep-024",
    "province": "کردستان",
    "city": "مریوان",
    "name": "یادگار صالحی",
    "phone": "09188753492",
    "brands": "دز",
    "latitude": 35.5183,
    "longitude": 46.1827,
    "active": true
  },
  {
    "id": "sales-rep-025",
    "province": "کردستان",
    "city": "سنندج",
    "name": "فایق مرادیان",
    "phone": "09183800000",
    "brands": "نان مایه",
    "latitude": 35.3219,
    "longitude": 46.9862,
    "active": true
  },
  {
    "id": "sales-rep-026",
    "province": "کرمان",
    "city": "کرمان",
    "name": "مجتبی صعصعی",
    "phone": "09133428755",
    "brands": "دز",
    "latitude": 30.2839,
    "longitude": 57.0834,
    "active": true
  },
  {
    "id": "sales-rep-027",
    "province": "کرمان",
    "city": "کرمان",
    "name": "مرتضی صعصعی",
    "phone": "09131400800",
    "brands": "دز",
    "latitude": 30.2839,
    "longitude": 57.0834,
    "active": true
  },
  {
    "id": "sales-rep-028",
    "province": "کرمان",
    "city": "جیرفت",
    "name": "علیرضا برزیگر",
    "phone": "09131489951",
    "brands": "دز",
    "latitude": 28.6751,
    "longitude": 57.7372,
    "active": true
  },
  {
    "id": "sales-rep-029",
    "province": "کرمانشاه",
    "city": "کرمانشاه",
    "name": "افشار مرادی",
    "phone": "09183563728",
    "brands": "دزمایه و نان مایه",
    "latitude": 34.3142,
    "longitude": 47.065,
    "active": true
  },
  {
    "id": "sales-rep-030",
    "province": "کرمانشاه",
    "city": "اسلام آباد غرب",
    "name": "سید حسام ابراهیمی",
    "phone": "09189977501",
    "brands": "نان مایه",
    "latitude": 34.1094,
    "longitude": 46.5275,
    "active": true
  },
  {
    "id": "sales-rep-031",
    "province": "گلستان",
    "city": "کردکوی",
    "name": "مریم اربابی دنگلانی",
    "phone": "09113719204",
    "brands": "دز",
    "latitude": 36.7931,
    "longitude": 54.1103,
    "active": true
  },
  {
    "id": "sales-rep-032",
    "province": "گیلان",
    "city": "رشت",
    "name": "رحمان خیبری",
    "phone": "09191423292",
    "brands": "دزمایه",
    "latitude": 37.2808,
    "longitude": 49.5832,
    "active": true
  },
  {
    "id": "sales-rep-033",
    "province": "گیلان",
    "city": "تالش",
    "name": "اصغر طهماسبی میانکوه",
    "phone": "09113823325",
    "brands": "دزمایه",
    "latitude": 37.8013,
    "longitude": 48.907,
    "active": true
  },
  {
    "id": "sales-rep-034",
    "province": "گیلان",
    "city": "رشت",
    "name": "اکبر محمدی",
    "phone": "09113373768",
    "brands": "نان مایه",
    "latitude": 37.2808,
    "longitude": 49.5832,
    "active": true
  },
  {
    "id": "sales-rep-035",
    "province": "گیلان",
    "city": "آستانه اشرفیه",
    "name": "محمدعلی باختر چوری",
    "phone": "09111413253",
    "brands": "دزمایه",
    "latitude": 37.2596,
    "longitude": 49.9444,
    "active": true
  },
  {
    "id": "sales-rep-036",
    "province": "لرستان",
    "city": "خرم آباد",
    "name": "محمود بهاروندی",
    "phone": "09163671789",
    "brands": "نان مایه",
    "latitude": 33.4878,
    "longitude": 48.3558,
    "active": true
  },
  {
    "id": "sales-rep-037",
    "province": "مازندران",
    "city": "بابل",
    "name": "سعید خیاط عمران",
    "phone": "09113115002",
    "brands": "دزمایه",
    "latitude": 36.5513,
    "longitude": 52.6784,
    "active": true
  },
  {
    "id": "sales-rep-038",
    "province": "مازندران",
    "city": "ساری",
    "name": "آقای عزیزپور",
    "phone": "09120069428",
    "brands": "شتاب مایه",
    "latitude": 36.5633,
    "longitude": 53.0601,
    "active": true
  },
  {
    "id": "sales-rep-039",
    "province": "مرکزی",
    "city": "اراک",
    "name": "ابوالفضل شاکری",
    "phone": "09188626347",
    "brands": "شتاب",
    "latitude": 34.0917,
    "longitude": 49.6892,
    "active": true
  },
  {
    "id": "sales-rep-040",
    "province": "هرمزگان",
    "city": "بندرعباس",
    "name": "فرشاد چهارلنگ",
    "phone": "",
    "brands": "دز - شتاب",
    "latitude": 27.1832,
    "longitude": 56.2666,
    "active": true
  },
  {
    "id": "sales-rep-041",
    "province": "همدان",
    "city": "نهاوند",
    "name": "شیرمحمد احمدوند",
    "phone": "09356092300",
    "brands": "دزمایه",
    "latitude": 34.1885,
    "longitude": 48.3769,
    "active": true
  },
  {
    "id": "sales-rep-042",
    "province": "یزد",
    "city": "یزد",
    "name": "شرکت تعاونی خبازان ( اقای قرابی)",
    "phone": "09131569805",
    "brands": "دزمایه",
    "latitude": 31.8974,
    "longitude": 54.3569,
    "active": true
  },
  {
    "id": "sales-rep-043",
    "province": "تهران",
    "city": "تهران و اندیشه",
    "name": "امامعلی شاهمرادی",
    "phone": "09123379415",
    "brands": "دز",
    "latitude": 35.7,
    "longitude": 51.18,
    "active": true
  },
  {
    "id": "sales-rep-044",
    "province": "تهران",
    "city": "شهر ری",
    "name": "اصغر محمدی",
    "phone": "09123170917",
    "brands": "نان",
    "latitude": 35.5729,
    "longitude": 51.4409,
    "active": true
  },
  {
    "id": "sales-rep-045",
    "province": "تهران",
    "city": "ملارد",
    "name": "مهدی ایوبی",
    "phone": "09126625179",
    "brands": "دز",
    "latitude": 35.6659,
    "longitude": 50.9767,
    "active": true
  },
  {
    "id": "sales-rep-046",
    "province": "تهران",
    "city": "بهارستان",
    "name": "شرکت تعاونی نانوایان گل گندم (آقای ایمانی)",
    "phone": "09124483926",
    "brands": "نان - دز",
    "latitude": 35.5331,
    "longitude": 51.1608,
    "active": true
  },
  {
    "id": "sales-rep-047",
    "province": "تهران",
    "city": "تهران",
    "name": "مهدی بادپا",
    "phone": "9122146751",
    "brands": "شتاب",
    "latitude": 35.6892,
    "longitude": 51.389,
    "active": true
  }
].map((item) => Object.freeze(item)));
