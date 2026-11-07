# وب‌سایت شرکت خمیرمایه خوزستان

سامانه رسمی چندزبانه شرکت خمیرمایه خوزستان شامل وب‌سایت شرکتی، کاتالوگ محصولات، وبلاگ، فروشگاه فارسی، حساب مشتریان و پنل مدیریت محتوا است. رابط کاربری با React ساخته شده و سرور Node.js محتوا، سفارش‌ها، موجودی، پرداخت، پیامک، حساب‌ها و SEO مسیرمحور را مدیریت می‌کند.

## امکانات اصلی

### وب‌سایت عمومی

- صفحات خانه، درباره ما، محصولات و جزئیات محصول، صادرات، کیفیت، وبلاگ و جزئیات مقاله، تماس و ۴۰۴
- سه زبان فارسی، انگلیسی و عربی با مسیرهای مستقل، RTL/LTR صحیح و فونت‌های محلی
- تم روشن و تاریک؛ نخستین بازدید روشن است و انتخاب کاربر در `localStorage` ذخیره می‌شود
- طراحی واکنش‌گرا از موبایل‌های ۳۲۰ پیکسلی تا نمایشگرهای دسکتاپ
- تصاویر WebP واکنش‌گرا، فونت‌های self-hosted، تقسیم کد بر اساس مسیر و فشرده‌سازی پاسخ‌ها
- حرکت‌های سبک با پشتیبانی از `prefers-reduced-motion`
- محتوای تازه در هر ورود به مسیر؛ بدون cache محتوای سفارشی، prefetch مسیر یا تأخیر نمایشی ساختگی

### مدیریت محتوا

پنل `/admin` عمداً هیچ پیوندی در سایت عمومی ندارد و فقط با واردکردن مستقیم نشانی باز می‌شود. مدیر می‌تواند این موارد را بدون تغییر کد یا استایل مدیریت کند:

- محصولات کاتالوگ و محصولات فروشگاه
- مقالات وبلاگ و محتوای غنی
- متن‌ها، تصاویر، پیوندها، اطلاعات تماس و نمادهای اعتماد
- ترجمه‌های انگلیسی و عربی بر پایه محتوای فارسی
- پیام‌های فرم تماس، دیدگاه‌ها و پاسخ‌ها
- سفارش‌ها، مشتریان، موجودی، پرداخت و پیامک
- تنظیمات محدودیت نرخ و تشخیص IP پشت پراکسی

HTML نوشته‌شده توسط مدیر پیش از ذخیره در سرور پاک‌سازی می‌شود. فایل‌های بارگذاری‌شده به‌جای Buffer حافظه، ابتدا به‌صورت stream در `UPLOAD_DIR/.incoming` نوشته می‌شوند؛ هر process فقط یک upload را هم‌زمان می‌پذیرد، امضای واقعی فایل از روی چند بایت نخست بررسی می‌شود، SVG پذیرفته نمی‌شود و تصاویر، در صورت در دسترس‌بودن Sharp، مستقیماً از فایل staging به WebP و اندازه‌های واکنش‌گرا تبدیل می‌شوند.

### فروشگاه و حساب مشتری

فروشگاه فقط در نسخه فارسی فعال است و شامل این امکانات است:

- فهرست و جزئیات محصول، سبد خرید و تسویه‌حساب
- ثبت‌نام و بازیابی رمز با OTP، ورود با شماره موبایل و رمز عبور
- پروفایل، چند نشانی، نشانی پیش‌فرض و تاریخچه سفارش‌ها
- محاسبه قیمت و هزینه ارسال در سرور
- رزرو اتمیک موجودی و جلوگیری از oversell
- انقضای سفارش پرداخت‌نشده پس از حدود ۳۰ دقیقه و بازگرداندن موجودی
- دیدگاه محصول، تأیید مدیر، پاسخ و قفل دیدگاه‌ها
- پیامک OTP، تأیید سفارش پس از پرداخت و اعلان ارسال از طریق `sms.ir`، همراه با گزارش ارسال
- پرداخت زرین‌پال، استعلام، تراکنش‌های تأییدنشده، reverse و refund

همه مبالغ در دیتابیس و درخواست‌های زرین‌پال با واحد **ریال (`IRR`)** نگهداری می‌شوند.

## فناوری‌ها

| بخش | فناوری |
| --- | --- |
| رابط کاربری | React 19، React Router 7، Vite 8 |
| استایل و حرکت | SCSS، Framer Motion، Vazirmatn، Inter |
| سرور | Node.js، Express 5 |
| داده | SQLite با WAL و تراکنش‌های تو‌در‌تو مبتنی بر savepoint |
| درایور SQLite | `better-sqlite3` در صورت نصب موفق؛ در غیر این صورت `node:sqlite` |
| تصویر | Sharp با fallback امن به فایل اصلی |
| پرداخت | `zarinpal-node-sdk` |
| پیامک | `smsir-js` |
| تست | تست‌رانر پروژه، Playwright و axe-core |

## پیش‌نیازها

- Node.js **22 یا جدیدتر**
- npm
- دیسک ماندگار برای `server/data/` و `server/uploads/`
- Chromium فقط برای اجرای تست‌های Playwright

