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
import { loginAdmin, adminTab, watchConsole, gotoReady, routeSettled, one, E2E, signUpCustomer, addAddress, uniquePhone } from './helpers.js';

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
    'درگاه پرداخت', 'مشتریان', 'پیامک', 'امنیت و محدودیت‌ها', 'متون سایت',
    'تصاویر صفحات', 'پیوندها', 'نمادهای اعتماد', 'اطلاعات تماس', 'پیام‌های مردم',
  ];
  for (const label of labels) {
    await adminTab(page, label).first().click();
    await expect(page.locator('.admin__panel').first()).toBeVisible();
    await expect(page.locator('.admin__panel h1').first()).not.toBeEmpty();
  }
  expect(errors, 'console errors while touring the panel').toEqual([]);
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

  await editor.getByRole('button', { name: 'پیش‌نمایش امن' }).click();
  await expect(editor.locator('.rte__preview')).toBeVisible();
  await expect(editor.locator('.rte__preview figure img[alt="برش‌های نان تازه"]')).toBeVisible();
  await expect(area).toBeHidden();
  await editor.getByRole('button', { name: 'بازگشت به ویرایش' }).click();

  await editor.getByRole('button', { name: 'ویرایش تمام‌صفحه' }).click();
  await expect(editor).toHaveClass(/is-fullscreen/);
  await page.keyboard.press('Escape');
  await expect(editor).not.toHaveClass(/is-fullscreen/);

  await page.getByRole('button', { name: 'انصراف' }).last().click();
});

test('the shop full-description field uses the same approachable rich editor', async ({ page }) => {
  await loginAdmin(page);
  await adminTab(page, 'فروشگاه — محصولات').first().click();
  await page.locator('.admin__item').first().locator('[title="ویرایش"]').click();

  await expect(page.getByRole('heading', { name: 'توضیحات کامل (با امکان پیوند، عکس و ویدیو)' })).toBeVisible();
  const editor = page.getByRole('region', { name: 'ویرایشگر توضیحات کامل محصول' });
  await expect(editor.getByRole('textbox', { name: 'ویرایشگر توضیحات کامل محصول' })).toHaveAttribute('data-placeholder', /توضیحات کامل محصول/);
  await expect(editor.getByRole('button', { name: /افزودن یا ویرایش پیوند/ })).toBeVisible();
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

test('the rich editor stays usable on a narrow screen @mobile', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'narrow-screen layout check');
  await loginAdmin(page);
  await adminTab(page, 'وبلاگ').first().click();
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
      '<p>متن آزمایشی مقاله با یک <a href="/products" title="محصولات">پیوند</a> و چند جمله برای آنکه صفحه خالی نباشد.</p>',
      '<blockquote>نکته آزمایشی برای خوانندگان مقاله</blockquote>',
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

  /* put it back so the scratch content file stays representative */
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
      const restored = await page.evaluate(async (content) => {
        const response = await fetch('/api/content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(content),
        });
        return response.ok;
      }, original);
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
      const restored = await page.evaluate(async (content) => {
        const response = await fetch('/api/content', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(content),
        });
        return response.ok;
      }, original);
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
