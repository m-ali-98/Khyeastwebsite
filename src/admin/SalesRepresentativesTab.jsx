import { useEffect, useMemo, useState } from 'react';
import { Icons } from '../components/ui';
import { useContent } from '../content/ContentContext';
import {
  IRAN_PROVINCES,
  IRAN_SALES_CITIES,
  MAX_SALES_REPRESENTATIVES,
  findIranSalesCity,
  normalizeSalesRepresentatives,
  salesRepresentativeProblem,
} from '../../shared/salesRepresentatives.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const freshId = () => `sales-rep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const newRepresentative = () => {
  const city = findIranSalesCity('تهران', 'تهران');
  return {
    id: freshId(),
    province: 'تهران',
    city: 'تهران',
    name: '',
    phone: '',
    brands: '',
    latitude: city.latitude,
    longitude: city.longitude,
    active: true,
  };
};

const problemMessage = (problem) => {
  if (!problem) return '';
  const row = problem.index >= 0 ? `ردیف ${(problem.index + 1).toLocaleString('fa-IR')}: ` : '';
  const messages = {
    'not-array': 'ساختار فهرست نمایندگان معتبر نیست.',
    'too-many': `حداکثر ${MAX_SALES_REPRESENTATIVES.toLocaleString('fa-IR')} نماینده قابل ثبت است.`,
    'invalid-row': 'ساختار نماینده معتبر نیست.',
    'invalid-field-type': 'نوع یکی از فیلدهای نماینده معتبر نیست.',
    'invalid-active': 'وضعیت فعالیت نماینده معتبر نیست.',
    'invalid-id': 'شناسه داخلی نماینده معتبر نیست.',
    'duplicate-id': 'شناسه داخلی دو نماینده تکراری است.',
    'invalid-province': 'استان را از فهرست انتخاب کنید.',
    'invalid-city': 'نام شهر باید بین ۲ تا ۱۰۰ نویسه باشد.',
    'invalid-name': 'نام نماینده باید بین ۲ تا ۲۰۰ نویسه باشد.',
    'invalid-phone': 'شماره تماس باید فقط شامل رقم و نشانه‌های متداول شماره‌گیری باشد.',
    'invalid-brands': 'نام برندها بیش از حد طولانی است.',
    'invalid-coordinate': 'مختصات باید داخل محدوده ایران باشد؛ شهر شناخته‌شده را انتخاب کنید یا مختصات را اصلاح کنید.',
  };
  return row + (messages[problem.code] || 'اطلاعات نماینده کامل یا معتبر نیست.');
};

