/* Which language the admin is currently editing. Persian edits the base
   content (the normal tabs); English and Arabic edit the translation layer. */
import { createContext, useContext, useMemo, useState } from 'react';

const Ctx = createContext(null);

export const ADMIN_LOCALES = [
  { code: 'fa', label: 'فارسی', flag: 'FA' },
  { code: 'en', label: 'English', flag: 'EN' },
  { code: 'ar', label: 'العربية', flag: 'AR' },
];

export function AdminLocaleProvider({ children }) {
  const [locale, setLocale] = useState('fa');
  const value = useMemo(() => ({ locale, setLocale, isBase: locale === 'fa', locales: ADMIN_LOCALES }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAdminLocale = () => useContext(Ctx) || { locale: 'fa', isBase: true, setLocale: () => {}, locales: ADMIN_LOCALES };
