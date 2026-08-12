import type { EmailMessage } from '../../lib/email';

/**
 * Invitation copy, per locale.
 *
 * The invitee has no account and therefore no stored language, so this falls
 * back to the inviter's — the best guess available. Two variants: one for
 * someone who needs to create an account, one for someone who already has one
 * and just needs to sign in.
 */
type Copy = {
  subject: (org: string) => string;
  body: (input: {
    inviter: string;
    org: string;
    project: string;
    url: string;
    hasAccount: boolean;
  }) => string;
};

const COPY: Record<string, Copy> = {
  en: {
    subject: (org) => `${org} invited you to a project on TaskForge`,
    body: ({ inviter, org, project, url, hasAccount }) =>
      `${inviter} at ${org} has invited you to the project "${project}".\n\n` +
      `${url}\n\n` +
      (hasAccount
        ? 'Sign in with your existing account to join.\n\n'
        : 'You will choose a name and password when you open the link.\n\n') +
      `This invitation expires in 7 days.`,
  },
  bn: {
    subject: (org) => `${org} আপনাকে TaskForge-এ একটি প্রকল্পে আমন্ত্রণ জানিয়েছে`,
    body: ({ inviter, org, project, url, hasAccount }) =>
      `${org}-এর ${inviter} আপনাকে "${project}" প্রকল্পে আমন্ত্রণ জানিয়েছেন।\n\n` +
      `${url}\n\n` +
      (hasAccount
        ? 'যোগ দিতে আপনার বিদ্যমান অ্যাকাউন্ট দিয়ে সাইন ইন করুন।\n\n'
        : 'লিংকটি খুললে আপনি নাম ও পাসওয়ার্ড দেবেন।\n\n') +
      `এই আমন্ত্রণের মেয়াদ ৭ দিন।`,
  },
  es: {
    subject: (org) => `${org} te ha invitado a un proyecto en TaskForge`,
    body: ({ inviter, org, project, url, hasAccount }) =>
      `${inviter}, de ${org}, te ha invitado al proyecto "${project}".\n\n` +
      `${url}\n\n` +
      (hasAccount
        ? 'Inicia sesión con tu cuenta para unirte.\n\n'
        : 'Elegirás un nombre y una contraseña al abrir el enlace.\n\n') +
      `Esta invitación caduca en 7 días.`,
  },
  nl: {
    subject: (org) => `${org} heeft je uitgenodigd voor een project in TaskForge`,
    body: ({ inviter, org, project, url, hasAccount }) =>
      `${inviter} van ${org} heeft je uitgenodigd voor het project "${project}".\n\n` +
      `${url}\n\n` +
      (hasAccount
        ? 'Log in met je bestaande account om deel te nemen.\n\n'
        : 'Je kiest een naam en wachtwoord wanneer je de link opent.\n\n') +
      `Deze uitnodiging verloopt over 7 dagen.`,
  },
  ar: {
    subject: (org) => `دعتك ${org} للانضمام إلى مشروع على TaskForge`,
    body: ({ inviter, org, project, url, hasAccount }) =>
      `دعاك ${inviter} من ${org} للانضمام إلى مشروع "${project}".\n\n` +
      `${url}\n\n` +
      (hasAccount
        ? 'سجّل الدخول بحسابك الحالي للانضمام.\n\n'
        : 'ستختار اسمًا وكلمة مرور عند فتح الرابط.\n\n') +
      `تنتهي صلاحية هذه الدعوة خلال 7 أيام.`,
  },
};

export function invitationEmail(input: {
  to: string;
  inviterName: string;
  organizationName: string;
  projectName: string;
  acceptUrl: string;
  locale: string;
  hasAccount: boolean;
}): EmailMessage {
  const copy = COPY[input.locale] ?? COPY.en!;

  return {
    to: input.to,
    subject: copy.subject(input.organizationName),
    text: copy.body({
      inviter: input.inviterName,
      org: input.organizationName,
      project: input.projectName,
      url: input.acceptUrl,
      hasAccount: input.hasAccount,
    }),
  };
}
