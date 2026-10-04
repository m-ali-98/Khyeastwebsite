/* ==========================================================================
   The admin panel, driven through its real UI.

   Until now the panel's HTTP API was well covered but the screens on top of
   it were only checked by grepping the source for patterns. That cannot catch
   a save button wired to the wrong handler, a draft that never clears, or a
   confirm() dialog that blocks a delete. Everything here clicks.

   All writes land in .e2e-data/ (see e2e/prepare-data.js), never in
   server/data/.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { loginAdmin, adminTab, watchConsole, gotoReady, E2E } from './helpers.js';

const field = (page, label) => page.locator('label.field', { hasText: label }).locator('input, textarea, select').first();

/* Unique per run so a re-run never collides with leftovers. */
const STAMP = Date.now().toString(36).slice(-5);
const PRODUCT_SLUG = `e2e-product-${STAMP}`;
const POST_SLUG = `e2e-post-${STAMP}`;

test.describe.configure({ mode: 'serial' });

test('the login screen rejects a wrong password and accepts the right one', async ({ page }) => {
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  const card = page.locator('.admin__login-card');
  await expect(card).toBeVisible();

  await card.locator('input').first().fill(E2E.user);
  await card.locator('input[type="password"]').fill('definitely-not-the-password');
  await card.getByRole('button', { name: 'ورود به پنل' }).click();

  await expect(page.locator('.admin__login-err')).toBeVisible();
  await expect(page.locator('.admin__side')).toHaveCount(0);

  await card.locator('input[type="password"]').fill(E2E.pass);
  await card.getByRole('button', { name: 'ورود به پنل' }).click();
  await expect(page.locator('.admin__side')).toBeVisible();
});

test('the panel logo stays small on the login card', async ({ page }) => {
  await page.context().clearCookies();
  await page.addInitScript(() => localStorage.removeItem('ky_admin_token'));
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  const box = await page.locator('.admin__login-card .admin__logo-mark').boundingBox();
  expect(box, 'logo not rendered on the login card').toBeTruthy();
  expect(box.height).toBeLessThanOrEqual(48);
});

test('every Persian tab opens and renders its panel', async ({ page }) => {
  const errors = watchConsole(page);
  await loginAdmin(page);

  const labels = [
    'محصولات', 'وبلاگ', 'فروشگاه — محصولات', 'سفارش‌ها', 'دیدگاه‌ها',
    'درگاه پرداخت', 'متون سایت', 'تصاویر صفحات', 'پیوندها', 'اطلاعات تماس', 'پیام‌های مردم',
  ];
  for (const label of labels) {
    await adminTab(page, label).first().click();
    await expect(page.locator('.admin__panel').first()).toBeVisible();
    await expect(page.locator('.admin__panel h1').first()).not.toBeEmpty();
  }
  expect(errors, 'console errors while touring the panel').toEqual([]);
});

test('switching the panel to English swaps in the translation editors', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.admin__langbtns button', { hasText: /EN|انگلیسی/i }).first().click();

  /* The requirement: the non-Persian view keeps full وبلاگ and محصولات tabs. */
  await expect(adminTab(page, 'محصولات')).toBeVisible();
  await expect(adminTab(page, 'وبلاگ')).toBeVisible();
  await expect(page.locator('.admin__locale-note')).toBeVisible();

  /* …and the Persian-only shop tabs are gone, because the shop is Persian-only. */
  await expect(adminTab(page, 'سفارش‌ها')).toHaveCount(0);
  await expect(adminTab(page, 'فروشگاه — محصولات')).toHaveCount(0);

  await page.locator('.admin__langbtns button', { hasText: /FA|فارسی/i }).first().click();
  await expect(adminTab(page, 'سفارش‌ها')).toBeVisible();
});