نسخه Node را بررسی کنید:

```bash
node --version
```

## شروع سریع

```bash
npm install
npm run dev:all
```

سپس این نشانی‌ها در دسترس هستند:

- سایت: `http://localhost:5173`
- API: `http://localhost:8787`
- پنل: `http://localhost:5173/admin`

`npm run dev:all` سرور API و Vite را هم‌زمان اجرا می‌کند. Vite درخواست‌های `/api` و `/uploads` را به پورت ۸۷۸۷ پراکسی می‌کند و با `Ctrl+C` هر دو پردازش متوقف می‌شوند.

### ورود توسعه به پنل

در محیط غیرتولیدی، fallback محلی کد فعلی این است:

```text
username: admin
password: khyeast-1404
```

این مقادیر عمومی‌اند و فقط برای توسعه محلی هستند. سرور با همین اطلاعات در حالت `production` اجرا نمی‌شود.

### اجرای build تولید به‌صورت محلی

```bash
npm run build
npm run server
```

سرور Express در صورت وجود `dist/`، رابط کاربری ساخته‌شده را نیز روی `http://localhost:8787` سرو می‌کند.

## دستورهای npm

| دستور | کاربرد |
| --- | --- |
| `npm run dev:all` | اجرای هم‌زمان API و Vite |
| `npm run dev` | فقط Vite روی پورت ۵۱۷۳ |
| `npm run server` / `npm start` | API و build موجود روی پورت ۸۷۸۷ |
| `npm run build` | build رابط کاربری و تولید HTMLهای SEO، sitemap و robots |
| `npm run seo:generate` | اجرای مستقل مولد SEO روی build موجود |
| `npm run preview` | پیش‌نمایش استاتیک Vite؛ API واقعی ندارد |
| `npm test` | build و اجرای مجموعه تست‌های بدون مرورگر |
| `npm run test:e2e` | اجرای کامل Playwright |
| `npm run test:e2e:update` | به‌روزرسانی baselineهای تصویری؛ فقط پس از بازبینی دستی |
| `npm run test:all` | اجرای هر دو مجموعه تست |

## پیکربندی محیط

نمونه تنظیمات در `.env.example` قرار دارد:

```bash
cp .env.example .env
```

فایل `.env` در Git نادیده گرفته می‌شود و نباید commit شود. سرور ابتدا `server/.env` و سپس `.env` ریشه را می‌خواند؛ متغیرهایی که محیط میزبان از قبل تعیین کرده است اولویت دارند.

### متغیرهای ضروری تولید

| متغیر | توضیح |
| --- | --- |
| `NODE_ENV=production` | فعال‌کردن کنترل‌های سخت‌گیرانه تولید |
| `ADMIN_USER` | نام کاربری پنل |
| `ADMIN_PASS` | رمز پنل، حداقل ۱۲ کاراکتر |
| `ADMIN_SECRET` | کلید امضای نشست، حداقل ۳۲ کاراکتر |
| `PUBLIC_ORIGIN` | origin نهایی، مانند `https://example.com` و بدون `/` انتهایی |

ساخت کلید امن:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

در تولید، سرور در هرکدام از وضعیت‌های زیر عمداً اجرا نمی‌شود:

- رمز یا secret هنوز مقدار توسعه باشد؛
- `ADMIN_PASS` یا `ADMIN_SECRET` کوتاه باشد؛
- نه `PUBLIC_ORIGIN` تنظیم شده باشد و نه `TRUSTED_HOSTS`.

### متغیرهای اختیاری

| متغیر | مقدار پیش‌فرض / کاربرد |
| --- | --- |
| `PORT` | `8787`؛ در cPanel معمولاً خود میزبان تعیین می‌کند |
| `DATA_DIR` | `server/data` |
| `UPLOAD_DIR` | `server/uploads`؛ فایل‌های multipart موقت در زیرپوشهٔ خصوصی `.incoming` همین filesystem قرار می‌گیرند |
| `DB_FILE` | `<DATA_DIR>/khyeast.db` |
| `TRUSTED_HOSTS` | allowlist میزبان‌ها و aliasهای معتبر کنار `PUBLIC_ORIGIN` |
| `TRUST_PROXY` | پیش‌فرض امن: `loopback, linklocal, uniquelocal` |
| `SEO_ORIGIN` | origin مخصوص build استاتیک SEO |
| `GOOGLE_SITE_VERIFICATION` | کد مالکیت Google Search Console |
| `BING_SITE_VERIFICATION` | کد مالکیت Bing Webmaster Tools |
| `RATE_LIMITS_ENABLED` | فعال یا غیرفعال‌کردن اولیه محدودیت‌ها |
| `RL_MAX_*` | override سقف‌های اولیه؛ جزئیات در `.env.example` |

تنظیمات زرین‌پال و sms.ir از داخل پنل مدیریت ذخیره می‌شوند و لازم نیست در `.env` قرار گیرند. secretهای این سرویس‌ها در پاسخ عمومی API نمایش داده نمی‌شوند.

