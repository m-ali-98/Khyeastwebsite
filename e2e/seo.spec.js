import { test, expect } from '@playwright/test';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { listIndexablePaths } from '../shared/seo.js';
import { gotoReady, routeSettled, watchConsole } from './helpers.js';

const jsonLd = (html) => {
  const match = html.match(/<script id="seo-jsonld" type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(match, 'route has JSON-LD before JavaScript executes').toBeTruthy();
  return JSON.parse(match[1]);
};

test('robots and the multilingual sitemap are real protocol responses', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toContain('text/plain');
  const origin = new URL(robots.url()).origin;
  expect(await robots.text()).toContain(`Sitemap: ${origin}/sitemap.xml`);

  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()['content-type']).toContain('application/xml');
  const xml = await sitemap.text();
  expect((xml.match(/<url>/g) || [])).toHaveLength(listIndexablePaths(DEFAULT_STATE).length);
  expect(xml).toContain(`${origin}/gallery`);
  expect(xml).toContain(`${origin}/en/gallery`);
  expect(xml).toContain(`${origin}/ar/gallery`);
  expect(xml).toContain('hreflang="fa"');
  expect(xml).toContain('hreflang="en"');
  expect(xml).toContain('hreflang="ar"');
  expect(xml).toContain('hreflang="x-default"');
  expect(xml).not.toContain('/shop/account');
  expect(xml).not.toContain('/en/shop');
});

test('a direct localized request contains route content and complete metadata', async ({ request }) => {
  const response = await request.get('/en/about');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-language']).toBe('en');
  const origin = new URL(response.url()).origin;
  const html = await response.text();
  expect(html).toContain('<html lang="en" dir="ltr"');
  expect(html).toContain('<title>About Khuzestan Yeast Co.</title>');
  expect(html).toContain('<h1>About Khuzestan Yeast Co.</h1>');
  expect(html).toContain(`rel="canonical" href="${origin}/en/about"`);
  expect(html).toContain(`hreflang="x-default" href="${origin}/about"`);
  expect(html).toContain('property="og:image"');
  expect(html).toContain('name="twitter:card" content="summary_large_image"');
  expect(html).toContain('content="index, follow, max-image-preview:large');
});

test('product and article pages publish truthful structured data', async ({ request }) => {
  const productHtml = await (await request.get('/products/dezmaye-gold-80')).text();
  const productGraph = jsonLd(productHtml)['@graph'];
  const product = productGraph.find((entry) => entry['@type'] === 'Product');
  expect(product.name).toContain('دزمایه');
  expect(product.offers.priceCurrency).toBe('IRR');
  expect(product.offers.availability).toContain('InStock');
  expect(productGraph.some((entry) => entry['@type'] === 'BreadcrumbList')).toBeTruthy();

  const postHtml = await (await request.get('/blog/reduce-bread-production-costs')).text();
  const article = jsonLd(postHtml)['@graph'].find((entry) => entry['@type'] === 'BlogPosting');
  expect(article.headline).toContain('هزینه‌های تولید نان');
  expect(article.datePublished).toBe('2026-08-16');
  expect(article.publisher['@id']).toContain('#organization');
});

test('private and transaction screens can work but cannot enter search results', async ({ request }) => {
  for (const path of ['/admin', '/shop/login', '/shop/account', '/shop/cart', '/shop/checkout', '/shop/order/KY-PRIVATE']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['x-robots-tag'], path).toContain('noindex');
    const html = await response.text();
    expect(html, path).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(html, path).not.toContain('rel="canonical"');
  }
});

test('unknown and invalid-locale routes return genuine noindex 404s', async ({ request }) => {
  for (const path of ['/definitely-missing', '/administrator', '/products/not-a-product', '/blog/not-a-post', '/shop/cart/extra', '/shop/order', '/en/shop', '/en/shop/account', '/ar/shop', '/seo-pages/home-fa.html', '/SEO-PAGES/home-fa.html']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(response.headers()['x-robots-tag'], path).toContain('noindex');
    expect(await response.text(), path).toContain('noindex, nofollow, noarchive');
  }
});

test('legacy, prefixed and slash duplicates are permanent redirects', async ({ request }) => {
  const cases = [
    ['/dezmaye', '/products/dezmaye-gold-80'],
    ['/en/dezmaye', '/en/products/dezmaye-gold-80'],
    ['/fa/dezmaye/', '/products/dezmaye-gold-80'],
    ['/nanmaye', '/products/nanmaye-500'],
    ['/ar/nanmaye', '/ar/products/nanmaye-500'],
    ['/fa/products', '/products'],
    ['/about/', '/about'],
    ['/index.html', '/'],
  ];
  for (const [from, to] of cases) {
    const response = await request.get(from, { maxRedirects: 0 });
    expect(response.status(), from).toBe(301);
    expect(new URL(response.headers().location, response.url()).pathname, from).toBe(to);
  }
});

test('the Persian shop never claims nonexistent English or Arabic equivalents', async ({ request }) => {
  const shopResponse = await request.get('/shop');
  const origin = new URL(shopResponse.url()).origin;
  const shop = await shopResponse.text();
  expect(shop).toContain(`rel="canonical" href="${origin}/shop"`);
  expect(shop).not.toContain(`href="${origin}/en/shop"`);
  expect(shop).not.toContain(`href="${origin}/ar/shop"`);

  const product = await (await request.get('/shop/dezmaye-gold-80')).text();
  expect(product).toContain(`rel="canonical" href="${origin}/products/dezmaye-gold-80"`);
  expect(product).not.toContain('hreflang=');

  const standalone = await (await request.get('/shop/nanmaye-10')).text();
  expect(standalone).toContain(`rel="canonical" href="${origin}/shop/nanmaye-10"`);
  expect(standalone).not.toContain(`href="${origin}/en/shop/nanmaye-10"`);
  expect(standalone).not.toContain(`href="${origin}/ar/shop/nanmaye-10"`);
});

test('client navigation replaces title, canonical, social metadata and JSON-LD', async ({ page }) => {
  const errors = watchConsole(page);
  await gotoReady(page, '/en/about');
  const origin = new URL(page.url()).origin;
  await expect(page).toHaveTitle('About Khuzestan Yeast Co.');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}/en/about`);

  await page.locator('.nav__links a[href="/en/products"]').click();
  await routeSettled(page, /\/en\/products$/);
  await expect(page).toHaveTitle(/products/i);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `${origin}/en/products`);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `${origin}/en/products`);
  await expect(page.locator('#seo-jsonld')).toHaveCount(1);
  expect(errors).toEqual([]);
});
