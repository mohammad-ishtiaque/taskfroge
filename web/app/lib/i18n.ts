import i18next, { type i18n as I18nInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from '~/locales/ar.json';
import bn from '~/locales/bn.json';
import en from '~/locales/en.json';
import es from '~/locales/es.json';
import nl from '~/locales/nl.json';

/**
 * Supported languages.
 *
 * `dir` drives the `dir` attribute on <html>. Every layout uses CSS logical
 * properties, so adding another right-to-left language is a one-line change
 * here and nothing else.
 */
export const LOCALES = [
  { code: 'en', nativeName: 'English',   dir: 'ltr' },
  { code: 'bn', nativeName: 'বাংলা',      dir: 'ltr' },
  { code: 'es', nativeName: 'Español',   dir: 'ltr' },
  { code: 'nl', nativeName: 'Nederlands', dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية',    dir: 'rtl' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_CODES = LOCALES.map((locale) => locale.code);

const RESOURCES = { en, bn, es, nl, ar } as const;

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return value != null && (LOCALE_CODES as readonly string[]).includes(value);
}

export function directionOf(locale: string): 'ltr' | 'rtl' {
  return LOCALES.find((entry) => entry.code === locale)?.dir ?? 'ltr';
}

/**
 * Builds an i18next instance for a single locale.
 *
 * A fresh instance per server render rather than a module-level singleton: on
 * the server, one shared instance would leak whichever language rendered last
 * into a concurrent request for a different one.
 *
 * i18next resolves plurals through Intl.PluralRules, so Arabic gets its full
 * six categories (zero/one/two/few/many/other) rather than English's two.
 */
export function createI18n(locale: string): I18nInstance {
  const instance = i18next.createInstance();

  void instance.use(initReactI18next).init({
    lng: isSupportedLocale(locale) ? locale : DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    resources: Object.fromEntries(
      Object.entries(RESOURCES).map(([code, translation]) => [code, { translation }]),
    ),
    interpolation: { escapeValue: false }, // React escapes already
    returnNull: false,
  });

  return instance;
}

/**
 * Picks a language for the request: an explicit cookie choice wins, then the
 * browser's Accept-Language, then English.
 */
export function resolveLocale(request: Request, cookieLocale?: string | null): Locale {
  if (isSupportedLocale(cookieLocale)) return cookieLocale;

  const header = request.headers.get('accept-language');
  if (!header) return DEFAULT_LOCALE;

  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase();
    if (!tag) continue;

    // Match `bn` from `bn-BD`, so a Bangladeshi browser gets Bangla.
    const base = tag.split('-')[0];
    if (isSupportedLocale(base)) return base;
  }

  return DEFAULT_LOCALE;
}
