import { useState } from 'react';
import { Form, Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Icon } from '~/components/ui/Icon';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';
import { ThemeToggle } from './ThemeToggle';
import type { Person } from '~/data/types';

/**
 * The top bar: search, notifications, theme, language, account.
 *
 * Search is a `<form method="get">` rather than an onChange handler. It works
 * without JavaScript, the query lands in the URL so a search is linkable and
 * survives a refresh, and there is no debounce to get wrong.
 */
export function Topbar({
  viewer,
  workspaceSlug,
  unread,
  onOpenSidebar,
}: {
  viewer: Person;
  workspaceSlug: string;
  unread: number;
  onOpenSidebar: () => void;
}) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center gap-3 border-b border-stroke-subtle bg-surface-raised px-4">
      <button
        type="button"
        onClick={onOpenSidebar}
        className="flex size-9 items-center justify-center rounded-md text-content-secondary hover:bg-surface-hover lg:hidden"
      >
        <Icon name="panelLeft" size={18} label={t('nav.openMenu')} />
      </button>

      <Link
        to={`/w/${workspaceSlug}/search`}
        aria-label={t('search.placeholder')}
        className="flex size-9 items-center justify-center rounded-full border border-stroke-subtle text-content-secondary no-underline hover:bg-surface-hover sm:hidden"
      >
        <Icon name="search" size={16} />
      </Link>

      <Form
        method="get"
        action={`/w/${workspaceSlug}/search`}
        className="relative hidden max-w-md flex-1 sm:block"
      >
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute inset-y-0 start-3 my-auto text-content-tertiary"
        />
        <input
          type="search"
          name="q"
          defaultValue={params.get('q') ?? ''}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="field-pill"
        />
      </Form>

      <div className="ms-auto flex items-center gap-2">
        <Link
          to={`/w/${workspaceSlug}/notifications`}
          aria-label={t('notifications.title')}
          className="relative flex size-9 items-center justify-center rounded-full border border-stroke-subtle text-content-secondary no-underline hover:bg-surface-hover hover:text-content-primary sm:size-8"
        >
          <Icon name="bell" size={16} />
          {unread > 0 && (
            <span
              className="absolute -top-1 flex min-w-4 justify-center rounded-full bg-danger-600 px-1 text-[10px] font-bold leading-4 text-white end-[-2px]"
              aria-label={t('notifications.unread', { count: unread })}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Link>

        <ThemeToggle />
        <span className="hidden sm:block">
          <LocaleSwitcher />
        </span>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex size-9 items-center justify-center rounded-full text-xs font-semibold text-white sm:size-8"
            style={{ background: viewer.avatarColor }}
          >
            {viewer.initials}
            <span className="sr-only">{viewer.name}</span>
          </button>

          {menuOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div
                role="menu"
                className="absolute end-0 z-20 mt-2 w-56 rounded-lg border border-stroke-subtle bg-surface-raised p-1 shadow-lg"
              >
                <div className="border-b border-stroke-subtle px-3 py-2">
                  <p className="truncate text-sm font-semibold text-content-primary">{viewer.name}</p>
                  <p className="truncate text-xs text-content-tertiary">{viewer.email}</p>
                  <p className="mt-1 text-xs font-medium text-content-brand">
                    {t(`roles.${viewer.role}`)}
                  </p>
                </div>

                <Link
                  to="/account"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-md text-content-secondary no-underline hover:bg-surface-hover"
                >
                  <Icon name="user" size={15} />
                  {t('nav.account')}
                </Link>

                <Form method="post" action="/logout">
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-md text-content-secondary hover:bg-surface-hover"
                  >
                    <Icon name="logOut" size={15} />
                    {t('common.signOut')}
                  </button>
                </Form>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