> `TRUST_PROXY=true` فقط وقتی قابل‌قبول است که دسترسی مستقیم به Node کاملاً مسدود باشد. در حالت عادی از مقدار امن پیش‌فرض استفاده کنید و IP و «پروتکل مؤثر» را در تب «امنیت و محدودیت‌ها» بررسی کنید. پراکسی باید `X-Forwarded-Proto: https` را بفرستد. اگر cPanel/Apache این هدر را حذف کند، fallback فقط زمانی HTTPS را نتیجه می‌گیرد که `PUBLIC_ORIGIN` با `https://` تنظیم شده، Host با آن یا `TRUSTED_HOSTS` مطابق باشد و اتصال Node از پراکسی مورد اعتماد برسد.

> **الزام پورت ۸۰:** fallback نمی‌تواند یک درخواست HTTP واقعی را که پراکسی بدون هیچ هدر پروتکلی عبور داده از HTTPS تشخیص دهد. VirtualHost پورت ۸۰ باید پیش از رسیدن درخواست به Node با ۳۰۱/۳۰۸ به HTTPS redirect کند. اگر به هر دلیل `:80` نیز proxy می‌شود، باید صریحاً `X-Forwarded-Proto: http` بفرستد؛ در این حالت Node ورود Admin را با 426 رد می‌کند. حذف هدر روی vhost پورت ۸۰ مجاز نیست.

## مسیرهای عمومی

| فارسی | انگلیسی | عربی |
| --- | --- | --- |
| `/` | `/en` | `/ar` |
| `/about` | `/en/about` | `/ar/about` |
| `/products` | `/en/products` | `/ar/products` |
| `/products/:slug` | `/en/products/:slug` | `/ar/products/:slug` |
| `/export` | `/en/export` | `/ar/export` |
| `/quality` | `/en/quality` | `/ar/quality` |
| `/blog` | `/en/blog` | `/ar/blog` |
| `/blog/:slug` | `/en/blog/:slug` | `/ar/blog/:slug` |
| `/contact` | `/en/contact` | `/ar/contact` |

مسیرهای `/shop/*` فقط در نسخه فارسی وجود دارند. مسیرهای خصوصی مانند `/admin`، ورود، حساب، سبد، پرداخت و پیگیری سفارش با `noindex` سرو می‌شوند.

## معماری محتوا و داده

### منابع داده

| مسیر | محتوا |
| --- | --- |
| `shared/contentDefaults.js` | fallback فقط‌خواندنی و مقدار اولیهٔ نصب واقعاً تازه |
| `shared/i18n/en.js` و `ar.js` | ترجمه‌های منتشرشده همراه کد |
| `server/data/khyeast.db` | ۹ بخش محتوای CMS با revision، فروشگاه، سفارش، موجودی، مشتری، نشست، OTP، پیام، دیدگاه، پرداخت، پیامک و تنظیمات |
| `server/uploads/` | تصاویر و ویدیوهای بارگذاری‌شده مدیر روی storage ماندگار |

فارسی زبان پایه است. ترجمه‌های انگلیسی و عربی ابتدا از فایل‌های پروژه و سپس از overrideهای CMS روی آن قرار می‌گیرند؛ فیلد ترجمه خالی باعث حذف محتوا نمی‌شود و به مقدار قبلی fallback می‌کند.

`/api/content` با `no-store` پاسخ می‌دهد. در هر ناوبری، محتوای تازه و chunk واقعی مسیر باید آماده شوند؛ تنها در صورت انتظار واقعی، نشانگر بارگذاری نمایش داده می‌شود.

محتوای قابل‌ویرایش دیگر فایل tracked نیست. Git فقط کد، ترجمه و defaultهای immutable را نگه می‌دارد؛ بنابراین ذخیرهٔ Admin با `git pull` تعارض نمی‌سازد. در نخستین اجرای نسخهٔ جدید، `DATA_DIR/content.json` قدیمیِ معتبر در یک تراکنش به ۹ بخش SQLite وارد می‌شود. پس از تکمیل migration عملیاتی، همان ورودی به `content.json.legacy-imported-*` تغییرنام می‌دهد تا حذف احتمالی دیتابیس هرگز snapshot قدیمی را بی‌صدا دوباره وارد نکند. این archive فقط مدرک migration است و authority جاری نیست.

### SQLite

