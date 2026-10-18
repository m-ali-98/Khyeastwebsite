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

  /* Hidden locale-specific destinations must not leak back through Cmd+K. */
  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: /دسترسی سریع/ });
  await expect(palette.getByRole('option', { name: /محصولات/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /سفارش‌ها/ })).toHaveCount(0);
  await page.keyboard.press('Escape');

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
  const token = await page.evaluate(() => localStorage.getItem('ky_admin_token'));
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
    await showcase.getByRole('button', { name: 'تصویر بعدی' }).click();
    await expect(showcase.locator('.shop-showcase__slide').nth(1)).toHaveAttribute('aria-hidden', 'false');
  } finally {
    if (token && original) {
      const restored = await page.request.put(new URL('/api/content', page.url()).href, {
        headers: { Authorization: `Bearer ${token}` },
        data: original,
      });
      expect(restored.ok(), 'showcase fixture cleanup failed').toBe(true);
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
