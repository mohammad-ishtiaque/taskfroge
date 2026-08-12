import { Form, Link } from 'react-router';
import { useTranslation } from 'react-i18next';

import { Button } from '~/components/ui/Button';
import { RoleBadge } from '~/components/ui/RoleBadge';
import { LocaleSwitcher } from '~/components/LocaleSwitcher';
import type { SessionUser } from '~/lib/session.server';

/**
 * The one header every signed-in screen uses.
 *
 * Extracted in M1 because there are now four screens that need it, and three
 * copies of a header is how they start to drift apart.
 */
export function AppHeader({ user }: { user: SessionUser }) {
  const { t } = useTranslation();

  return (
    <header className="border-b border-stroke-subtle bg-surface-raised">
      <div className="mx-auto flex h-topbar max-w-content items-center gap-4 px-page-x">
        <Link to="/" className="flex items-center gap-2 no-underline">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-sm font-bold text-white"
          >
            T
          </span>
          <span className="text-md font-semibold text-content-primary">{user.orgName}</span>
        </Link>

        <Link to="/projects" className="text-sm font-medium no-underline">
          {t('nav.projects')}
        </Link>

        {/* ms-auto, not ml-auto — this moves to the left edge in Arabic. */}
        <div className="ms-auto flex items-center gap-3">
          <LocaleSwitcher />
          <RoleBadge role={user.role} />
          <Link to="/account" className="text-sm font-medium no-underline">
            {t('nav.account')}
          </Link>
          <Form method="post" action="/logout">
            <Button type="submit" variant="ghost" size="sm">
              {t('common.signOut')}
            </Button>
          </Form>
        </div>
      </div>
    </header>
  );
}