- مهاجرت جدول‌ها هنگام راه‌اندازی به‌صورت خودکار انجام می‌شود.
- حالت WAL، foreign key، busy timeout و تراکنش استفاده می‌شود.
- fallback مبتنی بر `node:sqlite` برای تراکنش‌های تو‌در‌تو از savepoint واقعی استفاده می‌کند و writeهای CMS با `BEGIN IMMEDIATE` بین workerها سری می‌شوند.
- `content_meta` یک revision سراسری و `content_sections` revision هر بخش را نگه می‌دارند. PATCH فقط row همان بخش را تغییر می‌دهد و cache هر worker با revision به‌همراه `PRAGMA data_version` باطل می‌شود.
- ذخیرهٔ هم‌زمان محتوای CMS، محصول/نمایش فروشگاه و referenceهای upload در یک مرز تراکنشی انجام می‌شود؛ stock عملیاتی همچنان فقط از endpoint مقایسه‌و‌تعویض تغییر می‌کند.
- جدول `order_payments` همه authorityهای صادرشده را نگه می‌دارد؛ کلید اصلی authority اتصال آن به بیش از یک سفارش را در سطح دیتابیس ناممکن می‌کند.
- جدول `rate_limit_hits` شمارنده‌های کوتاه‌عمر و reservationهای در حال اجرا را بین همه workerهای Passenger مشترک می‌کند؛ شناسه bucket با `ADMIN_SECRET` و HMAC-SHA-256 کلیدگذاری می‌شود تا IP یا موبایل کم‌دامنه از روی snapshot دیتابیس قابل brute-force نباشد.
- `orders.pay_authority` فقط اشاره‌گر تلاش جاری یا تلاش تسویه‌شده است و تاریخچه پرداخت را جایگزین نمی‌کند.
- فایل‌های قدیمی `content.json`، `shop.json` و `messages.json` در صورت وجود فقط یک‌بار و با guard وارد SQLite می‌شوند؛ ورودی محتوای خراب دست‌نخورده می‌ماند و startup آن را با default جایگزین نمی‌کند.

## پرداخت و موجودی

مسیر پول به‌صورت fail-closed طراحی شده است:

1. خطوط تکراری سبد بر اساس slug ادغام می‌شوند.
2. قیمت، هزینه ارسال و مبلغ کل فقط در سرور محاسبه می‌شود.
3. محصول فعال با قیمت صفر یا مبلغ کل نامعتبر به درگاه نمی‌رسد.
4. رزرو موجودی و درج سفارش در یک تراکنش انجام می‌شود.
5. هر authority تازه پیش از ارسال URL درگاه، به‌صورت یکتا در ledger همان سفارش ثبت می‌شود؛ retry تلاش‌های قبلی را حذف نمی‌کند.
6. `Authority` callback با همه تلاش‌های همان سفارش و با مقایسه ثابت‌زمان سنجیده می‌شود؛ limiter اختصاصی فقط پس از یافتن این نگاشت معتبر فعال می‌شود تا probeها سهم callback واقعی را مصرف نکنند. refresh تلاش تسویه‌شده بدون تماس دوباره با درگاه و بدون مصرف سهم limiter مستقیماً به صفحه موفق هدایت می‌شود.
7. authority و `ref_id` جدا ذخیره می‌شوند؛ استعلام، reverse و تطبیق callback همیشه authority را می‌گیرند.
8. کد ۱۰۱ زرین‌پال فقط برای authority ثبت‌شده همان سفارش موفقِ idempotent است.
9. هر تلاش معتبرِ قبلی می‌تواند سفارش pending را اتمیک تسویه کند؛ authority همان تلاش به اشاره‌گر تسویه‌شده تبدیل می‌شود.
10. اگر دو تلاش واقعاً پرداخت شوند، فقط یک worker می‌تواند reverse تلاش دوم را claim کند. claim متوقف‌شده پس از ۱۵ دقیقه قابل‌بازیابی است و Admin برای هر تلاش یک اقدام reverse مستقل دارد.
11. سفارشی که حتی یک authority آنلاینِ صادرشده دارد حذف نمی‌شود؛ لینک هنوز ممکن است پرداخت شود و callback باید نگاشت سفارش را پیدا کند. Admin می‌تواند چنین سفارش‌هایی را بدون حذف تاریخچه بایگانی و بعداً بازیابی کند؛ هشدار مالی حل‌نشده قابل پنهان‌کردن نیست و پرداخت دیرهنگام سفارش را خودکار از بایگانی خارج می‌کند.

اگر سفارش پرداخت‌نشده منقضی شود، موجودی آزاد می‌شود. پرداخت دیرهنگام فقط در صورت رزرو دوباره موجودی پذیرفته می‌شود؛ در غیر این صورت reverse خودکار انجام می‌شود و شکست یا قطع آن سفارش را با پرچم «نیازمند رسیدگی» در بالای پنل نگه می‌دارد.

### reverse و refund

- **Reverse:** بازگرداندن پرداخت در پنجره کوتاه زرین‌پال با authority
- **Refund:** استرداد بعدی با Access Token، Terminal ID و session id تراکنش

لغو مالی موفق، وضعیت سفارش و موجودی را نیز هماهنگ می‌کند.

### نکته ارتقا از نسخه قدیمی

مهاجرت، authority جاری هر سفارش را به `order_payments` منتقل می‌کند. authorityهایی که نسخه قدیمی پیش از این با retry بازنویسی کرده یا در سفارش پرداخت‌شده با `ref_id` جایگزین کرده است از داده محلی قابل بازسازی نیستند؛ چنین تراکنش‌های قدیمی باید با ledger زرین‌پال به‌صورت دستی تطبیق داده شوند.

## حساب و پیامک

