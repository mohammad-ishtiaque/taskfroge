import { useTranslation } from 'react-i18next';

const ROLE_TOKEN: Record<string, string> = {
  CLIENT: 'client',
  PROJECT_MANAGER: 'project-manager',
  DEVELOPER: 'developer',
};

/**
 * Three roles, three hues from tokens.css. A tinted chip built from one colour
 * with `color-mix` rather than a hand-picked background/border pair, so adding
 * a role later is one token, not three.
 */
export function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const token = `var(--role-${ROLE_TOKEN[role] ?? 'developer'})`;

  return (
    <span
      className="inline-flex h-6 items-center rounded-full border px-2.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${token} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${token} 30%, transparent)`,
        color: token,
      }}
    >
      {t(`roles.${role}`)}
    </span>
  );
}