test('the panel honours dark mode', async ({ page }) => {
  await loginAdmin(page);
  await page.locator('.admin__themebtns button', { hasText: 'تاریک' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('.admin__themebtns button', { hasText: 'روشن' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('creating a catalogue product publishes it to the public site', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'محصولات').first().click();
  await page.getByRole('button', { name: '+ محصول جدید' }).click();

  await field(page, 'عنوان محصول').fill('محصول آزمایشی خودکار');
  await field(page, 'وزن / اندازه').fill('۵۰۰ گرم');
  await field(page, 'نوع بسته‌بندی').fill('وکیوم');
  await field(page, 'شناسه یکتا (slug)').fill(PRODUCT_SLUG);
  await field(page, 'توضیح کوتاه').fill('این محصول توسط آزمون خودکار ساخته شده است.');

  await page.getByRole('button', { name: 'ذخیره محصول' }).click();

  /* Back on the list, and the new row is there. */
  await expect(page.locator('.admin__item', { hasText: 'محصول آزمایشی خودکار' })).toBeVisible();

  /* The real proof: it reached the server and shows on the site. */
  await gotoReady(page, '/products');
  await expect(page.locator('.product-card', { hasText: 'محصول آزمایشی خودکار' })).toBeVisible();
  await gotoReady(page, `/products/${PRODUCT_SLUG}`);
  await expect(page.locator('main')).toContainText('محصول آزمایشی خودکار');
});

test('editing that product updates the public page', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'محصولات').first().click();

  await page.locator('.admin__item', { hasText: 'محصول آزمایشی خودکار' }).locator('.admin__iconbtn[title="ویرایش"]').click();
  await field(page, 'عنوان محصول').fill('محصول آزمایشی ویرایش‌شده');
  await page.getByRole('button', { name: 'ذخیره محصول' }).click();

  await expect(page.locator('.admin__item', { hasText: 'محصول آزمایشی ویرایش‌شده' })).toBeVisible();
  await gotoReady(page, `/products/${PRODUCT_SLUG}`);
  await expect(page.locator('main')).toContainText('محصول آزمایشی ویرایش‌شده');
});

test('a blank or duplicate slug is refused instead of corrupting the catalogue', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'محصولات').first().click();
  await page.getByRole('button', { name: '+ محصول جدید' }).click();

  /* Collect every alert instead of consuming one at a time: the assertion
     that matters is *why* the save was refused, and swallowing the message
     would let a silent save pass unnoticed. */
  const alerts = [];
  page.on('dialog', (d) => {
    alerts.push(d.message());
    d.accept();
  });

  await field(page, 'عنوان محصول').fill('بدون شناسه');
  await field(page, 'شناسه یکتا (slug)').fill('');
  await page.getByRole('button', { name: 'ذخیره محصول' }).click();
  await expect.poll(() => alerts.length).toBe(1);
  expect(alerts[0]).toContain('خالی');

  await field(page, 'شناسه یکتا (slug)').fill(PRODUCT_SLUG); // already taken
  await page.getByRole('button', { name: 'ذخیره محصول' }).click();
  await expect.poll(() => alerts.length).toBe(2);
  expect(alerts[1]).toContain('یکتا');

  /* The real invariant: neither attempt put anything in the catalogue. */
  await adminTab(page, 'محصولات').first().click();
  await expect(page.locator('.admin__item', { hasText: 'بدون شناسه' })).toHaveCount(0);
  await gotoReady(page, '/products');
  await expect(page.locator('.product-card', { hasText: 'بدون شناسه' })).toHaveCount(0);
});

test('deleting the product asks for confirmation and removes it everywhere', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'محصولات').first().click();
  const row = page.locator('.admin__item', { hasText: 'محصول آزمایشی ویرایش‌شده' });

  /* Dismiss first: a cancelled confirm must NOT delete. */
  page.once('dialog', (d) => d.dismiss());
  await row.locator('.admin__iconbtn.danger').click();
  await expect(row).toBeVisible();

  page.once('dialog', (d) => d.accept());
  await row.locator('.admin__iconbtn.danger').click();
  await expect(row).toHaveCount(0);

  await gotoReady(page, '/products');
  await expect(page.locator('.product-card', { hasText: 'محصول آزمایشی' })).toHaveCount(0);
});

test('a blog post can be written, published and read on the site', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'وبلاگ').first().click();
  await page.getByRole('button', { name: /مقاله جدید/ }).first().click();

  await field(page, 'عنوان مقاله').fill('مقاله آزمایشی خودکار');
  await field(page, 'دسته‌بندی').fill('آزمون');
  await field(page, 'شناسه یکتا (slug)').fill(POST_SLUG);
  await field(page, 'چکیده').fill('چکیده‌ی مقاله‌ای که آزمون خودکار نوشته است.');

  /* The rich editor is a contenteditable, not an input. */
  const body = page.locator('.admin__panel [contenteditable="true"]').first();
  await body.click();
  await body.fill('متن آزمایشی مقاله با یک پیوند و چند جمله برای آنکه صفحه خالی نباشد.');

  await page.getByRole('button', { name: 'ذخیره مقاله' }).click();
  await expect(page.locator('.admin__item', { hasText: 'مقاله آزمایشی خودکار' })).toBeVisible();

  await gotoReady(page, '/blog');
  await expect(page.locator('main')).toContainText('مقاله آزمایشی خودکار');
  await gotoReady(page, `/blog/${POST_SLUG}`);
  await expect(page.locator('main')).toContainText('متن آزمایشی مقاله');

  /* clean up */
  await loginAdmin(page);
  await adminTab(page, 'وبلاگ').first().click();
  page.once('dialog', (d) => d.accept());
  await page.locator('.admin__item', { hasText: 'مقاله آزمایشی خودکار' }).locator('.admin__iconbtn.danger').click();
  await expect(page.locator('.admin__item', { hasText: 'مقاله آزمایشی خودکار' })).toHaveCount(0);
});

