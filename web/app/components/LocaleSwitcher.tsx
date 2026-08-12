import { useFetcher } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LOCALES } from '~/lib/i18n';

/**
 * Language picker.
 *
 * A native <select> on purpose: keyboard accessible, works on mobile, renders
 * each script in its own font for free, and traps no focus. A custom dropdown
 * here would be worse in every one of those respects.
 *
 * Submits to a resource route so the choice is stored in the cookie and the
 * server renders the next page in the new language — no client-side flash.
 */
export function LocaleSwitcher() {
  const { i18n, t } = useTranslation();
  const fetcher = useFetcher();

  return (
    <fetcher.Form method="post" action="/locale" className="inline-flex">
      <select
        name="locale"
        defaultValue={i18n.language}
        onChange={(event) => fetcher.submit(event.currentTarget.form)}
        aria-label={t('common.language')}
        disabled={fetcher.state !== 'idle'}
        className="select-sm bg-surface-raised font-medium transition-colors hover:bg-surface-hover"
      >
        {LOCALES.map((locale) => (
          // Written in its own script — someone looking for Bangla is looking
          // for "বাংলা", not for "Bengali".
          <option key={locale.code} value={locale.code}>
            {locale.nativeName}
          </option>
        ))}
      </select>
    </fetcher.Form>
  );
}
