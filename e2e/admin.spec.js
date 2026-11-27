/* ==========================================================================
   The admin panel, driven through its real UI.

   Until now the panel's HTTP API was well covered but the screens on top of
   it were only checked by grepping the source for patterns. That cannot catch
   a save button wired to the wrong handler, a draft that never clears, or a
   confirm() dialog that blocks a delete. Everything here clicks.

   All writes land in .e2e-data/ (see e2e/prepare-data.js), never in
   server/data/.
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { CONTENT_REVISION_HEADER } from '../shared/contentRevision.js';
import { loginAdmin, adminTab, openAdminTab, watchConsole, gotoReady, routeSettled, one, E2E, signUpCustomer, addAddress, uniquePhone, faNum } from './helpers.js';

const revisionHeaders = (response) => ({
  [CONTENT_REVISION_HEADER]: response.headers()[CONTENT_REVISION_HEADER.toLowerCase()],
});
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

  expect(await page.evaluate(() => localStorage.getItem('ky_admin_token'))).toBeNull();
  const session = (await page.context().cookies()).find((cookie) => cookie.name === 'ky_admin_dev');
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(false);
  expect(session?.path).toBe('/');
  expect(session?.sameSite).toBe('Strict');
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
    'درگاه پرداخت', 'مشتریان', 'پیامک', 'امنیت و محدودیت‌ها', 'گالری', 'متون سایت',
    'تصاویر صفحات', 'پیوندها', 'نمادهای اعتماد', 'اطلاعات تماس', 'نمایندگان فروش', 'پیام‌های مردم',
  ];
  for (const label of labels) {
    await adminTab(page, label).first().click();
    await expect(page.locator('.admin__panel').first()).toBeVisible();
    await expect(page.locator('.admin__panel h1').first()).not.toBeEmpty();
  }
  expect(errors, 'console errors while touring the panel').toEqual([]);
});

test('sales representatives can be added in Admin, located in Gorgan, published and removed', async ({ page }) => {
  const original = await (await page.request.get('/api/content')).json();
  const name = `نماینده آزمایشی گرگان ${STAMP}`;
  await loginAdmin(page);

  try {
    await adminTab(page, 'نمایندگان فروش').first().click();
    const manager = page.getByTestId('admin-sales-representatives');
    await expect(manager).toBeVisible();
    await manager.getByRole('button', { name: 'افزودن نماینده' }).click();

    const editor = manager.locator('.admin-reps__editor');
    await editor.locator('label', { hasText: 'استان' }).locator('select').selectOption('گلستان');
    await editor.locator('label', { hasText: 'شهر' }).locator('input').fill('گرگان');
    await editor.locator('label', { hasText: 'نام شخص یا شرکت' }).locator('input').fill(name);
    await editor.locator('label', { hasText: 'شماره تماس' }).locator('input').fill('09111234567');
    await editor.locator('label', { hasText: 'برندهای تحت پوشش' }).locator('input').fill('دزمایه');
    await editor.getByRole('button', { name: 'ثبت در پیش‌نویس' }).click();

    const published = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await manager.getByRole('button', { name: 'ذخیره و انتشار' }).click();
    expect((await published).status()).toBe(200);

    await gotoReady(page, '/sales-representatives');
    await expect(page.locator('.sales-reps__card', { hasText: name })).toBeVisible();
    const marker = page.getByRole('button', { name: /گرگان، استان گلستان/ });
    await expect(marker).toHaveCount(1);
    // Keyboard activation avoids overlapping SVG hit targets while exercising
    // the map's accessible selection behavior, not just marker rendering.
    await marker.focus();
    await marker.press('Enter');
    await expect(marker).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sales-reps__card', { hasText: name })).toBeVisible();

    await loginAdmin(page);
    await openAdminTab(page, 'نمایندگان فروش');
    const restoredManager = page.getByTestId('admin-sales-representatives');
    await restoredManager.locator('.admin-reps__filters input').fill(name);
    const row = restoredManager.locator('.admin-reps__row', { hasText: name });
    await expect(row).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: `حذف ${name}` }).click();
    const removed = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await restoredManager.getByRole('button', { name: 'ذخیره و انتشار' }).click();
    expect((await removed).status()).toBe(200);
    const after = await (await page.request.get('/api/content')).json();
    expect(after.collections.salesRepresentatives.some((item) => item.name === name)).toBe(false);
  } finally {
    const latest = await page.request.get('/api/content');
    await page.request.patch('/api/content', {
      headers: revisionHeaders(latest),
      data: { changes: { collections: original.collections } },
    });
  }
});

test('controlled CMS fields coalesce keystrokes into one bucket-only patch', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'پیوندها').first().click();
  const input = page.locator('.admin__text-row input').first();
  const original = await input.inputValue();
  const patches = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/content' && request.method() === 'PATCH') {
      patches.push(request.postDataJSON());
    }
  });

  try {
    const saved = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await input.fill(`${original}?autosave=`);
    await input.pressSequentially('coalesced', { delay: 25 });
    await expect(input).toHaveValue(`${original}?autosave=coalesced`);
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    expect(savedResponse.request().headers()[CONTENT_REVISION_HEADER.toLowerCase()]).toMatch(/^[1-9]\d*$/);
    await page.waitForTimeout(850);

    expect(patches).toHaveLength(1);
    expect(Object.keys(patches[0]?.changes || {})).toEqual(['links']);
    expect(patches[0].changes.links).toBeTruthy();
  } finally {
    const restored = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await input.fill(original);
    expect((await restored).status()).toBe(200);
  }
});

test('gallery manager publishes ordered media and locale-specific modal copy', async ({ page }) => {
  const original = await (await page.request.get('/api/content')).json();
  await loginAdmin(page);

  try {
    await adminTab(page, 'گالری').first().click();
    const manager = page.getByTestId('admin-gallery-manager');
    await expect(manager).toBeVisible();
    const initialCount = await manager.getByTestId('admin-gallery-item').count();

    await manager.getByRole('button', { name: 'افزودن ویدئو' }).click();
    const videoDraft = manager.getByTestId('admin-gallery-item').last();
    await expect(videoDraft.getByText('تصویر کاور ویدئو')).toBeVisible();
    await expect(videoDraft.getByRole('button', { name: 'بارگذاری کاور' })).toBeVisible();
    await videoDraft.getByRole('button', { name: 'حذف رسانه' }).click();

    await manager.getByRole('button', { name: 'افزودن تصویر' }).click();
    const item = manager.getByTestId('admin-gallery-item').last();
    const source = item.locator('.admin-gallery__field', { hasText: 'نشانی تصویر' }).locator('input[dir="ltr"]');
    const caption = item.locator('.admin-gallery__field', { hasText: 'عنوان روی کارت' }).locator('input');
    const description = item.locator('.admin-gallery__field', { hasText: 'متن زیر رسانه' }).locator('textarea');
    await source.fill('https://untrusted.example/gallery.jpg');
    await caption.fill('قاب تازه کارخانه');
    await description.fill('متن تکمیلی فارسی برای پنجره بزرگ گالری.');
    await manager.getByRole('button', { name: 'ذخیره و انتشار گالری' }).click();
    await expect(manager.locator('.admin-gallery__notice.is-error')).toContainText('نشانی رسانه معتبر نیست');

    await source.fill('/assets/img/factory.webp');
    await item.getByRole('button', { name: 'انتقال به بالا' }).click();
    const saveResponse = page.waitForResponse((response) => response.url().endsWith('/api/content') && response.request().method() === 'PATCH');
    await manager.getByRole('button', { name: 'ذخیره و انتشار گالری' }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(manager.locator('.admin-gallery__notice.is-success')).toBeVisible();
    await expect(manager.getByTestId('admin-gallery-item')).toHaveCount(initialCount + 1);
    const saved = await (await page.request.get('/api/content')).json();
    expect(saved.gallery[initialCount - 1].caption).toBe('قاب تازه کارخانه');

    await gotoReady(page, '/gallery');
    const published = page.locator('.gallery-card', { hasText: 'قاب تازه کارخانه' });
    await expect(published).toBeVisible();
    await published.click();
    await expect(page.getByRole('dialog')).toContainText('متن تکمیلی فارسی برای پنجره بزرگ گالری.');
    await page.keyboard.press('Escape');

    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.admin__side')).toBeVisible();
    await adminTab(page, 'گالری').first().click();
    await page.locator('.admin__langbtns').getByRole('button', { name: 'English' }).click();
    const translations = page.getByTestId('admin-gallery-translations');
    await expect(translations).toBeVisible();
    const translatedItem = translations.locator('.admin-gallery__translation', { hasText: 'قاب تازه کارخانه' });
    await translatedItem.locator('input').fill('A new view of the factory');
    await translatedItem.locator('textarea').fill('Additional English copy shown beneath the enlarged gallery image.');
    const transResponse = page.waitForResponse((response) => response.url().endsWith('/api/content') && response.request().method() === 'PATCH');
    await translations.getByRole('button', { name: 'ذخیره ترجمه‌های گالری' }).click();
    expect((await transResponse).status()).toBe(200);
    await expect(translations.locator('.admin-gallery__notice.is-success')).toBeVisible();

    await gotoReady(page, '/en/gallery');
    const englishCard = page.locator('.gallery-card', { hasText: 'A new view of the factory' });
    await expect(englishCard).toBeVisible();
    await englishCard.click();
    await expect(page.getByRole('dialog')).toContainText('Additional English copy shown beneath the enlarged gallery image.');
  } finally {
    const latest = await page.request.get('/api/content');
    const restore = await page.request.put('/api/content', {
      headers: revisionHeaders(latest),
      data: original,
    });
    expect(restore.status(), 'gallery test restored the original content snapshot').toBe(200);
  }
});

test('fallback content makes only content-authoring tabs read-only', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'one viewport is enough for the recovery-state contract');
  const persisted = await (await page.request.get('/api/content')).json();
  await page.route('**/api/content', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Khyeast-Content-Status': 'fallback',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify(persisted),
      });
    }
    return route.fulfill({
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      body: JSON.stringify({ error: 'persisted content is unavailable', code: 'content-unavailable' }),
    });
  });

  await loginAdmin(page);
  await expect(page.getByText(/محتوای SQLite گم‌شده، خراب، ناقص یا بدون شناسه نسخه معتبر است/)).toBeVisible();
  const boundary = page.locator('.admin__content-boundary');
  await expect(boundary).toHaveAttribute('disabled', '');
  await expect(boundary).toHaveAttribute('inert', '');
  await expect(boundary.locator('button').first()).toBeDisabled();

  await adminTab(page, 'سفارش‌ها').click();
  await expect(boundary).not.toHaveAttribute('disabled', '');
  await expect(boundary).not.toHaveAttribute('inert', '');
});

