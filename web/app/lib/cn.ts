/**
 * Joins class names, dropping falsey values.
 *
 * Deliberately not `tailwind-merge`: with only a handful of components in M0
 * there is nothing to de-conflict yet, and one fewer dependency is one fewer
 * thing to keep current. Revisit if a component's defaults start losing to a
 * caller's overrides.
 */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
