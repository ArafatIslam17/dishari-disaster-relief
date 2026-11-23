import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { bn } from './bn';
import { en } from './en';

export type Lang = 'bn' | 'en';
const KEY = 'relief.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'bn' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'bn'; // Bangla first: the field app's primary language (NFR18)
}

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, bn: { translation: bn } },
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});
document.documentElement.lang = i18next.language;

export function setLang(lang: Lang): void {
  void i18next.changeLanguage(lang);
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage unavailable */
  }
}

/** Dates and numbers in the active language (Bangla digits in bn). */
export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return i18next.t('common.never');
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(i18next.language === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Compact time for the sync chip: the time of day when it is today, otherwise the date. */
export function formatShortTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(i18next.language === 'bn' ? 'bn-BD' : 'en-GB', today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(d);
}

export function formatNumber(n: number | string): string {
  if (typeof n === 'string') return n;
  return new Intl.NumberFormat(i18next.language === 'bn' ? 'bn-BD' : 'en-GB').format(n);
}

export default i18next;

/** A 0–1 ratio as a whole percentage in the active language. */
export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat(i18next.language === 'bn' ? 'bn-BD' : 'en-GB', { style: 'percent', maximumFractionDigits: 0 }).format(Number.isFinite(ratio) ? ratio : 0);
}

/** Whole taka with the ৳ sign, Bangla digits in bn. */
export function formatTaka(n: number): string {
  return `৳${formatNumber(n)}`;
}

/** Full date and time (with year) for receipts. */
export function formatDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(i18next.language === 'bn' ? 'bn-BD' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}