- رمز مشتری با `scrypt` و salt تصادفی هش می‌شود؛ مسیرهای HTTP از نسخه asynchronous مبتنی بر worker pool استفاده می‌کنند تا event loop متوقف نشود.
- نشست مشتری فقط به‌صورت hash در SQLite ذخیره می‌شود.
- OTP پنج‌رقمی، کوتاه‌عمر، محدود به تعداد تلاش و وابسته به شماره و purpose است.
- شماره‌های نامعتبر برای یک flow نیز placeholder OTP دریافت می‌کنند تا پاسخ دوم، وجود حساب را آشکار نکند.
- مسیر login برای شماره ناشناخته یک مقایسه واقعی با dummy hash انجام می‌دهد تا اختلاف زمانی، مشتری‌بودن شماره را فاش نکند.
- login و ثبت‌نام پیش از شروع scrypt ظرفیت limiter را رزرو می‌کنند؛ درخواست‌های هم‌زمان نمی‌توانند همگی پیش از ثبت نتیجه از سقف عبور کنند.
- ارسال OTP از پاسخ HTTP جداست تا زمان پاسخ سرویس پیامک نیز oracle تشخیص حساب نباشد.
- حالت پیش‌فرض SMS، `log` است؛ پیام واقعی ارسال نمی‌شود اما مسیر کامل در گزارش ثبت می‌شود.
- پیام «سفارش ثبت شد» هنگام ایجاد سفارش پرداخت‌نشده ارسال نمی‌شود؛ برای پرداخت آنلاین پس از verification موفق درگاه و برای سفارش آفلاین فقط هنگام نخستین تأیید Admin که `paidAt` را ثبت می‌کند ارسال می‌شود.
- خطای سرویس پیامک هرگز سفارش پرداخت‌شده را rollback نمی‌کند.

## امنیت

موارد کلیدی پیاده‌سازی‌شده:

- نشست Admin در تولید روی کوکی `__Host-ky_admin` با `HttpOnly`، `Secure`، `SameSite=Strict` و `Path=/`
- توسعه روی HTTP از نام جداگانه `ky_admin_dev` استفاده می‌کند؛ login تولید روی HTTP با پاسخ 426 رد می‌شود و امنیت کوکی تولید تضعیف نمی‌شود.
- ابطال واقعی نشست Admin هنگام logout و امکان logout-all
- کنترل Origin برای تغییرات احراز‌شده با کوکی
- مقایسه ثابت‌زمان برای tokenها و authority پرداخت
- محدودیت نرخ SQLite-مشترک بین همه processها برای تماس، دیدگاه، سفارش، retry و callback پرداخت، ورود، OTP و ثبت‌نام؛ bucketها با HMAC سروری ذخیره می‌شوند و بدون `ADMIN_SECRET` قابل dictionary lookup نیستند
- تنظیم صحیح `trust proxy` برای جلوگیری از جعل `X-Forwarded-For` و تشخیص امن پروتکل پشت پراکسی
- پاک‌سازی سمت سرور برای محتوای غنی با allowlist برچسب و بازسازی lowercase ویژگی‌ها از صفر
- حذف کامل commentهای HTML، رد URLهای protocol-relative/backslash-confused و سقف صریح حجم، تعداد node و عمق با پیمایش غیرrecursive
- عبور از سقف sanitizer یا خطای parser، save را با پاسخ 400 و پیام روشن رد می‌کند؛ محتوای قبلی دست‌نخورده می‌ماند.
- بررسی magic number فایل، نام‌گذاری مجدد سمت سرور و CSP محدود برای uploads
- کوئری‌های پارامتری SQLite
- CSP، HSTS روی HTTPS تولید، `nosniff`، جلوگیری از iframe و سیاست‌های مرورگر
- حذف stack trace و مسیر فایل از پاسخ خطا
- عدم نمایش credentialهای پرداخت و پیامک در API

غیرفعال‌کردن محدودیت نرخ از پنل برای عیب‌یابی ممکن است، اما در تولید باید کوتاه‌مدت و آگاهانه باشد. bucket اشباع‌شده با مسیر read-only رد می‌شود و برای هر پاسخ 429 قفل write نمی‌گیرد؛ بااین‌حال پذیرش درخواست تازه ناگزیر یک تراکنش کوتاه SQLite دارد. در برابر flood حجمی، latency و `SQLITE_BUSY` را مانیتور و محدودیت لبه‌ی Apache/CDN/WAF را خط دفاع اول قرار دهید.

## SEO، دسترس‌پذیری و کارایی

### SEO

`npm run build` علاوه بر bundle، برای مسیرهای عمومی HTML قابل‌خزش تولید می‌کند. سرور Node نیز HTML هر درخواست را با آخرین محتوای CMS بازنویسی می‌کند.

خروجی شامل این موارد است:

- title و description مسیرمحور
- canonical و `hreflang` برای فارسی، انگلیسی، عربی و `x-default`
- Open Graph و Twitter Card
- JSON-LD برای سازمان، وب‌سایت، breadcrumb، محصول و مقاله
- `sitemap.xml` و `robots.txt`
- ۳۰۱ برای مسیرهای قدیمی و URLهای غیر canonical
- HTTP 404 واقعی و noindex برای مسیرهای ناموجود
- noindex برای صفحات مدیریتی، حساب و تراکنش

### دسترس‌پذیری