export default function SalesRepresentativesTab() {
  const { state, save } = useContent();
  const source = state.collections?.salesRepresentatives || [];
  const sourceKey = JSON.stringify(source);
  const [items, setItems] = useState(() => clone(normalizeSalesRepresentatives(source)));
  const [editor, setEditor] = useState(null);
  const [query, setQuery] = useState('');
  const [provinceFilter, setProvinceFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState({ type: '', text: '' });

  useEffect(() => {
    setItems(clone(normalizeSalesRepresentatives(source)));
    setEditor(null);
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fa');
    return items.filter((item) => (
      (!provinceFilter || item.province === provinceFilter) &&
      (!needle || `${item.name} ${item.city} ${item.province} ${item.phone} ${item.brands}`.toLocaleLowerCase('fa').includes(needle))
    ));
  }, [items, provinceFilter, query]);
  const activeCount = items.filter((item) => item.active).length;
  const provinceCount = new Set(items.filter((item) => item.active).map((item) => item.province)).size;
  const cityOptions = IRAN_SALES_CITIES.filter((item) => !editor?.province || item.province === editor.province);

  const locateCity = (draft = editor, { alertMissing = false } = {}) => {
    const known = findIranSalesCity(draft?.city, draft?.province);
    if (!known) {
      if (alertMissing) window.alert('این شهر در فهرست آماده نیست؛ عرض و طول جغرافیایی را به‌صورت دستی وارد کنید.');
      return draft;
    }
    const located = { ...draft, latitude: known.latitude, longitude: known.longitude };
    setEditor(located);
    return located;
  };

  const applyEditor = () => {
    const located = findIranSalesCity(editor.city, editor.province)
      ? { ...editor, ...findIranSalesCity(editor.city, editor.province) }
      : editor;
    /* Keep the public field names; the city catalogue also contains province
       and city and therefore may safely canonicalise Persian spelling. */
    const candidate = {
      ...located,
      id: editor.id,
      name: editor.name,
      phone: editor.phone,
      brands: editor.brands,
      active: editor.active !== false,
    };
    const normalized = normalizeSalesRepresentatives([candidate])[0];
    const problem = salesRepresentativeProblem([normalized]);
    if (problem) return window.alert(problemMessage(problem));
    setItems((current) => {
      const exists = current.some((item) => item.id === normalized.id);
      return exists
        ? current.map((item) => (item.id === normalized.id ? normalized : item))
        : [normalized, ...current];
    });
    setEditor(null);
    setNotice({ type: 'info', text: 'تغییر در پیش‌نویس ثبت شد؛ برای نمایش در سایت، «ذخیره و انتشار» را بزنید.' });
  };

  const remove = (item) => {
    if (!window.confirm(`نماینده «${item.name}» در ${item.city} حذف شود؟`)) return;
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    if (editor?.id === item.id) setEditor(null);
    setNotice({ type: 'info', text: 'نماینده از پیش‌نویس حذف شد؛ برای اعمال نهایی، تغییرات را منتشر کنید.' });
  };

  const publish = async () => {
    const normalized = normalizeSalesRepresentatives(items);
    const problem = salesRepresentativeProblem(normalized);
    if (problem) return setNotice({ type: 'error', text: problemMessage(problem) });
    setSaving(true);
    setNotice({ type: '', text: '' });
    try {
      await save({
        ...state,
        collections: { ...state.collections, salesRepresentatives: normalized },
      }, { optimistic: false });
      setItems(clone(normalized));
      setNotice({ type: 'success', text: 'فهرست نمایندگان ذخیره و روی نقشه سایت منتشر شد.' });
    } catch (error) {
      setNotice({ type: 'error', text: error?.message || 'ذخیره فهرست نمایندگان ممکن نشد.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="admin__panel admin-reps" data-testid="admin-sales-representatives">
      <div className="admin__head admin-reps__head">
        <div>
          <p className="admin__eyebrow">شبکه فروش داخلی</p>
          <h1>نمایندگان فروش</h1>
          <p>نمایندگان این بخش فقط در نسخه فارسی و روی نقشه ایران نمایش داده می‌شوند.</p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setEditor(newRepresentative())}
          disabled={items.length >= MAX_SALES_REPRESENTATIVES}
        >
          <Icons.pin size={17} /> افزودن نماینده
        </button>
      </div>

      <div className="admin-reps__stats" aria-label="خلاصه شبکه فروش">
        <div><strong>{activeCount.toLocaleString('fa-IR')}</strong><span>نماینده فعال</span></div>
        <div><strong>{provinceCount.toLocaleString('fa-IR')}</strong><span>استان تحت پوشش</span></div>
        <div><strong>{new Set(items.filter((item) => item.active).map((item) => item.city)).size.toLocaleString('fa-IR')}</strong><span>شهر روی نقشه</span></div>
      </div>

      {editor && (
        <section className="admin-reps__editor" aria-labelledby="admin-rep-editor-title">
          <div className="admin-reps__editor-head">
            <div>
              <span>اطلاعات نماینده</span>
              <h2 id="admin-rep-editor-title">{items.some((item) => item.id === editor.id) ? 'ویرایش نماینده' : 'نماینده جدید'}</h2>
            </div>
            <button type="button" className="admin__iconbtn" onClick={() => setEditor(null)} aria-label="بستن ویرایشگر">×</button>
          </div>
          <div className="admin-reps__form">
            <label>
              <span>استان *</span>
              <select
                value={editor.province}
                onChange={(event) => setEditor({ ...editor, province: event.target.value, city: '', latitude: '', longitude: '' })}
              >
                {IRAN_PROVINCES.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}
              </select>
            </label>
            <label>
              <span>شهر *</span>
              <input
                value={editor.city}
                list="admin-sales-cities"
                onChange={(event) => setEditor({ ...editor, city: event.target.value })}
                onBlur={() => locateCity()}
                placeholder="مثلاً گرگان"
              />
              <datalist id="admin-sales-cities">
                {cityOptions.map((item) => <option key={`${item.province}-${item.city}`} value={item.city} />)}
              </datalist>
            </label>
            <label className="admin-reps__wide">
              <span>نام شخص یا شرکت *</span>
              <input value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={200} />
            </label>
            <label>
              <span>شماره تماس</span>
              <input type="tel" dir="ltr" value={editor.phone} onChange={(event) => setEditor({ ...editor, phone: event.target.value })} maxLength={40} placeholder="0912…" />
            </label>
            <label>
              <span>برندهای تحت پوشش</span>
              <input value={editor.brands} onChange={(event) => setEditor({ ...editor, brands: event.target.value })} maxLength={200} placeholder="دزمایه، شتاب، نان مایه…" />
            </label>
            <details className="admin-reps__coordinates admin-reps__wide">
              <summary>موقعیت روی نقشه</summary>
              <p>برای شهرهای فهرست‌شده مختصات خودکار تکمیل می‌شود. برای شهر دیگر، مختصات را وارد کنید.</p>
              <div>
                <label>
                  <span>عرض جغرافیایی</span>
                  <input type="number" dir="ltr" min="24" max="40" step="0.000001" value={editor.latitude} onChange={(event) => setEditor({ ...editor, latitude: event.target.value })} />
                </label>
                <label>
                  <span>طول جغرافیایی</span>
                  <input type="number" dir="ltr" min="44" max="64" step="0.000001" value={editor.longitude} onChange={(event) => setEditor({ ...editor, longitude: event.target.value })} />
                </label>
                <button type="button" onClick={() => locateCity(editor, { alertMissing: true })}><Icons.refresh size={15} /> یافتن خودکار شهر</button>
              </div>
            </details>
            <label className="admin-reps__active admin-reps__wide">
              <input type="checkbox" checked={editor.active !== false} onChange={(event) => setEditor({ ...editor, active: event.target.checked })} />
              <span>نمایش این نماینده در سایت</span>
            </label>
          </div>
          <div className="admin-reps__editor-actions">
            <button type="button" className="btn btn--outline" onClick={() => setEditor(null)}>انصراف</button>
            <button type="button" className="btn btn--primary" onClick={applyEditor}>ثبت در پیش‌نویس</button>
          </div>
        </section>
      )}

      <div className="admin-reps__filters">
        <label>
          <Icons.search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جست‌وجوی نام، شهر، شماره یا برند" />
        </label>
        <select value={provinceFilter} onChange={(event) => setProvinceFilter(event.target.value)} aria-label="فیلتر استان">
          <option value="">همه استان‌ها</option>
          {IRAN_PROVINCES.map((item) => <option key={item.code} value={item.name}>{item.name}</option>)}
        </select>
        <span>{filtered.length.toLocaleString('fa-IR')} نتیجه</span>
      </div>

      {filtered.length ? (
        <div className="admin-reps__list">
          {filtered.map((item) => (
            <article className={`admin-reps__row${item.active ? '' : ' is-inactive'}`} key={item.id}>
              <span className="admin-reps__row-pin"><Icons.pin size={18} /></span>
              <div className="admin-reps__row-main">
                <div><h3>{item.name}</h3>{!item.active && <span>غیرفعال</span>}</div>
                <p>{item.city}، {item.province}{item.brands ? ` · ${item.brands}` : ''}</p>
                {item.phone && <bdi dir="ltr">{item.phone}</bdi>}
              </div>
              <div className="admin-reps__row-actions">
                <button
                  type="button"
                  className="admin__iconbtn"
                  onClick={() => setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, active: !entry.active } : entry))}
                  aria-label={item.active ? `غیرفعال کردن ${item.name}` : `فعال کردن ${item.name}`}
                  title={item.active ? 'غیرفعال کردن' : 'فعال کردن'}
                ><Icons.eye size={16} /></button>
                <button type="button" className="admin__iconbtn" onClick={() => setEditor(clone(item))} aria-label={`ویرایش ${item.name}`}><Icons.edit size={16} /></button>
                <button type="button" className="admin__iconbtn danger" onClick={() => remove(item)} aria-label={`حذف ${item.name}`}><Icons.trash size={16} /></button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="admin-empty"><Icons.search size={30} /><strong>نماینده‌ای با این فیلتر پیدا نشد.</strong></div>
      )}

      {notice.text && <p className={`admin-reps__notice is-${notice.type}`} role="status">{notice.text}</p>}
      <div className="admin-reps__savebar">
        <p>افزودن، حذف، ویرایش یا تغییر وضعیت تا زمان انتشار فقط در پیش‌نویس این صفحه می‌ماند.</p>
        <div>
          <a href="/sales-representatives" target="_blank" rel="noreferrer">پیش‌نمایش نقشه</a>
          <button type="button" className="btn btn--primary" onClick={publish} disabled={saving || Boolean(editor)}>
            {saving ? 'در حال ذخیره…' : 'ذخیره و انتشار'}
          </button>
        </div>
      </div>
    </div>
  );
}
