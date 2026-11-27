import { useEffect, useState } from 'react';
import { api } from '../content/ContentContext';
import { validGoogleTagId } from '../../shared/googleTag.js';
import AdminState from './AdminState';

export default function GoogleTagTab() {
  const [id, setId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api('/api/admin/google-tag').then((data) => {
      if (active) setId(data.id);
    }).catch((err) => {
      if (active) setError(err.status === 401 ? 'نشست مدیر منقضی شده است.' : 'دریافت تنظیمات ممکن نشد.');
    });
    return () => { active = false; };
  }, []);

  const save = async (event) => {
    event.preventDefault();
    const next = id.trim();
    setMessage('');
    if (!validGoogleTagId(next)) {
      setError('شناسه باید مانند GTM-NFTZ2BZ2 باشد، یا برای غیرفعال‌سازی خالی بماند.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/admin/google-tag', { method: 'PUT', body: { id: next } });
      setId(result.id);
      setMessage('تنظیمات ذخیره شد؛ تغییر برای بارگذاری‌های بعدی صفحات عمومی اعمال می‌شود.');
    } catch (err) {
      setError(err.status === 401 ? 'نشست مدیر منقضی شده است.' : 'ذخیره تنظیمات ممکن نشد.');
    } finally {
      setBusy(false);
    }
  };

  if (id === null && !error) return <div className="admin__panel"><AdminState kind="loading" icon="refresh" title="در حال دریافت تنظیمات…" /></div>;
  return (
    <div className="admin__panel" data-testid="admin-google-tag">
      <div className="admin__head"><div><h1>تگ گوگل</h1><p>شناسه کانتینر Google Tag Manager برای صفحات عمومی</p></div></div>
      <p className="admin__hint">شناسه را برای غیرفعال کردن تگ خالی بگذارید. تغییرات در بازدید یا بارگذاری بعدی صفحه اعمال می‌شود، نه در صفحه‌ای که از قبل باز است.</p>
      <p className="admin__hint">کانتینر می‌تواند کد و ابزارهای ردیابی اجرا کند. فقط کانتینر مورد اعتماد را وارد کنید و تنظیمات حریم خصوصی و رضایت بازدیدکنندگان را بررسی کنید. سیاست امنیتی سایت فقط مبدأهای مجاز گوگل را پشتیبانی می‌کند؛ تگ‌های دیگر ممکن است مسدود شوند.</p>
      {id !== null && <form onSubmit={save} style={{ display: 'grid', gap: 16, maxWidth: 480 }}>
        <label className="field" htmlFor="google-tag-id">
          <span>شناسه کانتینر</span>
          <input id="google-tag-id" type="text" dir="ltr" value={id} onChange={(event) => setId(event.target.value)} placeholder="GTM-NFTZ2BZ2" maxLength={24} autoComplete="off" />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'در حال ذخیره…' : 'ذخیره تگ گوگل'}</button>
      </form>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
