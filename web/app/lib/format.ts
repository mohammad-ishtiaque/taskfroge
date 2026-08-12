/**
 * Dates, formatted in the reader's language.
 *
 * Every date crosses the loader boundary as an ISO string and is formatted
 * here and nowhere else. `Intl` handles the calendar, the month names and the
 * numerals — Arabic gets Arabic month names without a lookup table of ours.
 *
 * These run on the client so the browser's timezone applies. Formatting a due
 * date on the server would show a user in Dhaka the date it is in the server's
 * timezone, which is how a task due today appears due yesterday.
 */

export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

export function formatFullDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

/**
 * "3 days ago", "in 2 days" — via Intl, so it is a real translation rather
 * than English glued to a number.
 */
export function formatRelative(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diffMs = new Date(iso).getTime() - Date.now();

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ];

  for (const [unit, ms] of units) {
    if (Math.abs(diffMs) >= ms) return rtf.format(Math.round(diffMs / ms), unit);
  }
  return rtf.format(0, 'minute');
}

/** Days until a date; negative means overdue. Calendar days, not 24-hour blocks. */
export function daysUntil(iso: string): number {
  const due = new Date(iso);
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}