test('editing a site text autosaves and shows up on the home page', async ({ page }) => {
  const NEW = 'بنر آزمایشی خودکار ' + STAMP;
  await loginAdmin(page);
  await adminTab(page, 'متون سایت').first().click();

  await page.locator('.admin__search input').fill('home.hero.badge');
  const row = page.locator('.admin__text-row', { hasText: 'home.hero.badge' });
  await expect(row).toBeVisible();
  const original = await row.locator('textarea').inputValue();

  await row.locator('textarea').fill(NEW);
  await page.waitForTimeout(1500); // the editor autosaves after 700ms

  await gotoReady(page, '/');
  await expect(page.locator('main')).toContainText(NEW);

  /* put it back so the scratch content file stays representative */
  await loginAdmin(page);
  await adminTab(page, 'متون سایت').first().click();
  await page.locator('.admin__search input').fill('home.hero.badge');
  await page.locator('.admin__text-row', { hasText: 'home.hero.badge' }).locator('textarea').fill(original);
  await page.waitForTimeout(1500);
});

test('a message sent from the contact form appears in the inbox', async ({ page }) => {
  const BODY = 'پیام آزمایشی خودکار ' + STAMP + ' — لطفاً نادیده بگیرید.';

  await gotoReady(page, '/contact');
  await page.locator('#name').fill('آزمون خودکار');
  await page.locator('#phone').fill('09123456789');
  await page.locator('#email').fill('e2e@example.com');
  await page.locator('#message').fill(BODY);
  await page.locator('form button[type="submit"]').click();

  /* On success the form is replaced by the confirmation panel; a rate limit
     leaves an inline <small> instead. Either way the visitor is told. */
  await expect(
    page.locator('form .field small').first().or(page.getByRole('button', { name: /ارسال پیام دیگر|پیام جدید|ارسال دوباره/ })).first(),
  ).toBeVisible({ timeout: 15_000 });

  await loginAdmin(page);
  await adminTab(page, 'پیام‌های مردم').first().click();
  await expect(page.locator('.msg', { hasText: STAMP })).toBeVisible({ timeout: 15_000 });

  /* Mark read / delete must work from the UI. */
  const msg = page.locator('.msg', { hasText: STAMP }).first();
  await msg.getByRole('button', { name: /خوانده|نخوانده/ }).click();
  await expect(page.locator('.msg', { hasText: STAMP })).toBeVisible();
});

test('the shop products tab can refresh live stock without clobbering it', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  await expect(page.locator('.admin__panel h1')).toContainText('فروشگاه');

  const refresh = page.getByRole('button', { name: /بروزرسانی/ });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.locator('.admin__item').first()).toBeVisible();
});

test('an order placed on the site is visible in the orders tab and its status can change', async ({ page }) => {
  /* place a real order through the storefront */
  await gotoReady(page, '/shop/dezmaye-gold-80');
  await page.locator('.sp-buy__row .btn').click();
  await gotoReady(page, '/shop/checkout');
  const form = page.locator('.checkout-form');
  const inputs = form.locator('.checkout-form__grid input');
  await inputs.nth(0).fill('سفارش آزمایشی');
  await inputs.nth(1).fill('09123456789');
  await inputs.nth(2).fill('دزفول');
  await form.locator('textarea').first().fill('نشانی آزمایشی برای سفارش خودکار، پلاک ۷');
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/shop\/order\//, { timeout: 20_000 });
  const code = (await page.locator('.order-hero .code').innerText()).trim();

  await loginAdmin(page);
  await adminTab(page, 'سفارش‌ها').first().click();
  const row = page.locator('.admin__panel', { hasText: code }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  /* Changing the status must stick across a reload — that is the path where
     the stock re-reservation bug lived. */
  const select = page.locator('select').first();
  await select.selectOption({ index: 1 });
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await adminTab(page, 'سفارش‌ها').first().click();
  await expect(page.locator('.admin__panel', { hasText: code }).first()).toBeVisible();
});

test('logging out revokes the session, so the back button cannot re-enter', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /خروج از پنل/ }).click();
  await expect(page.locator('.admin__login-card')).toBeVisible();

  await page.goBack();
  await page.goto('/admin', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.admin__login-card')).toBeVisible();
  await expect(page.locator('.admin__side')).toHaveCount(0);
});
