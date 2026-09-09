/* ==========================================================================
   Initial shop data (used the first time the database is created).
   ========================================================================== */
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
      reply: 'بله؛ لطفاً با واحد فروش (۰۲۱-۲۲۵۸۲۹۷۷) هماهنگ بفرمایید تا پیش‌فاکتور رسمی صادر شود.',
      replyAt: new Date(Date.now() - 20 * 36e5).toISOString(),
    },
  ],
  payment: { provider: 'offline', zarinpalMerchant: '', idpayApiKey: '', idpaySandbox: true, callbackBase: '' },
});