- کنترل کامل با صفحه‌کلید و focus قابل‌مشاهده
- نام دسترس‌پذیر برای کنترل‌های آیکنی
- ساختار heading و landmark معتبر
- کنتراست بررسی‌شده در هر دو تم
- رعایت `prefers-reduced-motion`
- تست axe روی صفحات عمومی، حساب و پنل

### کارایی

- lazy loading مسیرها بدون prefetch سفارشی
- responsive image و WebP
- بهینه‌سازی خودکار uploadها با fallback
- chunkهای جدا برای React، Router، Motion و vendorها
- gzip/deflate در Express و Apache
- cache طولانی برای assetهای hashدار و `no-cache` برای HTML
- فونت‌های محلی و preload فونت فارسی buildشده

## تست

### تست‌های اصلی

```bash
npm test
```

این دستور ابتدا build تولید را می‌سازد و سپس routeها، محتوای خراب، sanitizer، پرداخت، پیامک، احراز هویت، hardening، theme، loading، assetها، SEO، upload، حساب‌ها، موجودی و رفتار API را بررسی می‌کند.

### Playwright

نصب مرورگر در نخستین اجرا:

```bash
npx playwright install chromium
```

اجرای کامل:

```bash
npm run test:e2e
```

اجرای مجموعه‌های عملکردی بدون visual regression:

```bash
npx playwright test \
  e2e/public.spec.js \
  e2e/admin.spec.js \
  e2e/account.spec.js \
  e2e/a11y.spec.js \
  e2e/seo.spec.js
```

Playwright پیش از اجرا، داده‌ای جدا در `.e2e-data/` می‌سازد؛ تست‌ها به `server/data/` واقعی دست نمی‌زنند.

Baselineهای تصویری فعلی platform-specific هستند. `npm run test:e2e:update` را فقط روی پلتفرم baseline، پس از مشاهده diffها و با تصمیم آگاهانه اجرا کنید؛ baseline جدید نباید صرفاً برای سبزکردن تست پذیرفته شود.

## ساختار پروژه

```text
├── public/                 assetهای عمومی و تنظیمات Apache
├── assets-src/             فایل‌های اصلی تصویر، خارج از build عمومی
├── shared/                 محتوا، ترجمه، SEO و منطق مشترک client/server
├── src/
│   ├── pages/              صفحات عمومی، فروشگاه و حساب
│   ├── components/         اجزای مشترک و Layout
│   ├── admin/              پنل مدیریت
│   ├── content/            دریافت و ذخیره محتوا
│   ├── i18n/               locale، جهت و theme
│   ├── shop/               state و اجزای فروشگاه
│   └── styles/             استایل عمومی، صفحات داخلی و فروشگاه
├── server/
│   ├── index.js            Express، CMS، upload و SEO runtime
│   ├── gracefulShutdown.js drain محدود requestها هنگام SIGTERM
│   ├── db.js               schema، migration، revision و عملیات SQLite
│   ├── shop.js             سفارش، موجودی، Admin فروشگاه و callback پرداخت
│   ├── accountRoutes.js    حساب مشتری، OTP و نشانی‌ها
│   ├── payment.js          اتصال زرین‌پال
│   ├── sms.js              اتصال sms.ir
│   └── data/               دیتابیس محلی runtime (ignored؛ نه محتوای tracked)
├── scripts/                build SEO، purge قرنطینه، پردازش تصویر و تست‌ها
├── ops/                    backup معتبر، replication append-only، maintenance و retry پرداخت
├── e2e/                    Playwright، axe و visual regression
├── vite.config.js
└── playwright.config.js
```

## استقرار

### حالت پیشنهادی: Node.js کامل

برای CMS، فرم تماس، حساب، فروشگاه، موجودی، پرداخت و پیامک باید برنامه Node اجرا شود.

1. Node.js 22 یا جدیدتر را روی میزبان انتخاب کنید.
2. پروژه را خارج از document root عمومی قرار دهید.
3. `npm ci`، تست‌ها و سپس `npm run build` را در release جدا اجرا کنید.
4. متغیرهای تولید را مطابق `.env.example` تنظیم کنید.
5. startup file را `server/index.js` قرار دهید.
6. `DATA_DIR`/`DB_FILE` و `UPLOAD_DIR` را روی دیسک ماندگار و بیرون checkout هر release نگه دارید؛ Git نباید فایل mutable را deploy یا merge کند.
7. پیش از نخستین ارتقا از نسخهٔ JSON، backup شامل `content.json` قدیمی، SQLite و uploads را جداگانه تأیید کنید.
8. برنامه را restart کنید و پس از health، persisted بودن `/api/content` و ایجاد `content.json.legacy-imported-*` را بررسی کنید.

در cPanel/Passenger، `PORT` را معمولاً نباید دستی تنظیم کرد؛ میزبان آن را تزریق می‌کند. پس از استقرار این نشانی‌ها را بررسی کنید:

```text
/api/health
/sitemap.xml
/robots.txt
/admin
```