test('Google tag settings validate, save, disable, and survive reopening', async ({ page }) => {
  await loginAdmin(page);
  const original = (await (await page.request.get('/api/admin/google-tag')).json()).id;
  try {
    await adminTab(page, 'تگ گوگل').click();
    const panel = page.getByTestId('admin-google-tag');
    const field = panel.getByLabel('شناسه کانتینر');
    await expect(field).toHaveValue(original);
    await field.fill('G-8V5VTCJC5S');
    await panel.getByRole('button', { name: 'ذخیره تگ گوگل' }).click();
    await expect(panel.getByRole('alert')).toBeVisible();
    await field.fill('GTM-TEST123');
    await panel.getByRole('button', { name: 'ذخیره تگ گوگل' }).click();
    await expect(panel.getByRole('status')).toBeVisible();
    await adminTab(page, 'امنیت و محدودیت‌ها').click();
    await adminTab(page, 'تگ گوگل').click();
    await expect(field).toHaveValue('GTM-TEST123');
    await field.fill('');
    await panel.getByRole('button', { name: 'ذخیره تگ گوگل' }).click();
    await expect(panel.getByRole('status')).toBeVisible();
    expect((await (await page.request.get('/api/admin/google-tag')).json()).id).toBe('');
  } finally {
    await page.request.put('/api/admin/google-tag', { data: { id: original } });
  }
});

