/* ==========================================================================
   Public product catalogue traced from the company's recovered catalogue and
   product-detail pages on khuzestanyeast-co.com (September 2026).

   Keep the commercial variants in one locale-neutral list. The Persian base
   content and the English/Arabic overlays are built from the same rows, so a
   newly added package size cannot silently disappear in another language.
   Product photographs remain same-origin, repository-owned brand images; the
   recovered WordPress image URLs are not safe deployment dependencies.
   ========================================================================== */

export const CATALOG_SOURCE_URL = 'https://khuzestanyeast-co.com/products/';

export const CATALOG_VARIANTS = Object.freeze([
  /* Dezmaye Gold — 9 catalogue variants. */
  { slug: 'dezmaye-gold-70', brand: 'dezmaye', amount: 70, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 4 },
  { slug: 'dezmaye-gold-80', brand: 'dezmaye', amount: 80, unit: 'g', package: 'sachet', carton: 50, shelfMonths: 12, featured: true, imageCount: 3 },
  { slug: 'dezmaye-gold-90', brand: 'dezmaye', amount: 90, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 3 },
  { slug: 'dezmaye-gold-100', brand: 'dezmaye', amount: 100, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 6 },
  /* Keep the established slug because the shop SKU and old indexed links use it. */
  { slug: 'dezmaye-golden-400', brand: 'dezmaye', amount: 400, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 4 },
  { slug: 'dezmaye-gold-450', brand: 'dezmaye', amount: 450, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 5 },
  { slug: 'dezmaye-gold-500', brand: 'dezmaye', amount: 500, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 5 },
  { slug: 'dezmaye-gold-5kg', brand: 'dezmaye', amount: 5, unit: 'kg', package: 'vacuum', carton: 2, shelfMonths: 24, imageCount: 4 },
  { slug: 'dezmaye-gold-10kg', brand: 'dezmaye', amount: 10, unit: 'kg', package: 'bag', carton: null, shelfMonths: 6, imageCount: 3 },

  /* Shetab Maye — 7 catalogue variants. */
  { slug: 'shetab-70', brand: 'shetab', amount: 70, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'shetab-80', brand: 'shetab', amount: 80, unit: 'g', package: 'sachet', carton: 50, shelfMonths: 12, imageCount: 1 },
  { slug: 'shetab-90', brand: 'shetab', amount: 90, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, featured: true, imageCount: 1 },
  { slug: 'shetab-100', brand: 'shetab', amount: 100, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'shetab-450', brand: 'shetab', amount: 450, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 1 },
  { slug: 'shetab-500', brand: 'shetab', amount: 500, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 3 },
  { slug: 'shetab-5kg', brand: 'shetab', amount: 5, unit: 'kg', package: 'vacuum', carton: 2, shelfMonths: 24, imageCount: 1 },

  /* X-Power — 7 catalogue variants. */
  { slug: 'xpower-70', brand: 'xpower', amount: 70, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, featured: true, imageCount: 1 },
  { slug: 'xpower-80', brand: 'xpower', amount: 80, unit: 'g', package: 'sachet', carton: 50, shelfMonths: 12, imageCount: 1 },
  { slug: 'xpower-90', brand: 'xpower', amount: 90, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'xpower-100', brand: 'xpower', amount: 100, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'xpower-450', brand: 'xpower', amount: 450, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 1 },
  { slug: 'xpower-500', brand: 'xpower', amount: 500, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, layers: 4, imageCount: 1 },
  { slug: 'xpower-5kg', brand: 'xpower', amount: 5, unit: 'kg', package: 'vacuum', carton: 2, shelfMonths: 24, imageCount: 1 },

  /* Nan Maye — 7 catalogue variants. */
  { slug: 'nanmaye-70', brand: 'nanmaye', amount: 70, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'nanmaye-80', brand: 'nanmaye', amount: 80, unit: 'g', package: 'sachet', carton: 50, shelfMonths: 12, imageCount: 1 },
  { slug: 'nanmaye-90', brand: 'nanmaye', amount: 90, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'nanmaye-100', brand: 'nanmaye', amount: 100, unit: 'g', package: 'vacuum', carton: 60, shelfMonths: 24, imageCount: 1 },
  { slug: 'nanmaye-450', brand: 'nanmaye', amount: 450, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, imageCount: 1 },
  { slug: 'nanmaye-500', brand: 'nanmaye', amount: 500, unit: 'g', package: 'vacuum', carton: 20, shelfMonths: 24, featured: true, imageCount: 1 },
  { slug: 'nanmaye-5kg', brand: 'nanmaye', amount: 5, unit: 'kg', package: 'vacuum', carton: 2, shelfMonths: 24, imageCount: 1 },
]);