HTTPS برای کوکی `__Host-` پنل تولید ضروری است و login تولید عمداً روی HTTP انجام نمی‌شود. fallback بدون `Secure` فقط با نام جداگانه در محیط development فعال است. `PUBLIC_ORIGIN` باید دقیقاً origin نهایی HTTPS باشد و Apache/Passenger ترجیحاً هدر `X-Forwarded-Proto: https` را به Node برساند. اگر میزبان این هدر را نمی‌فرستد، fallback محافظت‌شده‌ی `PUBLIC_ORIGIN` فقط از یک peer مورد اعتماد و Host مطابق فعال می‌شود.

**پیش از launch روی میزبان واقعی:** یک‌بار از نشانی HTTPS وارد `/admin` شوید، سپس در تب «امنیت و محدودیت‌ها» بررسی کنید «پروتکل مؤثر» برابر `https` است، منبع تشخیص درست نمایش داده می‌شود و `req.ip` همان IP واقعی بازدیدکننده است؛ این آزمون را با curl مستقیم به Node جایگزین نکنید.

### حالت استاتیک محدود

می‌توان محتوای `dist/` را روی Apache منتشر کرد؛ `.htaccess` ساخته‌شده routeهای SEO و 404 واقعی را مدیریت می‌کند. در این حالت فقط محتوای پیش‌فرض buildشده در دسترس است و قابلیت‌های وابسته به API کار نمی‌کنند:

- پنل مدیریت
- ذخیره فرم تماس
- حساب مشتری
- ثبت سفارش، موجودی، پرداخت و پیامک
- upload و انتشار زنده محتوای CMS

برای استفاده واقعی از پروژه، حالت Node.js توصیه می‌شود.

## پشتیبان‌گیری، قرنطینه و ارتقا

دادهٔ عملیاتی شامل snapshot معتبر **کل SQLite** و فایل‌های زندهٔ `UPLOAD_DIR` است؛ `content.json` بخشی از backup format 2 نیست. برای SQLite فعال در حالت WAL فایل دیتابیس زنده را با `cp` یا `tar` کپی نکنید؛ از API دستور `.backup` استفاده کنید. نمونهٔ production در `ops/backup-khyeast` ابتدا فضای آزاد لازم را بررسی می‌کند و بدون توقف Node snapshot آنلاین می‌گیرد. اگر systemd تأیید کند `khyeast.service` متوقف است، فایل پایدار SQLite (و در توقف ناپاک مجموعهٔ WAL) ابتدا به staging قابل‌نوشتن کپی و همان‌جا یکپارچه و اعتبارسنجی می‌شود؛ بنابراین sandbox فقط‌خواندنی backup اضطراری را خراب نمی‌کند. هر snapshot باید `integrity_check`، `foreign_key_check`، وجود و نوع هر ۹ بخش CMS و برابری revision پیش/داخل/پس از snapshot را بگذراند. دو گذر upload یک superset محافظه‌کار می‌سازند و فقط staging ثابت archive می‌شود. manifest format 2 شامل checksum دیتابیس و revision محتواست. exit code یا هشدار ناقص `tar`/`rsync` نباید موفق تلقی شود. پس از ساخت archive معتبر، پنجرهٔ محلی به‌طور پیش‌فرض ۱۴ روز است (`LOCAL_RETENTION_DAYS`)؛ retention و verification مخزن offsite باید مستقل باشد.

پوشه‌های زیر عمداً در backup محلی و offsite قرار نمی‌گیرند:

```text
UPLOAD_DIR/.quarantine/  # recycle bin محلی
UPLOAD_DIR/.incoming/    # بدنهٔ موقت و هنوز منتشرنشدهٔ multipart
```

ویدیو و تصویرِ بدون بهینه‌سازی پس از موفقیت با rename اتمیک از `.incoming` منتشر می‌شوند؛ Sharp تصویر بهینه را مستقیماً از staging می‌خواند و master را پس از variantها می‌نویسد. پاسخ upload فقط پس از پاک‌شدن staging و آزادشدن slot تک‌پردازشی ارسال می‌شود، بنابراین انتخاب چند عکسِ پشت‌سرهم پاسخ 503 کاذب نمی‌گیرد. فایل موقت در همهٔ مسیرهای خطا پاک می‌شود و باقی‌ماندهٔ crash قدیمی‌تر از ۲۴ ساعت نیز هنگام startup و سپس هر ساعت purge می‌شود. قرنطینه recycle bin محلی ۳۰روزه است، نه دادهٔ production یا disaster recovery؛ بنابراین خرابی کامل دیسک، فایل‌های قرنطینه‌شده را نیز از بین می‌برد. این حذف عمدی مانع نگهداری نامحدود فایل‌های حذف‌شده در backupها می‌شود. `npm run uploads:purge-quarantine` فقط batchهای timestampدارِ منقضی را پاک می‌کند و باید روزانه با timer مستقل systemd (templateهای `ops/systemd/`) یا cron میزبان اجرا شود. نام‌های ناشناخته دست‌نخورده باقی می‌مانند.

