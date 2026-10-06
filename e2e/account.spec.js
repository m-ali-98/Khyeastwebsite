/* ==========================================================================
   The account journey, driven through the actual forms.

   The API-level guarantees (hashing, ownership, enumeration, rate limits)
   are covered by scripts/test/account-http.mjs. What only a browser can
   answer is whether a customer can get through the flow at all: does the
   code field appear, does the countdown stop them resending, does the panel
   show their order, does signing out really sign them out.
   ========================================================================== */
import { test, expect } from '@playwright/test';
import { gotoReady, routeSettled, watchConsole, loginAdmin, E2E, uniquePhone, signUpCustomer, addAddress } from './helpers.js';

/* The customer's inbox, read through the admin API. */
async function codeFor(page, phone) {
  const admin = await page.request.post('/api/auth/login', { data: { user: E2E.user, pass: E2E.pass } });
  const { token } = await admin.json();
  const log = await (await page.request.get('/api/shop-admin/sms', { headers: { Authorization: `Bearer ${token}` } })).json();
  const row = (log.log || []).find((l) => l.kind === 'otp' && l.phone.endsWith(phone.slice(-4)));
  return row?.text.match(/(\d{5})/)?.[1];
}

test.describe('customer accounts', () => {
  test('a visitor can register with their phone and land in their panel', async ({ page }) => {
    const errors = watchConsole(page);
    const phone = uniquePhone();

    await gotoReady(page, '/shop/login');
    await page.locator('.auth-tab', { hasText: 'ثبت‌نام' }).click();

    /* step 1 — the number */
    await page.locator('input[type="tel"]').fill(phone);
    await page.locator('.auth-card button[type="submit"]').click();

    /* step 2 — the code that was actually sent */
    const code = await codeFor(page, phone);
    expect(code, 'a verification code was sent').toMatch(/^\d{5}$/);
    const codeField = page.locator('input[autocomplete="one-time-code"]');
    await expect(codeField).toBeVisible({ timeout: 15_000 });

    /* The wrong code must not get anyone in. */
    await codeField.fill('00000');
    await page.locator('.auth-card button[type="submit"]').click();
    await expect(page.locator('.note.err')).toBeVisible();

    /* That wrong code was refused with a 400, which the browser logs as a
       failed resource. It is the expected outcome of this step, not a
       regression, so the log starts fresh before the happy path. */
    errors.length = 0;

    await codeField.fill(code);
    await page.locator('.auth-card button[type="submit"]').click();

    /* step 3 — name and password */
    const pw = page.locator('input[autocomplete="new-password"]');
    await expect(pw).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="name"]').fill('مشتری آزمون');
    await pw.fill('e2e-customer-1404');
    await page.locator('.auth-card button[type="submit"]').click();

    await routeSettled(page, /\/shop\/account$/);
    await expect(page.locator('.acc-who')).toContainText('مشتری آزمون');
    expect(errors).toEqual([]);
  });

  test('a weak password is refused with a reason, not a silent failure', async ({ page }) => {
    const phone = uniquePhone();
    await gotoReady(page, '/shop/login');
    await page.locator('.auth-tab', { hasText: 'ثبت‌نام' }).click();
    await page.locator('input[type="tel"]').fill(phone);
    await page.locator('.auth-card button[type="submit"]').click();

    const code = await codeFor(page, phone);
    await page.locator('input[autocomplete="one-time-code"]').fill(code);
    await page.locator('.auth-card button[type="submit"]').click();

    await page.locator('input[autocomplete="name"]').fill('رمز ضعیف');
    await page.locator('input[autocomplete="new-password"]').fill('123');
    await page.locator('.auth-card button[type="submit"]').click();

    await expect(page.locator('.note.err')).toBeVisible();
    await expect(page).toHaveURL(/\/shop\/login/);
  });

  test('the resend button is disabled while the previous code is still live', async ({ page }) => {
    await gotoReady(page, '/shop/login');
    await page.locator('.auth-tab', { hasText: 'ثبت‌نام' }).click();
    await page.locator('input[type="tel"]').fill(uniquePhone());
    await page.locator('.auth-card button[type="submit"]').click();

    const resend = page.locator('.auth-row button').last();
    await expect(resend).toBeDisabled();
    /* and it tells the customer how long, rather than just not working */
    await expect(resend).toContainText('ثانیه');
  });

  test('an existing customer signs in, sees their order, and signing out really signs them out @mobile', async ({ page }) => {
    const phone = uniquePhone();
    await gotoReady(page, '/shop');
    const who = await signUpCustomer(page, { phone });
    await addAddress(page);

    /* place an order so the panel has something in it */
    await gotoReady(page, '/shop/dezmaye-gold-80');
    await page.locator('.sp-buy__row .btn').click();
    await gotoReady(page, '/shop/checkout');
    await page.locator('.checkout-form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/shop\/order\//, { timeout: 20_000 });

    await gotoReady(page, '/shop/account');
    await expect(page.locator('.acc-order')).toHaveCount(1);

    /* sign out */
    await page.locator('.acc-nav__item--out').click();
    await routeSettled(page, /\/shop$/);
    await page.goto('/shop/account', { waitUntil: 'domcontentloaded' });
    await expect(page, 'the panel is closed once signed out').toHaveURL(/\/shop\/login/, { timeout: 20_000 });

    /* sign back in with the password */
    await page.locator('input[type="tel"]').fill(who.phone);
    await page.locator('input[autocomplete="current-password"]').fill(who.password);
    await page.locator('.auth-card button[type="submit"]').click();
    await routeSettled(page, /\/shop\/account$/);
    await expect(page.locator('.acc-order')).toHaveCount(1);
  });

  test('an address can be added, edited and made default from the panel', async ({ page }) => {
    await gotoReady(page, '/shop');
    await signUpCustomer(page, { phone: uniquePhone() });

    await gotoReady(page, '/shop/account');
    await page.locator('.acc-nav__item', { hasText: 'نشانی‌ها' }).click();
    await page.getByRole('button', { name: 'افزودن نشانی' }).click();

    const form = page.locator('.addr-form');

    /* Typed key by key, not filled in one call. A form that re-creates its
       inputs on every render loses focus after the first character, and
       fill() sets the value in one shot so it would sail past the bug.
       This is the regression: the caret must survive a whole word. */
    const title = form.locator('.field', { hasText: 'عنوان نشانی' }).locator('input');
    await title.click();
    await title.pressSequentially('خانه پدری', { delay: 20 });
    await expect(title).toHaveValue('خانه پدری');
    await expect(title).toBeFocused();

    await form.locator('.field', { hasText: 'نام گیرنده' }).locator('input').fill('گیرنده آزمون');
    await form.locator('.field', { hasText: 'موبایل گیرنده' }).locator('input').fill('09120000099');
    await form.locator('select').selectOption('خوزستان');
    await form.locator('.field', { hasText: 'شهر' }).locator('input').fill('دزفول');

    /* A bad postal code must be refused by field, not as a vague error. */
    await form.locator('.field', { hasText: 'کد پستی' }).locator('input').fill('123');
    await form.locator('textarea').fill('خیابان شریعتی، کوچه دوم');
    await form.getByRole('button', { name: 'ذخیره نشانی' }).click();
    await expect(form.locator('.field__err')).toBeVisible();

    await form.locator('.field', { hasText: 'کد پستی' }).locator('input').fill('1619637511');
    await form.getByRole('button', { name: 'ذخیره نشانی' }).click();

    const card = page.locator('.acc-addr');
    await expect(card).toHaveCount(1);
    /* the first address is automatically the default */
    await expect(card.first()).toHaveClass(/is-default/);
    await expect(card.first()).toContainText('دزفول');
    await expect(card.first()).toContainText('خانه پدری');
  });

  test('the password can be revealed while typing, on both login screens', async ({ page }) => {
    await gotoReady(page, '/shop/login');
    const field = page.locator('.auth-card .pw-field');
    const input = field.locator('input');
    const eye = field.locator('.pw-field__eye');

    await input.fill('a-secret-1404');
    await expect(input).toHaveAttribute('type', 'password');

    await eye.click();
    await expect(input).toHaveAttribute('type', 'text');
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    /* Revealing must not submit the half-typed form, which is what a button
       with no explicit type inside a form would do. */
    await expect(page).toHaveURL(/\/shop\/login/);
    await expect(input).toHaveValue('a-secret-1404');

    await eye.click();
    await expect(input).toHaveAttribute('type', 'password');

    /* and the same control on the admin login */
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });
    const adminField = page.locator('.admin__login-card .pw-field');
    await expect(adminField).toBeVisible({ timeout: 30_000 });
    await adminField.locator('input').fill('whatever');
    await adminField.locator('.pw-field__eye').click();
    await expect(adminField.locator('input')).toHaveAttribute('type', 'text');
  });

  test('phone numbers and postal codes are not printed as prices', async ({ page }) => {
    /* ۰۹۲۱۰۷۵۰۴۱۲ through a quantity formatter becomes ۹٬۲۱۰٬۷۵۰٬۴۱۲ — a
       price, not a number anyone can dial. Identifiers must never be
       grouped, and a date must never come out as «ناعدد». */
    const phone = uniquePhone();
    await gotoReady(page, '/shop');
    await signUpCustomer(page, { phone });
    await addAddress(page, { phone: '09210750412', postal: '1619637511' });

    await gotoReady(page, '/shop/account');
    const header = await page.locator('.acc-who span').innerText();
    expect(header, 'the account phone').not.toContain('٬');

    await page.locator('.acc-nav__item', { hasText: 'نشانی‌ها' }).click();
    const card = page.locator('.acc-addr').first();
    const meta = await card.locator('.acc-addr__meta').innerText();
    expect(meta, 'the receiver phone and postal code').not.toContain('٬');
    expect(meta).toContain('۰۹۲۱۰۷۵۰۴۱۲');
    expect(meta).toContain('۱۶۱۹۶۳۷۵۱۱');

    /* Order dates were running through the same formatter, which yields
       NaN for a date string. */
    await gotoReady(page, '/shop/dezmaye-gold-80');
    await page.locator('.sp-buy__row .btn').click();
    await gotoReady(page, '/shop/checkout');
    await page.locator('.checkout-form button[type="submit"]').click();
    await expect(page).toHaveURL(/\/shop\/order\//, { timeout: 20_000 });

    await gotoReady(page, '/shop/account');
    const order = await page.locator('.acc-order__body').first().innerText();
    expect(order, 'the order date').not.toContain('ناعدد');
    expect(order, 'the order date').not.toContain('NaN');
  });

  test('the account panel is not reachable without signing in', async ({ page }) => {
    await page.goto('/shop/account', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/shop\/login/, { timeout: 20_000 });
    await expect(page.locator('.auth-card')).toBeVisible();
  });

  test('the customers tab lists a new customer and can block them', async ({ page }) => {
    const phone = uniquePhone();
    await gotoReady(page, '/shop');
    await signUpCustomer(page, { phone, name: 'مشتری قابل مسدودسازی' });
    await addAddress(page);

    await loginAdmin(page);
    await page.locator('.admin__side button', { hasText: 'مشتریان' }).click();
    await expect(page.locator('.admin__panel h1')).toContainText('مشتریان');

    /* Search by the number as it was typed, with a leading zero — the
       stored form is 98…, so this only works if both sides are normalised. */
    await page.locator('.admin__search input').fill(phone);
    const row = page.locator('.cust__row', { hasText: 'مشتری قابل مسدودسازی' });
    await expect(row).toHaveCount(1);

    /* The phone is an identifier, not an amount: no thousands separators. */
    const shown = await row.locator('.cust__id small').innerText();
    expect(shown, 'the listed phone is not formatted as a price').not.toContain('٬');
    expect(shown.replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).toBe(phone);

    await row.click();
    const body = page.locator('.cust__detail');
    await expect(body).toContainText('دزفول'); // their address
    await expect(body).toContainText('نشانی‌ها');
    /* This customer registered and saved an address but never ordered, so
       the orders section must say so rather than render an empty table. */
    await expect(body).toContainText('سفارشی ثبت نشده است.');
    const addrPhone = await body.locator('.cust__addr dd[dir="ltr"]').first().innerText();
    expect(addrPhone, 'the address phone is not formatted as a price').not.toContain('٬');

    await body.getByRole('button', { name: 'مسدود کردن حساب' }).click();
    await expect(page.locator('.cust__pill.is-blocked')).toBeVisible();

    /* And the block is real: the customer's own session is gone. */
    const me = await page.request.get('/api/account/me');
    expect((await me.json()).customer).toBeNull();
  });

  test('the payment tab offers the gateway tools and hides what it cannot do', async ({ page }) => {
    await loginAdmin(page);
    await page.locator('.admin__side button', { hasText: 'درگاه پرداخت' }).click();
    await expect(page.locator('.admin__panel h1')).toContainText('زرین‌پال');

    /* With no merchant id configured the panel must say so plainly rather
       than offering buttons that are guaranteed to fail. */
    await expect(page.locator('.pay__state')).toHaveAttribute('data-ok', '0');
    /* exact: 'بررسی' is also a prefix of 'بررسی وضعیت' */
    await expect(page.getByRole('button', { name: 'بررسی', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'محاسبه' })).toBeDisabled();

    /* The ledger needs credentials the payment path does not, and says so. */
    await expect(page.locator('.pay__tool', { hasText: 'لیست تراکنش‌های ترمینال' })).toContainText('Access Token');

    /* Choosing ZarinPal reveals the credential fields; IDPay is gone. */
    const provider = page.locator('.admin__panel select').first();
    await expect(provider.locator('option')).toHaveCount(2);
    await expect(page.locator('.admin__panel')).not.toContainText('آیدی‌پی');
    await provider.selectOption('zarinpal');
    await expect(page.getByText('Merchant ID', { exact: false }).first()).toBeVisible();
  });

  test('the admin can see that a code was sent, but not the customer password', async ({ page }) => {
    const phone = uniquePhone();
    await gotoReady(page, '/shop');
    await signUpCustomer(page, { phone, password: 'super-secret-1404' });

    await loginAdmin(page);
    await page.locator('.admin__side button', { hasText: 'پیامک' }).click();
    await expect(page.locator('.admin__panel h1')).toContainText('پیامک');
    await expect(page.locator('.admin__list')).toContainText(phone.replace(/^0/, '98'));
    await expect(page.locator('body')).not.toContainText('super-secret-1404');
  });
});