const BRAND_IMAGES = Object.freeze({
  dezmaye: '/assets/products/dezmaye-gold.webp',
  shetab: '/assets/products/shetab.webp',
  xpower: '/assets/products/xpower.webp',
  nanmaye: '/assets/products/nanmaye.webp',
});

/** Ordered, repository-owned WebP gallery produced from the reviewed intake.
 * The first URL is the card/SEO image; numbered files preserve the order the
 * user chose in the sandbox without retaining any multi-megabyte PNG master in
 * the shipped source tree. */
export function catalogProductImageUrls(variant) {
  const count = Number(variant?.imageCount);
  if (!variant?.slug || !Number.isSafeInteger(count) || count < 1) {
    return [BRAND_IMAGES[variant?.brand] || BRAND_IMAGES.dezmaye];
  }
  return Array.from({ length: count }, (_, index) => {
    const suffix = index === 0 ? '' : `-${String(index + 1).padStart(2, '0')}`;
    return `/assets/products/catalog/${variant.slug}${suffix}.webp`;
  });
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const localNumber = (value, locale) => String(value).replace(/\d/g, (digit) => (
  locale === 'fa' ? FA_DIGITS[Number(digit)] : locale === 'ar' ? AR_DIGITS[Number(digit)] : digit
));

const COPY = Object.freeze({
  fa: {
    title: {
      dezmaye: (weight) => `خمیر مایه خشک فوری دزمایه گلد ${weight}`,
      shetab: (weight) => `خمیر مایه خشک فوری شتاب مایه ${weight}`,
      xpower: (weight) => `خمیر مایه خشک فوری ایکس پاور ${weight}`,
      nanmaye: (weight) => `خمیر مایه نان مایه ${weight}`,
    },
    short: {
      dezmaye: 'خمیرمایه خشک فوری دزمایه گلد، تولیدشده با استانداردهای کیفی اروپایی و تکنولوژی پیشرفته فرینگز (Frings) اتریش؛ با فعالیت تخمیری بالا و بدون نیاز به پیش‌تخمیر.',
      shetab: 'خمیرمایه خشک فوری شتاب مایه، فرموله‌شده برای پخت سریع نان‌های صنعتی و فانتزی؛ با سرعت عمل بالا و ایجاد تخلخل یکنواخت در خمیر.',
      xpower: 'خمیرمایه تخصصی ایکس پاور (X-Power) با قدرت تخمیر مضاعف و فعالیت آنزیمی بالا برای انواع نان‌های حجیم، نیمه‌حجیم و شیرینی‌جات.',
      nanmaye: 'خمیرمایه نان مایه برای واحدهای نانوایی صنعتی، نانوایی‌های بزرگ و بازارهای صادراتی؛ اقتصادی، با کیفیت یکنواخت و ماندگاری کنترل‌شده.',
    },
    variantSummary: (weight, pack) => `این مدل در بسته‌بندی ${weight} از نوع ${pack} عرضه می‌شود.`,
    weight: (variant) => `${localNumber(variant.amount, 'fa')} ${variant.unit === 'kg' ? 'کیلوگرم' : 'گرم'}`,
    pack: { vacuum: 'وکیوم', sachet: 'ساشه', bag: 'کیسه' },
    labels: {
      weight: 'وزن خالص', sachetWeight: 'وزن خالص / ساشه', package: 'نوع بسته‌بندی',
      carton: 'تعداد در کارتن', shelf: 'مدت ماندگاری', standards: 'استانداردها و گواهینامه‌ها', applications: 'موارد مصرف',
    },
    packageValue: (variant) => variant.package === 'sachet'
      ? 'ساشه آلومینیومی مقاوم'
      : variant.package === 'bag' ? 'کیسه فله' : `وکیوم آلومینیومی ${localNumber(variant.layers || 3, 'fa')}‌لایه`,
    weightValue: (variant, weight) => variant.package === 'sachet'
      ? `${weight} (ساشه سه‌لایه)`
      : variant.package === 'bag' ? `${weight} (کیسه فله)` : `${weight} (وکیوم فشرده)`,
    cartonValue: (variant) => variant.package === 'sachet'
      ? `${localNumber(variant.carton, 'fa')} ساشه در هر کارتن صادراتی`
      : `${localNumber(variant.carton, 'fa')} عدد در هر کارتن صادراتی`,
    shelfValue: (months) => `${localNumber(months, 'fa')} ماه از تاریخ تولید در جای خشک و خنک`,
    storageShelf: (months) => `ماندگاری در بسته‌بندی اولیه: ${localNumber(months, 'fa')} ماه از تاریخ تولید.`,
    standards: 'ISO 9001:2015 آلمان، گواهی حلال، استاندارد ملی ایران و عضویت VH برلین',
    applications: 'نان بربری، سنگک، تافتون، لواش، باگت، تست و نان‌های حجیم و فانتزی',
  },
  en: {
    title: {
      dezmaye: (weight) => `Dezmaye Gold instant dry yeast — ${weight}`,
      shetab: (weight) => `Shetab Maye instant dry yeast — ${weight}`,
      xpower: (weight) => `X-Power instant dry yeast — ${weight}`,
      nanmaye: (weight) => `Nan Maye instant dry yeast — ${weight}`,
    },
    short: {
      dezmaye: 'Dezmaye Gold instant dry yeast is made to European quality standards with advanced Frings (Austria) technology, delivering high fermentation activity without pre-fermentation.',
      shetab: 'Shetab Maye instant dry yeast is formulated for fast industrial and speciality bread production, with rapid action and an even, open crumb.',
      xpower: 'X-Power is a specialist instant yeast with enhanced fermentation power and high enzymatic activity for volume breads, semi-volume breads and fermented pastries.',
      nanmaye: 'Nan Maye is designed for industrial and high-volume bakeries and export markets, combining economical use with consistent quality and controlled shelf life.',
    },
    variantSummary: (weight, pack) => `This variant is supplied as a ${weight} ${pack.toLowerCase()}.`,
    weight: (variant) => `${variant.amount} ${variant.unit === 'kg' ? 'kg' : 'g'}`,
    pack: { vacuum: 'Vacuum pack', sachet: 'Sachet', bag: 'Bulk sack' },
    labels: {
      weight: 'Net weight', sachetWeight: 'Net weight / sachet', package: 'Packaging type',
      carton: 'Units per carton', shelf: 'Shelf life', standards: 'Standards and certificates', applications: 'Applications',
    },
    packageValue: (variant) => variant.package === 'sachet'
      ? 'Heavy-duty aluminium sachet'
      : variant.package === 'bag' ? 'Bulk sack' : `${variant.layers || 3}-layer aluminium vacuum pack`,
    weightValue: (variant, weight) => variant.package === 'sachet'
      ? `${weight} (three-layer sachet)`
      : variant.package === 'bag' ? `${weight} (bulk sack)` : `${weight} (compressed vacuum pack)`,
    cartonValue: (variant) => `${variant.carton} ${variant.package === 'sachet' ? 'sachets' : 'units'} per export carton`,
    shelfValue: (months) => `${months} months from production when stored cool and dry`,
    storageShelf: (months) => `Shelf life in the original packaging: ${months} months from the production date.`,
    standards: 'ISO 9001:2015 (Germany), Halal certificate, Iranian National Standard and VH Berlin membership',
    applications: 'Barbari, sangak, taftoon, lavash, baguette, toast, volume and speciality breads',
  },
  ar: {
    title: {
      dezmaye: (weight) => `خميرة دزمايه غولد الجافة الفورية — ${weight}`,
      shetab: (weight) => `خميرة شتاب مايه الجافة الفورية — ${weight}`,
      xpower: (weight) => `خميرة إكس باور الجافة الفورية — ${weight}`,
      nanmaye: (weight) => `خميرة نان مايه الجافة الفورية — ${weight}`,
    },
    short: {
      dezmaye: 'تُنتج خميرة دزمايه غولد الجافة الفورية وفق معايير الجودة الأوروبية وبتقنية Frings النمساوية المتقدمة، بنشاط تخميري مرتفع ومن دون حاجة إلى تخمير أولي.',
      shetab: 'صُممت خميرة شتاب مايه الجافة الفورية للإنتاج السريع للأخبزة الصناعية والفاخرة، مع مفعول سريع وبنية مسامية متجانسة.',
      xpower: 'إكس باور خميرة فورية متخصصة بقوة تخمير مضاعفة ونشاط إنزيمي مرتفع للأخبزة الهشة وشبه الهشة والمعجنات المخمّرة.',
      nanmaye: 'صُممت نان مايه للمخابز الصناعية والكبيرة وأسواق التصدير، وتجمع بين الاقتصاد في الاستخدام والجودة المتجانسة والصلاحية المضبوطة.',
    },
    variantSummary: (weight, pack) => `يتوفر هذا المنتج بوزن ${weight} ونوع تعبئة ${pack}.`,
    weight: (variant) => `${localNumber(variant.amount, 'ar')} ${variant.unit === 'kg' ? 'كغ' : 'غرامًا'}`,
    pack: { vacuum: 'عبوة مفرغة', sachet: 'كيس', bag: 'كيس سائب' },
    labels: {
      weight: 'الوزن الصافي', sachetWeight: 'الوزن الصافي / الكيس', package: 'نوع التعبئة',
      carton: 'العدد في الكرتونة', shelf: 'مدة الصلاحية', standards: 'المواصفات والشهادات', applications: 'الاستخدامات',
    },
    packageValue: (variant) => variant.package === 'sachet'
      ? 'كيس ألمنيوم متين'
      : variant.package === 'bag' ? 'كيس سائب' : `عبوة ألمنيوم مفرغة من ${localNumber(variant.layers || 3, 'ar')} طبقات`,
    weightValue: (variant, weight) => variant.package === 'sachet'
      ? `${weight} (كيس من ثلاث طبقات)`
      : variant.package === 'bag' ? `${weight} (كيس سائب)` : `${weight} (عبوة مفرغة مضغوطة)`,
    cartonValue: (variant) => `${localNumber(variant.carton, 'ar')} ${variant.package === 'sachet' ? 'كيسًا' : 'عبوة'} في كل كرتونة تصدير`,
    shelfValue: (months) => `${localNumber(months, 'ar')} شهرًا من تاريخ الإنتاج عند الحفظ في مكان جاف وبارد`,
    storageShelf: (months) => `مدة الصلاحية في العبوة الأصلية: ${localNumber(months, 'ar')} شهرًا من تاريخ الإنتاج.`,
    standards: 'ISO 9001:2015 (ألمانيا)، شهادة الحلال، المواصفة الوطنية الإيرانية وعضوية VH برلين',
    applications: 'خبز البربري والسنغك والتافتون واللواش والباغيت والتوست والأخبزة الهشة والفاخرة',
  },
});

function cloneRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => Array.isArray(row) ? [...row] : row) : [];
}