test('security settings show the effective IP and can disable all rate limits', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'امنیت و محدودیت‌ها').click();

  const panel = page.getByTestId('admin-security');
  await expect(panel.getByRole('heading', { name: 'تشخیص IP، پروتکل و پراکسی' })).toBeVisible();
  await expect(panel).toContainText('req.ip');
  await expect(panel).toContainText('X-Forwarded-Proto');
  await expect(panel).toContainText('پروتکل مؤثر');
  await expect(panel).toContainText('بین همه workerهای Passenger مشترک‌اند');
  await expect(panel).toContainText('loopback');

  const toggle = panel.getByRole('checkbox');
  const originallyEnabled = await toggle.isChecked();
  if (originallyEnabled) await toggle.uncheck();
  await panel.getByRole('button', { name: 'ذخیره تنظیمات امنیتی' }).click();
  await expect(panel.getByText('تنظیمات محدودیت درخواست‌ها ذخیره شد.')).toBeVisible();
  await expect(toggle).not.toBeChecked();

  /* Do not leave the shared E2E server unprotected for later specs. */
  if (originallyEnabled) {
    await toggle.check();
    await panel.getByRole('button', { name: 'ذخیره تنظیمات امنیتی' }).click();
    await expect(panel.getByText('تنظیمات محدودیت درخواست‌ها ذخیره شد.')).toBeVisible();
    await expect(toggle).toBeChecked();
  }
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

  /* Hidden locale-specific destinations must not leak back through Cmd+K. */
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: /دسترسی سریع/ });
  await expect(palette.getByRole('option', { name: /محصولات/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /سفارش‌ها/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

  await adminTab(page, 'وبلاگ').click();
  await page.getByRole('button', { name: 'ویرایش ترجمه' }).first().click();
  const translatedEditor = page.getByRole('region', { name: 'ویرایشگر متن مقاله انگلیسی' });
  await expect(translatedEditor).toBeVisible();
  await expect(translatedEditor.getByRole('textbox')).toHaveCSS('direction', 'ltr');
  await page.getByRole('button', { name: 'بازگشت به فهرست' }).last().click();

  await page.locator('.admin__langbtns button', { hasText: /FA|فارسی/i }).first().click();
  await expect(adminTab(page, 'سفارش‌ها')).toBeVisible();
});

test('shipment SMS is the only optional order-status notification and has its own template field', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'پیامک').click();

  await field(page, 'سرویس پیامک').selectOption('smsir');
  await expect(page.getByText('ارسال پیامک «سفارش ثبت شد» همراه لینک پیگیری، فقط پس از پرداخت موفق')).toBeVisible();
  await expect(field(page, 'شناسه قالب ثبت سفارش پس از پرداخت موفق')).toBeVisible();
  const templateId = field(page, 'شناسه قالب «سفارش ارسال شد»');
  await expect(templateId).toBeVisible();
  await expect(templateId).toHaveValue('');
  await expect(page.getByText('ارسال یک پیامک دیگر فقط وقتی وضعیت سفارش به «ارسال‌شده» تغییر می‌کند')).toBeVisible();
  await expect(page.getByText(/تغییر وضعیت سفارش \(پرداخت‌شده/)).toHaveCount(0);
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

test('Cmd/Ctrl+K filters commands, supports arrows and restores focus', async ({ page }) => {
  await loginAdmin(page);
  const trigger = page.getByRole('button', { name: /دسترسی سریع/ });
  await trigger.focus();
  await page.keyboard.press('Control+K');

  const dialog = page.getByRole('dialog', { name: /دسترسی سریع/ });
  const search = dialog.getByRole('combobox', { name: 'جست‌وجوی دستورات' });
  await expect(dialog).toBeVisible();
  await expect(search).toBeFocused();
  await expect(search).toHaveAttribute('aria-activedescendant', 'admin-command-products');

  await page.keyboard.press('ArrowDown');
  await expect(search).toHaveAttribute('aria-activedescendant', 'admin-command-posts');
  await search.fill('مشتریان');
  await expect(dialog.getByRole('option', { name: /مشتریان/ })).toBeVisible();
  await expect(search).toHaveAttribute('aria-activedescendant', 'admin-command-customers');
  await page.keyboard.press('Enter');
  await expect(page.locator('.admin__panel h1').first()).toHaveText('مشتریان');
  await expect(dialog).toHaveCount(0);

  await trigger.focus();
  await page.keyboard.press('Control+K');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('catalogue products can be searched, filtered and sorted in Admin', async ({ page }) => {
  const content = await (await page.request.get('/api/content')).json();
  const products = content.products;
  const sample = products[0];
  expect(sample, 'the seeded catalogue contains products').toBeTruthy();

  await loginAdmin(page);
  await adminTab(page, 'محصولات').first().click();
  const rows = page.locator('.admin-products__item');
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی محصولات' });
  await expect(rows).toHaveCount(products.length);

  await search.fill(sample.slug);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(sample.title);

  const latinWeight = sample.weight
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
  await search.fill(latinWeight);
  await expect(rows.filter({ hasText: sample.title })).toHaveCount(1);

  await search.fill('');
  const brandCount = products.filter((product) => product.brand === sample.brand).length;
  await page.getByLabel('فیلتر برند محصولات').selectOption(sample.brand);
  await expect(rows).toHaveCount(brandCount);
  await page.getByLabel('فیلتر برند محصولات').selectOption('');

  const featuredCount = products.filter((product) => product.featured).length;
  await page.getByLabel('فیلتر وضعیت محصولات').selectOption('featured');
  await expect(rows).toHaveCount(featuredCount);
  await page.getByLabel('فیلتر وضعیت محصولات').selectOption('all');

  await page.getByLabel('مرتب‌سازی محصولات').selectOption('title');
  const renderedTitles = await rows.locator('.admin-products__title-line b').allTextContents();
  expect(renderedTitles).toEqual([...renderedTitles].sort((left, right) => left.localeCompare(right, 'fa')));

  await search.fill('khyeast-no-such-product-987654');
  await expect(page.locator('.admin-products__empty')).toBeVisible();
  await expect(rows).toHaveCount(0);
  await page.getByRole('button', { name: 'پاک‌کردن جست‌وجو و فیلترها' }).first().click();
  await expect(rows).toHaveCount(products.length);

  await page.getByRole('button', { name: 'جمع‌کردن' }).click();
  await expect(page.locator('#admin-products-brand-list')).toBeHidden();
  await page.getByRole('button', { name: 'نمایش برندها' }).click();
  await expect(page.locator('#admin-products-brand-list')).toBeVisible();
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

  /* One multi-select uses the existing per-photo optimiser for every file. */
  const galleryEditor = page.locator('.admin-product-gallery');
  await galleryEditor.locator('input[type="file"][multiple]').setInputFiles([
    'public/assets/brand/favicon-32.png',
    'public/assets/brand/favicon-64.png',
  ]);
  await expect(galleryEditor).toContainText('۲ تصویر بارگذاری شد.');
  await expect(galleryEditor.locator('.admin-product-gallery__item')).toHaveCount(3);
  const chosenPrimary = await galleryEditor.locator('.admin-product-gallery__item').last().locator('img').getAttribute('src');
  await galleryEditor.getByRole('button', { name: 'انتخاب به‌عنوان اصلی' }).last().click();
  await expect(galleryEditor.locator('.admin-product-gallery__item').first().locator('img')).toHaveAttribute('src', chosenPrimary);

  await page.getByRole('button', { name: 'ذخیره محصول' }).click();

  /* Back on the list, and the new row is there. */
  await expect(page.locator('.admin__item', { hasText: 'محصول آزمایشی خودکار' })).toBeVisible();

  /* The real proof: it reached the server and shows on the site. */
  await gotoReady(page, '/products');
  const publicCard = page.locator('.product-card', { hasText: 'محصول آزمایشی خودکار' });
  await expect(publicCard).toBeVisible();
  await expect(publicCard.locator('img')).toHaveAttribute('src', chosenPrimary);
  await gotoReady(page, `/products/${PRODUCT_SLUG}`);
  await expect(page.locator('main')).toContainText('محصول آزمایشی خودکار');
  const publicGallery = page.locator('.product-gallery');
  await expect(publicGallery.locator('.product-gallery__thumb')).toHaveCount(3);
  await expect(publicGallery.locator('.product-gallery__main')).toHaveAttribute('src', chosenPrimary);
  const otherImage = await publicGallery.locator('.product-gallery__thumb').last().locator('img').getAttribute('src');
  await publicGallery.locator('.product-gallery__thumb').last().click();
  await expect(publicGallery.locator('.product-gallery__main')).toHaveAttribute('src', otherImage);
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

test('Admin brand changes flow through homepage, catalogue filters and the shop', async ({ page }) => {
  const originalResponse = await page.request.get('/api/content');
  const original = await originalResponse.json();
  const shopProduct = original.shop.products.find((product) => product.active && !product.productSlug)
    || original.shop.products.find((product) => product.active);
  expect(shopProduct, 'an active shop product to exercise its brand filter').toBeTruthy();
  const brandId = `e2e-brand-${STAMP}`;
  const brandFa = `برند آزمایشی ${STAMP}`;
  const brandEn = `E2E Brand ${STAMP}`;

  try {
    await loginAdmin(page);
    await adminTab(page, 'محصولات').first().click();
    await page.getByRole('button', { name: '+ برند جدید' }).click();
    await field(page, 'شناسه یکتا (slug)').fill(brandId);
    await field(page, 'نام فارسی').fill(brandFa);
    await field(page, 'نام انگلیسی').fill(brandEn);
    await field(page, 'نشانی تصویر').fill('/assets/products/dezmaye-gold.webp');

    const created = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'ذخیره برند' }).click();
    expect((await created).status()).toBe(200);
    await expect(page.locator('.admin__item', { hasText: brandFa })).toBeVisible();

    /* Seed one locale override, then reload so the removal flow must clean a
       real persisted translation rather than only an empty editor snapshot. */
    const beforeTranslation = await page.request.get('/api/content');
    const translatedState = await beforeTranslation.json();
    const i18n = structuredClone(translatedState.i18n || {});
    i18n.en = {
      ...(i18n.en || {}),
      brands: {
        ...(i18n.en?.brands || {}),
        [brandId]: { fa: brandEn, tagline: 'Managed brand translation' },
      },
    };
    const translationSaved = await page.request.patch('/api/content', {
      headers: revisionHeaders(beforeTranslation),
      data: { changes: { i18n } },
    });
    expect(translationSaved.status()).toBe(200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.admin__side')).toBeVisible();
    await expect(page.locator('.admin__item', { hasText: brandFa })).toBeVisible();

    await gotoReady(page, '/products');
    await expect(page.locator('.products-filter').getByRole('button', { name: `${brandFa} (${brandEn})`, exact: true })).toBeVisible();
    await gotoReady(page, '/');
    const homeStats = page.locator('.stats-band .stat');
    const brandStat = homeStats.nth(2);
    await brandStat.scrollIntoViewIfNeeded();
    await expect(brandStat.locator('.stat__value')).toHaveText(faNum(original.brands.length + 1));
    const brandGrid = page.locator('.brands-grid');
    await expect(brandGrid.locator('.brand-card')).toHaveCount(original.brands.length + 1);
    const lastRowCenterError = await brandGrid.evaluate((grid) => {
      const cards = [...grid.querySelectorAll(':scope > .brand-card')];
      const gridRect = grid.getBoundingClientRect();
      const rects = cards.map((card) => card.getBoundingClientRect());
      const lastRowTop = Math.max(...rects.map((rect) => rect.top));
      const lastRow = rects.filter((rect) => Math.abs(rect.top - lastRowTop) < 1);
      const lastRowLeft = Math.min(...lastRow.map((rect) => rect.left));
      const lastRowRight = Math.max(...lastRow.map((rect) => rect.right));
      return Math.abs((lastRowLeft + lastRowRight - gridRect.left - gridRect.right) / 2);
    });
    expect(lastRowCenterError, 'the incomplete brand row should be centered').toBeLessThan(2);

    /* The shop's brand selector and public brand filter consume this same
       managed list. Move a shop-only SKU temporarily to the new brand. */
    await loginAdmin(page);
    await adminTab(page, 'فروشگاه — محصولات').first().click();
    const shopRow = page.locator('.admin__item', { hasText: shopProduct.title });
    await shopRow.locator('.admin__iconbtn[title="ویرایش"]').click();
    await field(page, 'برند').selectOption(brandId);
    const shopBrandSaved = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'ذخیره محصول', exact: true }).click();
    expect((await shopBrandSaved).status()).toBe(200);

    await gotoReady(page, '/shop');
    const shopBrandFilter = page.locator('.shop-filter').getByRole('button', { name: brandFa, exact: true });
    await expect(shopBrandFilter).toBeVisible();
    await shopBrandFilter.click();
    await expect(page.locator('.shop-grid .shop-card', { hasText: shopProduct.title })).toBeVisible();

    /* Existing catalogue/shop references block removal both in Admin and at
       the API boundary. Once the shop SKU is moved back, deletion is enabled. */
    await loginAdmin(page);
    await adminTab(page, 'محصولات').first().click();
    const deleteBrand = page.getByRole('button', { name: `حذف برند ${brandFa}` });
    await expect(deleteBrand).toBeDisabled();

    await adminTab(page, 'فروشگاه — محصولات').first().click();
    const editedShopRow = page.locator('.admin__item', { hasText: shopProduct.title });
    await editedShopRow.locator('.admin__iconbtn[title="ویرایش"]').click();
    await field(page, 'برند').selectOption(shopProduct.brand);
    const shopBrandRestored = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await page.getByRole('button', { name: 'ذخیره محصول', exact: true }).click();
    expect((await shopBrandRestored).status()).toBe(200);

    await gotoReady(page, '/shop');
    await expect(page.locator('.shop-filter').getByRole('button', { name: brandFa, exact: true })).toHaveCount(0);
    await loginAdmin(page);
    await adminTab(page, 'محصولات').first().click();
    await expect(deleteBrand).toBeEnabled();
    page.once('dialog', (dialog) => dialog.accept());
    const removed = page.waitForResponse((response) => (
      response.url().endsWith('/api/content') && response.request().method() === 'PATCH'
    ));
    await deleteBrand.click();
    expect((await removed).status()).toBe(200);

    const afterRemoval = await (await page.request.get('/api/content')).json();
    expect(afterRemoval.brands.some((brand) => brand.id === brandId)).toBe(false);
    expect(afterRemoval.i18n?.en?.brands?.[brandId]).toBeUndefined();
    await gotoReady(page, '/products');
    await expect(page.locator('.products-filter').getByRole('button', { name: `${brandFa} (${brandEn})`, exact: true })).toHaveCount(0);
    await gotoReady(page, '/');
    const finalBrandStat = page.locator('.stats-band .stat').nth(2);
    await finalBrandStat.scrollIntoViewIfNeeded();
    await expect(finalBrandStat.locator('.stat__value')).toHaveText(faNum(original.brands.length));
  } finally {
    const latest = await page.request.get('/api/content');
    const restore = await page.request.put('/api/content', {
      headers: revisionHeaders(latest),
      data: original,
    });
    expect(restore.status(), 'brand test restored the original content snapshot').toBe(200);
  }
});

test('article editor toolbar stays available while scrolling @mobile', async ({ page }) => {
  await loginAdmin(page);
  await openAdminTab(page, 'وبلاگ');
  await page.getByRole('button', { name: /مقاله جدید/ }).first().click();

  const editor = page.getByRole('region', { name: 'ویرایشگر متن مقاله' });
  const area = editor.getByRole('textbox', { name: 'ویرایشگر متن مقاله' });
  const toolbar = editor.getByRole('toolbar');
  await area.fill(Array.from({ length: 120 }, (_, i) => `خط مقاله شماره ${i}`).join('\n'));
  await area.evaluate((element) => {
    const target = element.getBoundingClientRect().top + window.scrollY + 1000;
    window.scrollTo(0, target);
  });
  await expect.poll(async () => toolbar.evaluate((element) => {
    const mobileBar = document.querySelector('.admin__mobilebar');
    const mobileBottom = mobileBar && getComputedStyle(mobileBar).display !== 'none'
      ? mobileBar.getBoundingClientRect().bottom : 0;
    return Math.abs(element.getBoundingClientRect().top - mobileBottom);
  })).toBeLessThanOrEqual(2);
  await editor.getByRole('button', { name: 'افزودن تصویر' }).click();
  await expect(page.getByRole('dialog', { name: 'افزودن تصویر' })).toBeVisible();
  // The article's start remains above the viewport while the dialog opens.
  expect(await editor.evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(-100);
  await page.getByRole('button', { name: 'بستن پنجره' }).click();

  await editor.getByRole('button', { name: 'ویرایش تمام‌صفحه' }).click();
  await expect(editor).toHaveClass(/is-fullscreen/);
  await editor.locator('.rte__canvas').evaluate((element) => { element.scrollTop = 500; });
  await expect(editor.getByRole('button', { name: 'افزودن ویدیو' })).toBeVisible();
  await editor.getByRole('button', { name: 'افزودن ویدیو' }).click();
  await expect(page.getByRole('dialog', { name: 'افزودن ویدیو' })).toBeVisible();
});

test('the article editor formats safe rich content without exposing code controls', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'وبلاگ').first().click();
  await page.getByRole('button', { name: /مقاله جدید/ }).first().click();

  const editor = page.getByRole('region', { name: 'ویرایشگر متن مقاله' });
  const area = editor.getByRole('textbox', { name: 'ویرایشگر متن مقاله' });
  const selectAllEditorText = () => area.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await expect(editor).toBeVisible();
  await expect(area).toHaveAttribute('data-placeholder', /متن مقاله/);
  await expect(editor.getByRole('button', { name: /واگرد/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: /از نو/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: /زیرخط/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: /پاک‌کردن قالب‌بندی/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'نقل‌قول' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'فهرست نقطه‌ای' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'فهرست شماره‌ای' })).toBeVisible();
  await expect(editor.getByRole('button', { name: /افزودن تصویر/ })).toBeVisible();
  await expect(editor.getByLabel('رنگ متن')).toBeVisible();
  await expect(editor.getByLabel('رنگ متن').locator('option')).toHaveCount(7);
  await expect(editor.getByRole('button', { name: 'افزودن یا ویرایش جدول' })).toBeVisible();
  await expect(editor.getByRole('button', { name: /پیش‌نمایش امن/ })).toBeVisible();
  await expect(editor.getByRole('button', { name: /کد|HTML/i })).toHaveCount(0);

  await area.fill('متن پیوند آزمایشی');
  await expect(editor.locator('.rte__stats')).toContainText('۳ واژه');

  await selectAllEditorText();
  await editor.getByRole('button', { name: /درشت/ }).click();
  await expect(area.locator('b,strong')).toHaveText('متن پیوند آزمایشی');
  await selectAllEditorText();
  await editor.getByRole('button', { name: /کج/ }).click();
  await selectAllEditorText();
  await editor.getByRole('button', { name: /زیرخط/ }).click();
  await expect(area.locator('i,em')).toHaveCount(1);
  await expect(area.locator('u')).toHaveCount(1);
  await selectAllEditorText();
  await editor.getByRole('button', { name: /پاک‌کردن قالب‌بندی/ }).click();
  await expect(area.locator('b,strong,i,em,u,span[style]')).toHaveCount(0);

  await selectAllEditorText();
  const quoteButton = editor.getByRole('button', { name: 'نقل‌قول' });
  await quoteButton.click();
  await expect(area.locator('blockquote')).toHaveText('متن پیوند آزمایشی');
  await expect(quoteButton).toHaveAttribute('aria-pressed', 'true');
  await quoteButton.click();
  await expect(area.locator('blockquote')).toHaveCount(0);

  await selectAllEditorText();
  await editor.getByLabel('نوع پاراگراف').selectOption('h2');
  await expect(area.locator('h2')).toContainText('متن پیوند آزمایشی');

  await area.locator('h2').evaluate((heading) => {
    const range = document.createRange();
    range.selectNodeContents(heading);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Control+K');
  const linkDialog = page.getByRole('dialog', { name: 'افزودن پیوند' });
  await expect(page.locator('.admin-command')).toHaveCount(0);
  await expect(linkDialog.getByLabel('متن پیوند')).toHaveValue('متن پیوند آزمایشی');
  await linkDialog.getByLabel('نشانی پیوند').fill('/blog');
  await linkDialog.getByLabel(/عنوان راهنما/).fill('رفتن به وبلاگ');
  await linkDialog.getByRole('button', { name: 'افزودن پیوند' }).click();
  await expect(area.locator('a[href="/blog"]')).toHaveText('متن پیوند آزمایشی');
  await expect(area.locator('a')).toHaveAttribute('title', 'رفتن به وبلاگ');

  await area.locator('a').evaluate((link) => {
    const range = document.createRange();
    range.selectNodeContents(link);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await editor.getByRole('button', { name: /افزودن یا ویرایش پیوند/ }).click();
  const editLinkDialog = page.getByRole('dialog', { name: 'ویرایش پیوند' });
  await editLinkDialog.getByLabel('نشانی پیوند').fill('/products');
  await editLinkDialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
  await expect(area.locator('a')).toHaveAttribute('href', '/products');

  await area.locator('a').evaluate((link) => {
    const range = document.createRange();
    range.selectNodeContents(link);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await editor.getByRole('button', { name: 'حذف پیوند' }).click();
  await expect(area.locator('a')).toHaveCount(0);
  await editor.getByRole('button', { name: /واگرد/ }).click();
  await expect(area.locator('a')).toHaveAttribute('href', '/products');
  await editor.getByRole('button', { name: /از نو/ }).click();
  await expect(area.locator('a')).toHaveCount(0);
  await editor.getByRole('button', { name: /واگرد/ }).click();
  await expect(area.locator('a')).toHaveAttribute('href', '/products');

  await editor.getByRole('button', { name: 'افزودن تصویر' }).click();
  const imageDialog = page.getByRole('dialog', { name: 'افزودن تصویر' });
  await imageDialog.getByLabel('نشانی تصویر').fill('/assets/img/bread-slicing-480.webp');
  await imageDialog.getByLabel('متن جایگزین تصویر').fill('برش‌های نان تازه');
  await imageDialog.getByLabel(/زیرنویس/).fill('نمونه زیرنویس تصویر');
  await imageDialog.getByRole('button', { name: 'افزودن به متن' }).click();
  await expect(area.locator('figure img')).toHaveAttribute('alt', 'برش‌های نان تازه');
  await expect(area.locator('figcaption')).toHaveText('نمونه زیرنویس تصویر');

  await area.locator('figure img').dblclick();
  const editImageDialog = page.getByRole('dialog', { name: 'ویرایش تصویر' });
  await expect(editImageDialog.getByLabel('متن جایگزین تصویر')).toHaveValue('برش‌های نان تازه');
  await editImageDialog.getByLabel(/زیرنویس/).fill('زیرنویس ویرایش‌شده');
  await editImageDialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
  await expect(area.locator('figcaption')).toHaveText('زیرنویس ویرایش‌شده');

  /* Provider embeds are mocked locally; the editor must store only the
     canonical player URL and let the iframe be edited like other media. */
  for (const host of ['www.youtube-nocookie.com', 'player.vimeo.com']) {
    await page.route(`https://${host}/**`, (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><title>mock video</title></html>',
    }));
  }
  await editor.getByRole('button', { name: 'افزودن ویدیو' }).click();
  const videoDialog = page.getByRole('dialog', { name: 'افزودن ویدیو' });
  const youtubePlayer = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
  await videoDialog.getByLabel('نشانی ویدیو').fill('https://youtu.be/dQw4w9WgXcQ?si=editor-test');
  await expect(videoDialog.locator('iframe')).toHaveAttribute('src', youtubePlayer);
  await videoDialog.getByLabel(/زیرنویس/).fill('ویدیوی آزمایشی');
  await videoDialog.getByRole('button', { name: 'افزودن به متن' }).click();
  const embeddedVideo = area.locator('figure iframe').last();
  await expect(embeddedVideo).toHaveAttribute('src', youtubePlayer);
  await expect(embeddedVideo).toHaveAttribute('loading', 'lazy');
  await expect(embeddedVideo).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await expect(area.locator('figure figcaption').last()).toHaveText('ویدیوی آزمایشی');

  await embeddedVideo.evaluate((frame) => frame.dispatchEvent(new MouseEvent('dblclick', {
    bubbles: true,
    cancelable: true,
    view: window,
  })));
  const editVideoDialog = page.getByRole('dialog', { name: 'ویرایش ویدیو' });
  await expect(editVideoDialog.getByLabel('نشانی ویدیو')).toHaveValue(youtubePlayer);
  await editVideoDialog.getByLabel('نشانی ویدیو').fill('https://vimeo.com/123456789/AbCdEf1234');
  await editVideoDialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
  await expect(area.locator('figure iframe').last()).toHaveAttribute(
    'src',
    'https://player.vimeo.com/video/123456789?h=AbCdEf1234',
  );

  /* The upload path and a pasted direct MP4 URL keep using <video>. */
  await editor.getByRole('button', { name: 'افزودن ویدیو' }).click();
  const uploadVideoDialog = page.getByRole('dialog', { name: 'افزودن ویدیو' });
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(64, 7)]);
  await uploadVideoDialog.locator('input[type="file"]').setInputFiles({
    name: 'editor-upload.mp4',
    mimeType: 'video/mp4',
    buffer: mp4,
  });
  const directVideoUrl = uploadVideoDialog.getByLabel('نشانی ویدیو');
  await expect(directVideoUrl).toHaveValue(/\/uploads\/videos\/[A-Za-z0-9_.-]+\.mp4$/);
  const uploadedVideoUrl = await directVideoUrl.inputValue();
  await uploadVideoDialog.getByRole('button', { name: 'افزودن به متن' }).click();
  await expect(area.locator('video[src]').last()).toHaveAttribute('src', uploadedVideoUrl);

  await editor.getByRole('button', { name: 'افزودن ویدیو' }).click();
  const directVideoDialog = page.getByRole('dialog', { name: 'افزودن ویدیو' });
  await directVideoDialog.getByLabel('نشانی ویدیو').fill(uploadedVideoUrl);
  await directVideoDialog.getByRole('button', { name: 'افزودن به متن' }).click();
  await expect(area.locator('video[src]').last()).toHaveAttribute('src', uploadedVideoUrl);

  /* Uploading is asynchronous; the original caret must still be used after
     the server returns the optimized asset URL. */
  await editor.getByRole('button', { name: 'افزودن تصویر' }).click();
  const uploadDialog = page.getByRole('dialog', { name: 'افزودن تصویر' });
  await uploadDialog.locator('input[type="file"]').setInputFiles('public/assets/brand/favicon-32.png');
  await expect(uploadDialog.getByLabel('نشانی تصویر')).toHaveValue(/\/uploads\//);
  await uploadDialog.getByLabel('متن جایگزین تصویر').fill('نشان بارگذاری‌شده');
  await uploadDialog.getByRole('button', { name: 'افزودن به متن' }).click();
  await expect(area.locator('img[alt="نشان بارگذاری‌شده"]')).toHaveAttribute('src', /\/uploads\//);

  await area.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const data = new DataTransfer();
    data.setData('text/html', '<p style="color:red" onclick="alert(1)">متن پاک <u>زیرخط</u><script>alert(1)</script></p>');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  expect(await area.locator('script,[onclick],[style]').evaluateAll((nodes) => nodes.map((node) => node.outerHTML))).toEqual([]);
  await expect(area.locator('u')).toHaveText('زیرخط');
  await expect(editor).toContainText('قالب‌بندی ناسازگار هنگام چسباندن پاک شد.');

  /* Text colours are finite semantic tokens, not author-controlled CSS. */
  await area.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !text.data.includes('متن پاک')) text = walker.nextNode();
    if (!text) throw new Error('pasted text was not found');
    const start = text.data.indexOf('متن پاک');
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + 'متن پاک'.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await editor.getByLabel('رنگ متن').selectOption('blue');
  await expect(area.locator('span[data-text-color="blue"]')).toContainText('متن پاک');
  await expect(area.locator('span[data-text-color][style], font')).toHaveCount(0);

  /* Tables are captioned semantic structures. Escape closes the modal, and
     reopening it keeps the editor selection available for insertion. */
  await area.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const tableButton = editor.getByRole('button', { name: 'افزودن یا ویرایش جدول' });
  await tableButton.click();
  await expect(page.getByRole('dialog', { name: 'افزودن جدول' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'افزودن جدول' })).toHaveCount(0);

  await tableButton.click();
  const tableDialog = page.getByRole('dialog', { name: 'افزودن جدول' });
  await expect(tableDialog.getByLabel(/تعداد ردیف/)).toHaveAttribute('min', '2');
  await expect(tableDialog.getByLabel(/تعداد ردیف/)).toHaveAttribute('max', '20');
  await expect(tableDialog.getByLabel('تعداد ستون')).toHaveAttribute('max', '8');
  await tableDialog.getByLabel(/تعداد ردیف/).fill('4');
  await tableDialog.getByLabel('تعداد ستون').fill('3');
  await tableDialog.getByRole('button', { name: 'افزودن جدول', exact: true }).click();
  await expect(tableDialog).toBeVisible(); // caption is intentionally required
  await tableDialog.getByLabel('عنوان جدول').fill('جدول آزمایشی تولید');
  await tableDialog.getByRole('button', { name: 'افزودن جدول', exact: true }).click();

  const richTable = area.locator('figure[data-rich-table]').last();
  await expect(richTable.locator('caption')).toHaveText('جدول آزمایشی تولید');
  await expect(richTable.locator('tr')).toHaveCount(4);
  await expect(richTable.locator('thead th[scope="col"]')).toHaveCount(3);
  await expect(richTable.locator('[style],[class]')).toHaveCount(0);
  await richTable.locator('td').first().fill('مقدار حفظ‌شده');

  await richTable.locator('td').first().click();
  await tableButton.click();
  const editTableDialog = page.getByRole('dialog', { name: 'ویرایش جدول' });
  await editTableDialog.getByLabel(/تعداد ردیف/).fill('3');
  await editTableDialog.getByLabel('تعداد ستون').fill('2');
  await editTableDialog.getByRole('button', { name: 'ذخیره تغییرات' }).click();
  await expect(richTable.locator('tr')).toHaveCount(3);
  await expect(richTable.locator('thead th[scope="col"]')).toHaveCount(2);
  await expect(richTable.locator('td').first()).toHaveText('مقدار حفظ‌شده');

  await editor.getByRole('button', { name: 'پیش‌نمایش امن' }).click();
  await expect(editor.locator('.rte__preview')).toBeVisible();
  await expect(editor.locator('.rte__preview figure img[alt="برش‌های نان تازه"]')).toBeVisible();
  await expect(editor.locator('.rte__preview span[data-text-color="blue"]')).toContainText('متن پاک');
  await expect(editor.locator('.rte__preview figure[data-rich-table] table')).toBeVisible();
  await expect(area).toBeHidden();
  await editor.getByRole('button', { name: 'بازگشت به ویرایش' }).click();

  /* Deletion is explicit and confirmed instead of depending on fragile DOM
     key handling inside a contenteditable table. */
  await richTable.locator('td').first().click();
  await tableButton.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('dialog', { name: 'ویرایش جدول' }).getByRole('button', { name: 'حذف جدول' }).click();
  await expect(area.locator('figure[data-rich-table]')).toHaveCount(0);

  await editor.getByRole('button', { name: 'ویرایش تمام‌صفحه' }).click();
  await expect(editor).toHaveClass(/is-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(editor).not.toHaveClass(/is-fullscreen/);

  await page.getByRole('button', { name: 'انصراف' }).last().click();
});

test('choosing a catalogue item auto-fills a new shop product without replacing sales decisions', async ({ page }) => {
  const content = await (await page.request.get('/api/content')).json();
  const source = content.products.find((product) => product.slug === 'dezmaye-gold-70');
  expect(source, 'catalogue fixture for shop autofill').toBeTruthy();

  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  await page.getByRole('button', { name: '+ محصول جدید', exact: true }).click();

  await field(page, 'قیمت (ریال)').fill('1234567');
  await field(page, 'موجودی انبار').fill('23');
  const featured = page.locator('label', { hasText: 'برگزیده' }).locator('input[type="checkbox"]');
  await featured.check();
  await field(page, 'محصول مرتبط در کاتالوگ سایت').selectOption(source.slug);

  await expect(field(page, 'عنوان محصول')).toHaveValue(source.title);
  await expect(field(page, 'برند')).toHaveValue(source.brand);
  await expect(field(page, 'شناسه یکتا (slug)')).toHaveValue(source.slug);
  await expect(field(page, 'واحد فروش')).toHaveValue(`${source.pack} — ${source.weight}`);
  await expect(field(page, 'توضیح کوتاه')).toHaveValue(source.short);
  await expect(field(page, 'قیمت (ریال)')).toHaveValue('1234567');
  await expect(field(page, 'موجودی انبار')).toHaveValue('23');
  await expect(featured).toBeChecked();

  const gallery = page.locator('.admin-product-gallery');
  await expect(gallery.locator('.admin-product-gallery__item')).toHaveCount(source.images.length);
  await expect(gallery.locator('.admin-product-gallery__item img').first()).toHaveAttribute('src', source.images[0]);

  const description = page
    .getByRole('region', { name: 'ویرایشگر توضیحات کامل محصول' })
    .getByRole('textbox', { name: 'ویرایشگر توضیحات کامل محصول' });
  await expect(description).toContainText(source.short);
  await expect(description).toContainText(source.usage[0]);
  await expect(description).toContainText(source.analysis[0][0]);
  await expect(description).toContainText(source.storage[0]);
  await expect(page.getByText(/عنوان، برند، شناسه، واحد فروش، تصاویر، توضیحات و مشخصات/)).toBeVisible();

  await page.getByRole('button', { name: 'انصراف' }).last().click();
});

test('the shop full-description field uses the same approachable rich editor', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  await page.locator('.admin__item').first().locator('[title="ویرایش"]').click();

  await expect(page.getByRole('heading', { name: 'توضیحات کامل (با امکان رنگ متن، جدول، پیوند، عکس و ویدیو)' })).toBeVisible();
  const editor = page.getByRole('region', { name: 'ویرایشگر توضیحات کامل محصول' });
  await expect(editor.getByRole('textbox', { name: 'ویرایشگر توضیحات کامل محصول' })).toHaveAttribute('data-placeholder', /توضیحات کامل محصول/);
  await expect(editor.getByRole('button', { name: /افزودن یا ویرایش پیوند/ })).toBeVisible();
  await expect(editor.getByLabel('رنگ متن')).toBeVisible();
  await expect(editor.getByRole('button', { name: 'افزودن یا ویرایش جدول' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'افزودن تصویر' })).toBeVisible();
  await expect(editor.getByRole('button', { name: 'افزودن ویدیو' })).toBeVisible();
  await page.getByRole('button', { name: 'انصراف' }).last().click();
});

test('shop galleries persist, select a primary picture, and render publicly', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  const firstRow = page.locator('.admin__item').first();
  await firstRow.locator('[title="ویرایش"]').click();

  const slug = await field(page, 'شناسه یکتا (slug)').inputValue();
  const title = await field(page, 'عنوان محصول').inputValue();
  const galleryEditor = page.locator('.admin-product-gallery');
  const originalPrimary = await galleryEditor.locator('.admin-product-gallery__item').first().locator('img').getAttribute('src');
  const addedImage = originalPrimary?.includes('shetab')
    ? '/assets/products/xpower.webp'
    : '/assets/products/shetab.webp';

  await galleryEditor.getByLabel('یا نشانی تصویر').fill(addedImage);
  await galleryEditor.getByRole('button', { name: 'افزودن' }).click();
  await expect(galleryEditor.locator('.admin-product-gallery__item')).toHaveCount(2);
  await galleryEditor.getByRole('button', { name: 'انتخاب به‌عنوان اصلی' }).click();
  await expect(galleryEditor.locator('.admin-product-gallery__item').first().locator('img')).toHaveAttribute('src', addedImage);
  await page.getByRole('button', { name: 'ذخیره محصول', exact: true }).click();
  await expect(page.locator('.admin__item', { hasText: title })).toBeVisible();

  await gotoReady(page, '/shop');
  const shopCard = page.locator(`.shop-card a[href="/shop/${slug}"]`);
  await expect(shopCard.locator('img')).toHaveAttribute('src', addedImage);
  await gotoReady(page, `/shop/${slug}`);
  const publicGallery = page.locator('.product-gallery');
  await expect(publicGallery.locator('.product-gallery__thumb')).toHaveCount(2);
  await expect(publicGallery.locator('.product-gallery__main')).toHaveAttribute('src', addedImage);
  await publicGallery.getByRole('button', { name: /تصویر بعدی/ }).click();
  await expect(publicGallery.locator('.product-gallery__main')).toHaveAttribute('src', originalPrimary);

  /* Leave shared E2E data at its seeded visual state for later specs. */
  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  await page.locator('.admin__item', { hasText: title }).locator('[title="ویرایش"]').click();
  const restoreEditor = page.locator('.admin-product-gallery');
  await restoreEditor.getByRole('button', { name: 'حذف تصویر 1' }).click();
  await expect(restoreEditor.locator('.admin-product-gallery__item')).toHaveCount(1);
  await expect(restoreEditor.locator('.admin-product-gallery__item img')).toHaveAttribute('src', originalPrimary);
  await page.getByRole('button', { name: 'ذخیره محصول', exact: true }).click();
});

test('product editors refuse gallery URLs that the image CSP cannot render', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'محصولات').first().click();
  await page.locator('.admin-products__item').first().locator('[title="ویرایش"]').click();

  const gallery = page.locator('.admin-product-gallery');
  const addInput = gallery.getByLabel('یا نشانی تصویر');
  const count = await gallery.locator('.admin-product-gallery__item').count();

  await addInput.fill('https://untrusted.example/product.webp');
  await gallery.getByRole('button', { name: 'افزودن' }).click();
  await expect(gallery.locator('.admin-product-gallery__status')).toContainText('مبدأ این تصویر');
  await expect(gallery.locator('.admin-product-gallery__item')).toHaveCount(count);

  await addInput.fill('http://cdn.example/product.webp');
  await gallery.getByRole('button', { name: 'افزودن' }).click();
  await expect(gallery.locator('.admin-product-gallery__status')).toContainText('فقط مسیر داخلی امن');

  /* Directly editing an existing row bypasses the add button, so the save
     guard must apply the same rule before the request reaches the server. */
  await gallery.locator('.admin-product-gallery__item input[dir="ltr"]').first().fill('https://untrusted.example/bypass.webp');
  const dialogPromise = page.waitForEvent('dialog');
  const clickPromise = page.getByRole('button', { name: 'ذخیره محصول', exact: true }).click();
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('مبدأ HTTPS');
  await dialog.dismiss();
  await clickPromise;
  await page.getByRole('button', { name: 'انصراف' }).last().click();
});

test('unused uploads are previewed with size and quarantined only after confirmation', async ({ page }) => {
  const uploadDir = path.join(E2E.dataDir, 'uploads', 'images');
  fs.mkdirSync(uploadDir, { recursive: true });
  const name = `e2e-unused-${STAMP}.png`;
  const file = path.join(uploadDir, name);
  /* Valid 1x1 PNG, so the preview exercises a real image rather than a broken
     fixture. Its old mtime puts it outside the 24-hour draft grace period. */
  fs.writeFileSync(file, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(file, old, old);

  await loginAdmin(page);
  await adminTab(page, 'تصاویر صفحات').click();
  const cleanup = page.getByTestId('unused-uploads');
  await cleanup.getByRole('button', { name: 'بررسی فایل‌ها' }).click();
  await expect(cleanup).toContainText(name);
  await expect(cleanup).toContainText('بایت');
  await expect(cleanup.locator(`img[src="/uploads/images/${name}"]`)).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await cleanup.getByRole('button', { name: 'انتقال موارد انتخاب‌شده به قرنطینه' }).click();
  await expect(cleanup).toContainText('به قرنطینه منتقل شد');
  await expect(cleanup).toContainText('فایل قدیمیِ بدون استفاده‌ای پیدا نشد');
  expect(fs.existsSync(file)).toBe(false);
  const quarantined = fs.readdirSync(path.join(E2E.dataDir, 'uploads', '.quarantine'), { recursive: true });
  expect(quarantined.some((entry) => String(entry).endsWith(name))).toBe(true);
});

test('the admin shell uses an accessible drawer on a narrow screen @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'narrow-screen layout check');
  await loginAdmin(page);

  const toggle = page.getByRole('button', { name: 'باز کردن فهرست پنل' });
  const toggleElement = page.locator('.admin__menu-toggle');
  const mobilebar = page.locator('.admin__mobilebar');
  const main = page.locator('.admin__main');
  const side = page.locator('.admin__side');
  await expect(toggle).toBeVisible();
  await expect(side).not.toBeVisible();
  await expect(page.locator('.admin__mobile-current')).toContainText('محصولات');

  await toggle.click();
  await expect(toggleElement).toHaveAttribute('aria-expanded', 'true');
  await expect(side).toBeVisible();
  await expect(side).toHaveAttribute('role', 'dialog');
  await expect(side).toHaveAttribute('aria-modal', 'true');
  await expect(mobilebar).toHaveAttribute('inert', '');
  await expect(mobilebar).toHaveAttribute('aria-hidden', 'true');
  await expect(main).toHaveAttribute('inert', '');
  await expect(main).toHaveAttribute('aria-hidden', 'true');

  await page.keyboard.press('Escape');
  await expect(side).not.toBeVisible();
  await expect(mobilebar).not.toHaveAttribute('inert', '');
  await expect(mobilebar).not.toHaveAttribute('aria-hidden', 'true');
  await expect(main).not.toHaveAttribute('inert', '');
  await expect(main).not.toHaveAttribute('aria-hidden', 'true');
  await expect(toggle).toBeFocused();

  const labels = [
    'محصولات', 'وبلاگ', 'فروشگاه — محصولات', 'سفارش‌ها', 'دیدگاه‌ها',
    'درگاه پرداخت', 'مشتریان', 'پیامک', 'امنیت و محدودیت‌ها', 'گالری', 'متون سایت',
    'تصاویر صفحات', 'پیوندها', 'نمادهای اعتماد', 'اطلاعات تماس', 'نمایندگان فروش', 'پیام‌های مردم',
  ];
  for (const label of labels) {
    await openAdminTab(page, label);
    await expect(side).not.toBeVisible();
    await expect(page.locator('.admin__mobile-current')).toContainText(label);
    await expect(page.locator('.admin__panel').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${label} introduced horizontal page overflow`).toBeLessThanOrEqual(1);
  }
});

test('the catalogue filters and product rows fit a narrow screen @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'narrow-screen catalogue check');
  await loginAdmin(page);

  const content = await (await page.request.get('/api/content')).json();
  const sample = content.products[0];
  const panel = page.locator('.admin-products');
  const search = page.getByRole('searchbox', { name: 'جست‌وجوی محصولات' });
  await expect(panel).toBeVisible();
  await expect(search).toBeVisible();
  await expect(page.getByLabel('فیلتر برند محصولات')).toBeVisible();
  await expect(page.getByLabel('مرتب‌سازی محصولات')).toBeVisible();
  await search.fill(sample.slug);
  await expect(page.locator('.admin-products__item')).toHaveCount(1);

  const panelBox = await panel.boundingBox();
  expect(panelBox).toBeTruthy();
  expect(panelBox.x).toBeGreaterThanOrEqual(0);
  expect(panelBox.x + panelBox.width).toBeLessThanOrEqual((page.viewportSize()?.width || 412) + 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the catalogue controls must not cause horizontal page overflow').toBeLessThanOrEqual(1);
});

test('the rich editor stays usable on a narrow screen @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'narrow-screen layout check');
  await loginAdmin(page);
  await openAdminTab(page, 'وبلاگ');
  await page.getByRole('button', { name: /مقاله جدید/ }).first().click();

  const editor = page.getByRole('region', { name: 'ویرایشگر متن مقاله' });
  await editor.scrollIntoViewIfNeeded();
  const editorBox = await editor.boundingBox();
  expect(editorBox).toBeTruthy();
  expect(editorBox.x).toBeGreaterThanOrEqual(0);
  expect(editorBox.x + editorBox.width).toBeLessThanOrEqual((page.viewportSize()?.width || 412) + 1);
  const overflow = await editor.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await editor.getByRole('button', { name: /افزودن یا ویرایش پیوند/ }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن پیوند' });
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox).toBeTruthy();
  expect(dialogBox.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox.width).toBeLessThanOrEqual(page.viewportSize()?.width || 412);
  await dialog.getByRole('button', { name: 'انصراف' }).click();

  const area = editor.getByRole('textbox', { name: 'ویرایشگر متن مقاله' });
  await area.fill('جدول واکنش‌گرا');
  await area.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await editor.getByRole('button', { name: 'افزودن یا ویرایش جدول' }).click();
  const tableDialog = page.getByRole('dialog', { name: 'افزودن جدول' });
  const tableDialogBox = await tableDialog.boundingBox();
  expect(tableDialogBox).toBeTruthy();
  expect(tableDialogBox.x).toBeGreaterThanOrEqual(0);
  expect(tableDialogBox.width).toBeLessThanOrEqual(page.viewportSize()?.width || 412);
  await tableDialog.getByLabel(/تعداد ردیف/).fill('2');
  await tableDialog.getByLabel('تعداد ستون').fill('8');
  await tableDialog.getByLabel('عنوان جدول').fill('جدول پهن آزمایشی');
  await tableDialog.getByRole('button', { name: 'افزودن جدول', exact: true }).click();
  await editor.getByRole('button', { name: 'پیش‌نمایش امن' }).click();
  const richTable = editor.locator('.rte__preview figure[data-rich-table]');
  await expect(richTable).toBeVisible();
  const tableOverflow = await richTable.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(tableOverflow).toBeGreaterThan(0);
  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(pageOverflow).toBeLessThanOrEqual(1);
  await editor.getByRole('button', { name: 'بازگشت به ویرایش' }).click();

  await editor.getByRole('button', { name: 'ویرایش تمام‌صفحه' }).click();
  await expect(editor).toHaveCSS('position', 'fixed');
  const fullscreenBox = await editor.boundingBox();
  expect(fullscreenBox).toBeTruthy();
  expect(fullscreenBox.width).toBeGreaterThanOrEqual((page.viewportSize()?.width || 412) - 1);
  await page.keyboard.press('Escape');
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
  await body.evaluate((editor) => {
    editor.innerHTML = [
      '<h2>عنوان بخش آزمایشی</h2>',
      '<p>متن آزمایشی مقاله با یک <a href="/products" title="محصولات">پیوند</a> و <span data-text-color="blue">عبارت آبی</span> برای آنکه صفحه خالی نباشد.</p>',
      '<blockquote>نکته آزمایشی برای خوانندگان مقاله</blockquote>',
      '<figure data-rich-table><table><caption>آمار آزمایشی</caption><thead><tr><th scope="col">سال</th><th scope="col">مقدار</th></tr></thead><tbody><tr><td>۱۴۰۳</td><td>۱۲</td></tr></tbody></table></figure>',
      '<figure><img src="/assets/img/bread-slicing-480.webp" alt="برش نان تازه"><figcaption>زیرنویس آزمایشی تصویر</figcaption></figure>',
    ].join('');
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  });

  await page.getByRole('button', { name: 'ذخیره مقاله' }).click();
  await expect(page.locator('.admin__item', { hasText: 'مقاله آزمایشی خودکار' })).toBeVisible();

  await gotoReady(page, '/blog');
  await expect(page.locator('main')).toContainText('مقاله آزمایشی خودکار');
  await gotoReady(page, `/blog/${POST_SLUG}`);
  const publishedBody = page.locator('.post-body');
  await expect(publishedBody).toContainText('متن آزمایشی مقاله');
  await expect(publishedBody.getByRole('heading', { name: 'عنوان بخش آزمایشی' })).toBeVisible();
  await expect(publishedBody.locator('blockquote')).toHaveText('نکته آزمایشی برای خوانندگان مقاله');
  await expect(publishedBody.locator('a[href="/products"]')).toHaveAttribute('title', 'محصولات');
  await expect(publishedBody.locator('span[data-text-color="blue"]')).toHaveText('عبارت آبی');
  const publishedTable = publishedBody.locator('figure[data-rich-table]');
  await expect(publishedTable.locator('caption')).toHaveText('آمار آزمایشی');
  await expect(publishedTable.locator('th[scope="col"]')).toHaveCount(2);
  await expect(publishedTable.locator('td')).toHaveCount(2);
  await expect(publishedTable.locator('[style],[class]')).toHaveCount(0);
  await expect(publishedBody.locator('figure img')).toHaveAttribute('alt', 'برش نان تازه');
  await expect(publishedBody.locator('figcaption')).toHaveText('زیرنویس آزمایشی تصویر');

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

  /* put it back so the scratch SQLite content stays representative */
  await loginAdmin(page);
  await adminTab(page, 'متون سایت').first().click();
  await page.locator('.admin__search input').fill('home.hero.badge');
  await page.locator('.admin__text-row', { hasText: 'home.hero.badge' }).locator('textarea').fill(original);
  await page.waitForTimeout(1500);
});

test('a message sent from the contact form appears in the inbox', async ({ page }) => {
  const BODY = 'پیام آزمایشی خودکار ' + STAMP + ' — لطفاً نادیده بگیرید.';

  /* The inbox lists sender and phone; the body only renders once a row is
     expanded. Looking for the stamp in a collapsed list could never match,
     so it goes in the name too. */
  await gotoReady(page, '/contact');
  await page.locator('#name').fill('آزمون خودکار ' + STAMP);
  await page.locator('#phone').fill('09123456789');
  await page.locator('#email').fill('e2e@example.com');
  await page.locator('#message').fill(BODY);
  await page.locator('form button[type="submit"]').click();

  /* Accepting an inline error here as "either way the visitor is told" made
     the test contradict itself: it would then assert the message reached the
     inbox, which a refused post never does. The send must succeed — the run
     lifts the public rate limit (see playwright.config.js) so the only way
     to land on the error branch is a genuine fault. */
  await expect(page.getByRole('button', { name: /ارسال پیام دیگر|پیام جدید|ارسال دوباره/ }).first()).toBeVisible({
    timeout: 15_000,
  });

  await loginAdmin(page);
  await adminTab(page, 'پیام‌های مردم').first().click();
  await expect(page.locator('.msg', { hasText: STAMP })).toBeVisible({ timeout: 15_000 });

  /* Mark read / delete must work from the UI. */
  const msg = page.locator('.msg', { hasText: STAMP }).first();
  /* Expanding it proves the body survived the round trip, not just the name. */
  await msg.locator('.msg__head').click();
  await expect(msg).toContainText(BODY);
  await msg.getByRole('button', { name: /خوانده|نخوانده/ }).click();
  await expect(page.locator('.msg', { hasText: STAMP })).toBeVisible();
});

test('the admin can publish one to four third-party trust seals in the footer', async ({ page }) => {
  await gotoReady(page, '/');
  await expect(page.locator('.footer__trust')).toHaveCount(0);

  await loginAdmin(page);
  const original = await page.evaluate(() => fetch('/api/content', { cache: 'no-store' }).then((response) => response.json()));

  /* The seal stays remote, like the real eNamad logo. Intercept only the test
     host so the browser exercises the generated CSP without using the network. */
  await page.route('https://seal.example/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  }));

  try {
    await adminTab(page, 'نمادهای اعتماد').first().click();
    const editor = page.getByTestId('trust-seals-editor');
    await expect(editor).toContainText('هنوز نمادی ثبت نشده است');

    const add = editor.getByRole('button', { name: /افزودن نماد/ });
    for (let index = 0; index < 4; index += 1) await add.click();
    await expect(editor.locator('.trust-seal-editor__item')).toHaveCount(4);
    await expect(add).toBeDisabled();

    /* Keep one configured row; the same controls support reordering and up to
       four providers without special-casing eNamad. */
    for (let index = 0; index < 3; index += 1) await editor.getByRole('button', { name: 'حذف نماد' }).last().click();
    const item = editor.locator('.trust-seal-editor__item').first();
    await item.getByLabel(/نام نماد/).fill('نماد اعتماد آزمایشی');
    await item.getByLabel('لینک اعتبارسنجی (href)').fill('https://seal.example/verify?id=19077&Code=e2e');
    await item.getByLabel('شناسه تصویر (id) — اختیاری').fill('e2eTrustCode');
    await item.getByLabel('نشانی تصویر نماد (src)').fill('https://seal.example/logo.png');
    await item.getByLabel('نمایش این نماد در فوتر').check();
    await editor.getByRole('button', { name: 'ذخیره نمادها' }).click();
    await expect(editor.getByRole('status')).toContainText('ذخیره شدند');

    const root = await page.request.get(new URL('/', page.url()).href);
    expect(root.headers()['content-security-policy']).toContain('https://seal.example');

    await gotoReady(page, '/');
    const seal = page.locator('.footer__trust-link');
    await expect(seal).toHaveCount(1);
    await expect(seal).toHaveAttribute('href', 'https://seal.example/verify?id=19077&Code=e2e');
    await expect(seal).toHaveAttribute('referrerpolicy', 'origin');
    await expect(seal.locator('img')).toHaveAttribute('src', 'https://seal.example/logo.png');
    await expect(seal.locator('img')).toHaveAttribute('id', 'e2eTrustCode');
    await expect(seal.locator('img')).toHaveAttribute('alt', 'نماد اعتماد آزمایشی');
    await seal.scrollIntoViewIfNeeded();
    await expect.poll(() => seal.locator('img').evaluate((image) => image.naturalWidth)).toBe(1);
  } finally {
    if (original) {
      const restored = await page.evaluate(async ({ content, revisionHeader }) => {
        const latest = await fetch('/api/content', { cache: 'no-store' });
        const response = await fetch('/api/content', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            [revisionHeader]: latest.headers.get(revisionHeader),
          },
          body: JSON.stringify(content),
        });
        return response.ok;
      }, { content: original, revisionHeader: CONTENT_REVISION_HEADER });
      expect(restored, 'trust-seal fixture cleanup failed').toBe(true);
    }
  }
});

test('the shop products tab can refresh live stock without clobbering it', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  await expect(page.locator('.admin__panel h1')).toContainText('فروشگاه');
  const showcaseEditor = page.locator('.shop-showcase-editor');
  await expect(showcaseEditor.getByRole('heading', { name: 'ویترین تصویری فروشگاه' })).toBeVisible();
  await expect(showcaseEditor.getByLabel('پیوند صفحه (مثلاً /products)')).toHaveValue('/products');
  await expect(showcaseEditor.getByLabel('متن جایگزین تصویر')).not.toHaveValue('');
  await showcaseEditor.getByRole('button', { name: 'ذخیره ویترین' }).click();
  await expect(showcaseEditor.getByRole('status')).toContainText('ذخیره شد');

  const refresh = page.getByRole('button', { name: /بروزرسانی/ });
  await expect(refresh).toBeVisible();
  await refresh.click();
  await expect(page.locator('.admin__item').first()).toBeVisible();
});

test('the shop showcase can publish multiple independently linked images', async ({ page }) => {
  await loginAdmin(page);
  const original = await page.evaluate(() => fetch('/api/content', { cache: 'no-store' }).then((response) => response.json()));

  try {
    await adminTab(page, 'فروشگاه — محصولات').first().click();
    const editor = page.locator('.shop-showcase-editor');
    await editor.getByRole('button', { name: 'افزودن تصویر' }).click();
    await expect(editor.locator('.shop-showcase-editor__item')).toHaveCount(2);

    const second = editor.locator('.shop-showcase-editor__item').nth(1);
    await second.getByLabel('نشانی تصویر').fill('/assets/img/factory.webp');
    await second.getByLabel('پیوند صفحه (مثلاً /products)').fill('/about');
    await second.getByLabel('متن جایگزین تصویر').fill('کارخانه خمیرمایه خوزستان');
    await editor.getByRole('button', { name: 'ذخیره ویترین' }).click();
    await expect(editor.getByRole('status')).toContainText('ذخیره شد');

    await gotoReady(page, '/shop');
    const showcase = page.getByTestId('shop-showcase');
    await expect(showcase.locator('.shop-showcase__link')).toHaveCount(2);
    await expect(showcase.locator('.shop-showcase__link').nth(0)).toHaveAttribute('href', '/products');
    await expect(showcase.locator('.shop-showcase__link').nth(1)).toHaveAttribute('href', '/about');

    /* Rotation starts without input and advances on the fixed four-second
       cadence. Move the test pointer off the showcase so its intentional
       hover-pause does not turn this into a timing-dependent assertion. */
    await page.mouse.move(0, (page.viewportSize()?.height || 900) - 1);
    await expect(showcase).toHaveAttribute('data-autoplay', 'true');
    await expect(showcase.locator('.shop-showcase__slide').nth(1)).toHaveAttribute('aria-hidden', 'false', { timeout: 5_500 });

    /* Manual controls still wrap correctly and pause while keyboard focus is
       inside the carousel, so an automatic tick cannot fight the user. */
    await showcase.getByRole('button', { name: 'تصویر قبلی' }).click();
    await expect(showcase.locator('.shop-showcase__slide').nth(0)).toHaveAttribute('aria-hidden', 'false');
    await expect(showcase).toHaveAttribute('data-autoplay', 'false');
  } finally {
    if (original) {
      const restored = await page.evaluate(async ({ content, revisionHeader }) => {
        const latest = await fetch('/api/content', { cache: 'no-store' });
        const response = await fetch('/api/content', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            [revisionHeader]: latest.headers.get(revisionHeader),
          },
          body: JSON.stringify(content),
        });
        return response.ok;
      }, { content: original, revisionHeader: CONTENT_REVISION_HEADER });
      expect(restored, 'showcase fixture cleanup failed').toBe(true);
    }
  }
});

test('an order placed on the site is visible in the orders tab and its status can change', async ({ page }) => {
  /* This is intentionally a full customer-to-admin lifecycle. A cold Windows
     runner can spend most of the default budget compiling and navigating
     before its many assertions begin, so use Playwright's semantic long-test
     marker rather than hiding the cost behind sleeps. */
  test.slow();

  /* place a real order through the storefront. Ordering needs a verified
     account now, so the journey starts with one — set up through the API,
     to keep this test about the admin panel. */
  await gotoReady(page, '/shop');
  await signUpCustomer(page, { phone: uniquePhone(), name: 'سفارش آزمایشی' });
  await addAddress(page, { receiver: 'سفارش آزمایشی' });

  await gotoReady(page, '/shop/dezmaye-gold-80');
  await page.locator('.sp-buy__row .btn').click();
  await gotoReady(page, '/shop/checkout');
  await routeSettled(page);
  const form = page.locator('.checkout-form');
  /* the saved address is preselected */
  await expect(form.locator('.checkout-addr__item.is-on')).toHaveCount(1);
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/shop\/order\//, { timeout: 20_000 });
  const code = (await (await one(page, '.order-hero .code')).innerText()).trim();

  await loginAdmin(page);
  await adminTab(page, 'سفارش‌ها').first().click();
  let row = page.locator('.ord__item', { hasText: code }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  /* Operational controls are in the aligned summary row: fulfilment should
     never require opening the detail panel. The header remains attached while
     a long list scrolls, and merchant column choices survive a reload. */
  const orderHeader = page.locator('.admin-data-grid--orders .admin-data-grid__header');
  await expect(orderHeader).toBeVisible();
  expect(await orderHeader.evaluate((node) => getComputedStyle(node).position)).toBe('sticky');
  const select = row.getByRole('combobox', { name: `وضعیت سفارش ${code}` });
  await expect(select).toBeVisible();

  /* A failed/refund-pending order must not hide in an internal note. Exercise
     the durable flag through the API, then prove the list badge, prominent
     detail warning and explicit acknowledgement control all work. */
  const orderSnapshot = await page.evaluate(async () => {
    const response = await fetch('/api/shop-admin');
    return { ok: response.ok, body: await response.json() };
  });
  expect(orderSnapshot.ok).toBe(true);
  const targetOrder = orderSnapshot.body.orders.find((order) => order.code === code);
  expect(targetOrder?.id).toBeTruthy();
  const flagged = await page.evaluate(async (id) => {
    const response = await fetch(`/api/shop-admin/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ needsAttention: true }),
    });
    return response.ok;
  }, targetOrder.id);
  expect(flagged).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await adminTab(page, 'سفارش‌ها').first().click();
  row = page.locator('.ord__item', { hasText: code }).first();
  await expect(row.locator('.ord__attention-badge')).toHaveText('نیازمند رسیدگی');
  await row.getByRole('button', { name: `نمایش جزئیات سفارش ${code}` }).click();
  await expect(row.locator('.ord__attention-alert')).toContainText('بازگرداندن وجه این سفارش هنوز نیازمند پیگیری است');
  page.once('dialog', (dialog) => dialog.accept());
  const acknowledged = page.waitForResponse((response) =>
    response.url().includes(`/api/shop-admin/orders/${targetOrder.id}`) && response.request().method() === 'PATCH',
  );
  await row.getByRole('button', { name: /رسیدگی شد؛ پاک‌کردن هشدار/ }).click();
  expect((await acknowledged).ok()).toBe(true);
  await expect(row.locator('.ord__attention-badge')).toHaveCount(0);
  await expect(row.locator('.ord__attention-alert')).toHaveCount(0);

  await page.getByRole('button', { name: 'تنظیم ستون‌های سفارش‌ها' }).click();
  await page.locator('#order-columns label', { hasText: 'تاریخ' }).getByRole('checkbox').uncheck();
  await expect(orderHeader.locator('span', { hasText: /^تاریخ$/ })).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await adminTab(page, 'سفارش‌ها').first().click();
  await expect(page.locator('.admin-data-grid--orders .admin-data-grid__header span', { hasText: /^تاریخ$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'تنظیم ستون‌های سفارش‌ها' }).click();
  await page.getByRole('button', { name: 'نمایش همه ستون‌ها' }).click();

  row = page.locator('.ord__item', { hasText: code }).first();
  const directSelect = row.getByRole('combobox', { name: `وضعیت سفارش ${code}` });
  const before = await directSelect.inputValue();
  const after = (await directSelect.locator('option').evaluateAll((os) => os.map((o) => o.value))).find((v) => v !== before);

  /* Changing the status must stick across a reload — that is the path where
     the stock re-reservation bug lived. The proof is what comes back from the
     server, not only the optimistic value shown by the control. */
  const changed = page.waitForResponse((response) =>
    response.url().includes('/api/shop-admin/orders/') && response.request().method() === 'PATCH',
  );
  await directSelect.selectOption(after);
  expect((await changed).ok()).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await adminTab(page, 'سفارش‌ها').first().click();
  const again = page.locator('.ord__item', { hasText: code }).first();
  await expect(again).toBeVisible({ timeout: 15_000 });
  await expect(again.getByRole('combobox', { name: `وضعیت سفارش ${code}` })).toHaveValue(after);

  /* Expandability and customer details are preserved under the denser rows;
     the customer list uses the same sticky, configurable grid system. */
  await again.getByRole('button', { name: `نمایش جزئیات سفارش ${code}` }).click();
  await expect(again.locator('.ord__detail')).toContainText('اقلام سفارش');

  const archived = page.waitForResponse((response) =>
    response.url().includes('/api/shop-admin/orders/') && response.request().method() === 'PATCH',
  );
  await again.getByRole('button', { name: 'بایگانی سفارش' }).click();
  expect((await archived).ok()).toBe(true);
  await expect(page.locator('.ord__item', { hasText: code })).toHaveCount(0);
  await page.getByRole('button', { name: /بایگانی/ }).click();
  let archivedRow = page.locator('.ord__item', { hasText: code }).first();
  await expect(archivedRow).toBeVisible();
  await archivedRow.getByRole('button', { name: `نمایش جزئیات سفارش ${code}` }).click();
  await archivedRow.getByRole('button', { name: 'بازگرداندن به سفارش‌های جاری' }).click();
  await expect(page.locator('.ord__item', { hasText: code })).toHaveCount(0);
  await page.getByRole('button', { name: 'سفارش‌های جاری' }).click();
  await expect(page.locator('.ord__item', { hasText: code }).first()).toBeVisible();

  await adminTab(page, 'مشتریان').first().click();
  const customerHeader = page.locator('.admin-data-grid--customers .admin-data-grid__header');
  await expect(customerHeader).toBeVisible({ timeout: 15_000 });
  expect(await customerHeader.evaluate((node) => getComputedStyle(node).position)).toBe('sticky');
  const customer = page.locator('.cust', { hasText: 'سفارش آزمایشی' }).first();
  await expect(customer).toBeVisible();
  await customer.locator('.cust__row').click();
  await expect(customer.locator('.cust__detail')).toBeVisible();

  await page.getByRole('button', { name: 'تنظیم ستون‌های مشتریان' }).click();
  await page.locator('#customer-columns label', { hasText: 'نشانی‌ها' }).getByRole('checkbox').uncheck();
  await expect(customerHeader.locator('span', { hasText: /^نشانی‌ها$/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'نمایش همه ستون‌ها' }).click();
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
