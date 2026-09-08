/* ==========================================================================
   Online shop routes — orders, comments & payment callbacks.
   Public content (shop products / display settings) lives in content.json
   and is editable from the admin panel like every other content.
   Orders, comments and PAYMENT CREDENTIALS live in shop.json (server only;
   credentials are never exposed to the public API).
   ========================================================================== */
import express from 'express';
import crypto from 'node:crypto';
import DEFAULT_STATE from '../shared/contentDefaults.js';
import { createPayment, verifyPayment, normalizePayment } from './payment.js';

export const SHOP_SEED = () => ({
  orders: [],
  comments: [
    {
      id: 'c-demo-1',
      slug: 'dezmaye-gold-80',
      name: 'رضا کریمی',
      text: 'سلام، آیا ارسال به مشهد دارید؟ کیفیت دزمایه گلد برای نانوایی فانتزی واقعاً عالیه.',
      at: new Date(Date.now() - 4 * 864e5).toISOString(),
      approved: true,
      reply: 'سلام و احترام؛ بله، ارسال به سراسر ایران داریم. سپاس از همراهی شما — واحد فروش خمیرمایه خوزستان',
      replyAt: new Date(Date.now() - 3 * 864e5).toISOString(),
    },
    {
      id: 'c-demo-2',
      slug: 'xpower-70',
      name: 'مریم احمدی',
      text: 'ایکس پاور برای نان باگت و شیرینی‌های تخمیری تفاوت محسوسی ایجاد کرد. ممنون از تیم کیفیت.',
      at: new Date(Date.now() - 2 * 864e5).toISOString(),
      approved: true,
      reply: null,
      replyAt: null,
    },
    {
      id: 'c-demo-3',
      slug: 'nanmaye-10',
      name: 'نانوایی صنعتی برکت',
      text: 'برای سفارش عمده کارتن ۱۰ کیلویی، امکان هماهنگی باربری و فاکتور رسمی وجود دارد؟',
      at: new Date(Date.now() - 1 * 864e5).toISOString(),
      approved: true,
      reply: 'بله؛ لطفاً با واحد فروش (۰۲۱-۸۶۰۸۶۲۶۷) هماهنگ بفرمایید تا پیش‌فاکتور رسمی صادر شود.',
      replyAt: new Date(Date.now() - 20 * 36e5).toISOString(),
    },
  ],
  payment: { provider: 'offline', zarinpalMerchant: '', idpayApiKey: '', idpaySandbox: true, callbackBase: '' },
});

const ORDER_STATUS = ['pending_payment', 'paid', 'shipped', 'delivered', 'cancelled'];
const rand = (n) => crypto.randomBytes(n).toString('hex');
const orderCode = () => `KY-${Date.now().toString(36).slice(-5).toUpperCase()}${rand(2).toUpperCase()}`;

/* tiny in-memory rate limit: max 5 public writes / 10 min / ip */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 5;
}

