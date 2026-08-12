import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '~/components/ui/Icon';

type Theme = 'light' | 'dark';

/**
 * Theme toggle.
 *
 * The theme is applied by an inline script in root.tsx before first paint, so
 * this component's only job is flipping it afterwards. It deliberately renders
 * nothing until mounted: the server has no way to know what the browser's
 * localStorage says, so rendering a sun on the server and a moon on the client
 * is a hydration mismatch — and the icon would be wrong for a frame either way.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('taskforge-theme', next);
    } catch {
      // Private browsing. The theme still applies for this session, which is
      // the better failure than refusing to switch at all.
    }
    setTheme(next);
  }

  // Same footprint as the real button, so the header does not shift on mount.
  if (theme === null) return <span className="size-8" aria-hidden />;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      title={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
      className="flex size-8 items-center justify-center rounded-full border border-stroke-subtle text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content-primary"
    >
      <Icon
        name={theme === 'dark' ? 'sun' : 'moon'}
        size={16}
        label={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')}
      />
    </button>
  );
}