پیش از نخستین استفاده از «فایل‌های استفاده‌نشده» در پنل یک backup تأییدشده بگیرید. فایل انتخاب‌شده فوراً حذف نمی‌شود؛ از مسیر عمومی به `.quarantine/` منتقل می‌شود، ساختار `images/` یا `videos/` و manifest بازیابی را نگه می‌دارد و حداقل ۳۰ روز قابل بازگردانی است. برای بازیابی، پیش از پایان این مهلت فایل را با همان نام به زیرپوشهٔ اصلی برگردانید و مالکیت service account را حفظ کنید.

اگر metadata یا یکی از ۹ بخش محتوای SQLite گم، خراب یا از نوع نادرست باشد، public GET برای در دسترس‌ماندن سایت defaultهای بسته را با header برابر `X-Khyeast-Content-Status: fallback` نشان می‌دهد؛ اما همهٔ ذخیره‌های محتوایی Admin، ذخیرهٔ مستقیم محصول/نمایش فروشگاه و عملیات حذف upload با `503 content-unavailable` متوقف می‌شوند. startup و ذخیرهٔ عادی هرگز defaultها را روی state established ثبت نمی‌کنند. سرویس را متوقف، دیتابیس و sidecarهای خراب را برای بررسی نگه‌داری، و **کل** `khyeast.db` تأییدشده را از یک archive format 2 بازیابی کنید؛ sectionها را از backupهای متفاوت ترکیب نکنید. سپس ownership را اصلاح، سرویس را اجرا و `integrity_check`، health، header `persisted`، سفارش‌های pending و reconciliation پرداخت را بررسی کنید.

هنگام انتشار نسخهٔ جدید:

1. backup آنلاین معتبر و نسخهٔ offsite رمزگذاری‌شده را تأیید کنید.
2. نسخهٔ جدید را در یک release directory جداگانه `npm ci`، test و build کنید؛ روی checkout در حال اجرا `npm ci` نزنید.
3. symlink نسخه را اتمیک جابه‌جا کنید و فقط در لحظهٔ cutover سرویس را restart کنید.
4. `server/data/` و `server/uploads/` را جایگزین یا پاک نکنید؛ state تولید باید بیرون checkout باشد.
5. SIGTERM ابتدا پذیرش request جدید را می‌بندد و تا ۹۰ ثانیه به callbackهای فعال فرصت پایان می‌دهد؛ unit تولید باید `TimeoutStopSec=120s` داشته باشد.
6. برای مسیر دقیق callback زرین‌پال، صفحهٔ 503 موجود در `ops/payment-callback-unavailable.html` را در Nginx فعال کنید تا قطع کوتاه proxy یا timeout قابل‌تکرارِ verification همان authority را حداکثر شش بار خودکار دوباره بررسی کند و سپس با اقدام دستی متوقف شود؛ مشتری نباید دوباره پرداخت کند. درخواست‌های SDK حداکثر ۲۰ ثانیه منتظر می‌مانند.
7. health، ورود Admin، header محتوای `persisted` و یک callback تکراری پرداخت را بررسی کنید. در ارتقای نخست، archive ورودی legacy را نیز ثبت کنید.
8. rollback کد به‌تنهایی schema/state را برنمی‌گرداند؛ پیش از rollback ناسازگار، سرویس را متوقف و snapshot کامل SQLite همان نقطه را بازیابی کنید. archive `legacy-imported` را به‌عنوان محتوای زنده کپی نکنید.

جزئیات نصب timerها، backup آنلاین/متوقف، restore و انتشار اتمیک در `docs/Khyeast-Linux-Deployment-Guide.pdf` آمده است. archive محلی به‌تنهایی backup کامل نیست. `ops/replicate-khyeast-restic` روی VPS فقط checksum محلی را دوباره بررسی و snapshot جدید را اضافه می‌کند. Restic upstream گزینهٔ سراسری `--no-lock` را برای `backup` می‌پذیرد ولی اجرا نمی‌کند ([issue #1544](https://github.com/restic/restic/issues/1544))؛ backup همچنان lock می‌سازد و در پایان حذف می‌کند. بنابراین endpoint محدود باید حذف history را منع کند ولی فقط حذف `locks/*` را مجاز بداند (مانند `rest-server --append-only`). اگر provider چنین scopeی ندارد، credential آن را مستقیم به Restic ندهید و یک endpoint واقعاً append-only سازگار با lock جلوی آن قرار دهید. پیش از production، همان credential محدود را یک بار روی مخزن disposable آزمایش کنید: backup عادی باید همراه cleanup lock موفق و `forget` باید ناموفق باشد؛ سپس با credential کامل ماشین نگهداری تأیید کنید snapshot آزمایشی هنوز وجود دارد، قابل restore است و lock باقیمانده‌ای ندارد. `RESTIC_APPEND_ONLY=true` و تست mock جای این آزمون provider-side را نمی‌گیرند. `restic check` و retention فقط با `ops/maintain-khyeast-restic` و credential کامل روی یک ماشین مورداعتماد جدا اجرا می‌شوند. URL و credentialهای VPS فقط در `/etc/khyeast/restic.env` می‌مانند و credential نگهداری هرگز روی VPS قرار نمی‌گیرد. یک restore واقعی را تمرین کنید.

## مجوز

این مخزن مطابق فیلد `license` در `package.json` با مجوز **ISC** منتشر شده است.