function localizedStorage(storage, months, copy) {
  const rows = Array.isArray(storage) ? [...storage] : [];
  if (rows.length >= 3) rows[2] = copy.storageShelf(months);
  return rows;
}

export function buildCatalogProducts(locale, shared = {}) {
  const copy = COPY[locale] || COPY.fa;
  return CATALOG_VARIANTS.map((variant) => {
    const weight = copy.weight(variant);
    const images = catalogProductImageUrls(variant);
    const specs = [
      [variant.package === 'sachet' ? copy.labels.sachetWeight : copy.labels.weight, copy.weightValue(variant, weight)],
      [copy.labels.package, copy.packageValue(variant)],
    ];
    if (variant.carton) specs.push([copy.labels.carton, copy.cartonValue(variant)]);
    specs.push(
      [copy.labels.shelf, copy.shelfValue(variant.shelfMonths)],
      [copy.labels.standards, copy.standards],
      [copy.labels.applications, copy.applications],
    );
    return {
      slug: variant.slug,
      brand: variant.brand,
      title: copy.title[variant.brand](weight),
      weight,
      pack: copy.pack[variant.package],
      image: images[0],
      images,
      featured: Boolean(variant.featured),
      short: `${copy.variantSummary(weight, copy.pack[variant.package])} ${copy.short[variant.brand]}`,
      specs,
      usage: Array.isArray(shared.usage) ? [...shared.usage] : [],
      analysis: cloneRows(shared.analysis),
      storage: localizedStorage(shared.storage, variant.shelfMonths, copy),
    };
  });
}

export function buildCatalogProductTranslations(locale, shared = {}) {
  return Object.fromEntries(buildCatalogProducts(locale, shared).map((product) => [
    product.slug,
    {
      title: product.title,
      weight: product.weight,
      pack: product.pack,
      short: product.short,
      specs: product.specs,
      usage: product.usage,
      analysis: product.analysis,
      storage: product.storage,
    },
  ]));
}