export function createShopRouter({ CONTENT_FILE, SHOP_FILE, readJSON, writeJSON, requireAuth }) {
  const r = express.Router();
  const shopFile = () => readJSON(SHOP_FILE);
  const saveShopFile = (v) => writeJSON(SHOP_FILE, v);
  const content = () => {
    try {
      return readJSON(CONTENT_FILE);
    } catch {
      return DEFAULT_STATE;
    }
  };
  const shopContent = () => content().shop || DEFAULT_STATE.shop;
  const publicOrder = (o) => {
    const { token, ...rest } = o;
    return rest;
  };

  /* ---------------- public ---------------- */
  r.get('/api/shop-public', (_req, res) => {
    const sf = shopFile();
    const shop = shopContent();
    res.json({
      display: shop.display || DEFAULT_STATE.shop.display,
      paymentProvider: normalizePayment(sf.payment).provider,
      comments: (sf.comments || [])
        .filter((c) => c.approved)
        .map(({ id, slug, name, text, at, reply, replyAt }) => ({ id, slug, name, text, at, reply, replyAt })),
    });
  });

  r.post('/api/shop-public/comments', (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'rate limited' });
    const { slug, name, text } = req.body || {};
    if (!slug || !name || !text) return res.status(400).json({ error: 'fields required' });
    const shop = shopContent();
    const product = (shop.products || []).find((p) => p.slug === String(slug));
    if (!product || !product.active) return res.status(404).json({ error: 'product not found' });
    if (!shop.display?.commentsEnabled || product.commentsLocked)
      return res.status(403).json({ error: 'comments closed' });
    const sf = shopFile();
    const item = {
      id: `c-${rand(6)}`,
      slug: product.slug,
      name: String(name).slice(0, 120),
      text: String(text).slice(0, 1500),
      at: new Date().toISOString(),
      approved: !shop.display?.commentsRequireApproval,
      reply: null,
      replyAt: null,
    };
    sf.comments.unshift(item);
    saveShopFile(sf);
    res.json({ ok: true, id: item.id, pending: !item.approved });
  });

  r.post('/api/shop-public/orders', async (req, res) => {
    if (rateLimited(req.ip)) return res.status(429).json({ error: 'rate limited' });
    const { items, customer } = req.body || {};
    const shop = shopContent();
    if (!shop.display?.enabled) return res.status(403).json({ error: 'shop disabled' });
    if (!Array.isArray(items) || !items.length || items.length > 50)
      return res.status(400).json({ error: 'invalid items' });
    const c = customer || {};
    const name = String(c.name || '').trim();
    const phone = String(c.phone || '').trim();
    const city = String(c.city || '').trim();
    const address = String(c.address || '').trim();
    if (name.length < 3 || city.length < 2 || address.length < 10)
      return res.status(400).json({ error: 'customer fields required' });
    if (!/^(\+98|0098|0)?9\d{9}$/.test(phone.replace(/[\s-]/g, '')))
      return res.status(400).json({ error: 'invalid phone' });

    /* price strictly server-side */
    const lines = [];
    let subtotal = 0;
    for (const it of items) {
      const product = (shop.products || []).find((p) => p.slug === String(it?.slug));
      if (!product || !product.active) return res.status(400).json({ error: `unknown product: ${it?.slug}` });
      const qty = Math.max(1, Math.min(999, parseInt(it?.qty, 10) || 1));
      if (Number(product.stock) >= 0 && qty > Number(product.stock))
        return res.status(409).json({ error: 'insufficient stock' });
      const price = Math.max(0, Math.round(Number(product.price) || 0));
      lines.push({ slug: product.slug, title: product.title, unit: product.unit || '', price, qty, sum: price * qty });
      subtotal += price * qty;
    }
    const d = shop.display;
    const freeOver = Number(d.freeShippingOver) || 0;
    const shipping = freeOver > 0 && subtotal >= freeOver ? 0 : Math.max(0, Math.round(Number(d.shippingCost) || 0));
    const total = subtotal + shipping;

    const order = {
      id: crypto.randomUUID(),
      code: orderCode(),
      token: rand(16),
      items: lines,
      customer: {
        name: name.slice(0, 200),
        phone: phone.slice(0, 20),
        city: city.slice(0, 100),
        address: address.slice(0, 600),
        postal: String(c.postal || '').slice(0, 20),
        note: String(c.note || '').slice(0, 1000),
      },
      subtotal,
      shipping,
      total,
      currency: 'IRR',
      status: 'pending_payment',
      provider: 'offline',
      payRef: null,
      adminNote: '',
      at: new Date().toISOString(),
      paidAt: null,
    };

    /* decrement stock */
    const doc = content();
    for (const line of order.items) {
      const product = doc.shop.products.find((p) => p.slug === line.slug);
      if (product && Number(product.stock) >= 0) product.stock = Math.max(0, Number(product.stock) - line.qty);
    }
    writeJSON(CONTENT_FILE, doc);

    /* payment */
    const sf = shopFile();
    const payment = normalizePayment(sf.payment);
    const origin = payment.callbackBase || `${req.protocol}://${req.get('host')}`;
    let pay = { provider: 'offline', ref: null, payUrl: null };
    if (payment.provider !== 'offline') {
      try {
        pay = await createPayment(payment, order, { origin });
      } catch (e) {
        console.error('[shop] gateway error:', e.message);
        pay = { provider: 'offline', ref: null, payUrl: null, gatewayError: true };
      }
    }
    order.provider = pay.provider;
    order.payRef = pay.ref;

    sf.orders.unshift(order);
    saveShopFile(sf);
    res.json({
      ok: true,
      order: { code: order.code, token: order.token, total: order.total, status: order.status, provider: order.provider },
      payment: { provider: pay.provider, payUrl: pay.payUrl || null, gatewayError: !!pay.gatewayError },
    });
  });

  /* retry payment for a pending order */
  r.post('/api/shop-public/orders/:code/pay', async (req, res) => {
    const sf = shopFile();
    const order = sf.orders.find((o) => o.code === req.params.code);
    if (!order) return res.status(404).json({ error: 'not found' });
    if (req.body?.token !== order.token) return res.status(403).json({ error: 'invalid token' });
    if (order.status !== 'pending_payment') return res.status(409).json({ error: 'order already processed' });
    const payment = normalizePayment(sf.payment);
    if (payment.provider === 'offline') return res.status(409).json({ error: 'online payment disabled' });
    const origin = payment.callbackBase || `${req.protocol}://${req.get('host')}`;
    try {
      const pay = await createPayment(payment, order, { origin });
      order.provider = pay.provider;
      order.payRef = pay.ref;
      saveShopFile(sf);
      res.json({ ok: true, payment: { provider: pay.provider, payUrl: pay.payUrl } });
    } catch (e) {
      res.status(502).json({ error: 'gateway error' });
    }
  });

  /* order tracking (needs the private order token) */
  r.get('/api/shop-public/orders/:code', (req, res) => {
    const sf = shopFile();
    const order = sf.orders.find((o) => o.code === req.params.code);
    if (!order || req.query.token !== order.token) return res.status(404).json({ error: 'not found' });
    res.json({ order: publicOrder(order) });
  });

  /* ---------------- gateway callbacks ---------------- */
  r.get('/api/shop-pay/:provider/callback', async (req, res) => {
    const sf = shopFile();
    const provider = req.params.provider;
    if (!['zarinpal', 'idpay'].includes(provider)) return res.status(404).send('unknown gateway');
    const code = provider === 'zarinpal' ? String(req.query.code || '') : String(req.query.order_id || '');
    const order = sf.orders.find((o) => o.code === code);
    if (!order) return res.status(404).send('unknown order');
    let ok = false;
    let ref = '';
    try {
      const out = await verifyPayment(sf.payment, provider, req.query);
      ok = out.ok;
      ref = out.ref;
    } catch (e) {
      console.error('[shop] verify error:', e.message);
    }
    if (ok && order.status === 'pending_payment') {
      order.status = 'paid';
      order.provider = provider;
      order.payRef = ref || order.payRef;
      order.paidAt = new Date().toISOString();
      saveShopFile(sf);
    }
    res.redirect(`/shop/order/${encodeURIComponent(order.code)}?pay=${ok ? 'ok' : 'fail'}`);
  });

  /* ---------------- admin ---------------- */
  r.get('/api/shop-admin', requireAuth, (_req, res) => {
    const sf = shopFile();
    res.json({ orders: sf.orders || [], comments: sf.comments || [] });
  });

  r.patch('/api/shop-admin/comments/:id', requireAuth, (req, res) => {
    const sf = shopFile();
    const item = sf.comments.find((c) => c.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    if ('approved' in b) item.approved = Boolean(b.approved);
    if ('reply' in b) {
      item.reply = b.reply === null || String(b.reply).trim() === '' ? null : String(b.reply).slice(0, 2000);
      item.replyAt = item.reply ? new Date().toISOString() : null;
    }
    saveShopFile(sf);
    res.json({ ok: true });
  });

  r.delete('/api/shop-admin/comments/:id', requireAuth, (req, res) => {
    const sf = shopFile();
    sf.comments = (sf.comments || []).filter((c) => c.id !== req.params.id);
    saveShopFile(sf);
    res.json({ ok: true });
  });

  r.patch('/api/shop-admin/orders/:id', requireAuth, (req, res) => {
    const sf = shopFile();
    const order = sf.orders.find((o) => o.id === req.params.id);
    if (!order) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    if ('status' in b && ORDER_STATUS.includes(b.status)) {
      order.status = b.status;
      if (b.status === 'paid' && !order.paidAt) order.paidAt = new Date().toISOString();
    }
    if ('adminNote' in b) order.adminNote = String(b.adminNote || '').slice(0, 1000);
    saveShopFile(sf);
    res.json({ ok: true });
  });

  r.delete('/api/shop-admin/orders/:id', requireAuth, (req, res) => {
    const sf = shopFile();
    sf.orders = (sf.orders || []).filter((o) => o.id !== req.params.id);
    saveShopFile(sf);
    res.json({ ok: true });
  });

  r.get('/api/shop-admin/payment', requireAuth, (_req, res) => {
    res.json(normalizePayment(shopFile().payment));
  });

  r.put('/api/shop-admin/payment', requireAuth, (req, res) => {
    const sf = shopFile();
    sf.payment = normalizePayment(req.body || {});
    saveShopFile(sf);
    res.json({ ok: true, payment: sf.payment });
  });

  return r;
}
