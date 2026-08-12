import type { EmailMessage } from '../../lib/email';

/**
 * Reset email copy, per locale.
 *
 * Kept beside the auth service rather than in the web app's translation files
 * because the API sends it — a user resetting their password is not in a
 * browser session we can read a language preference from, so it comes from
 * their stored `locale`.
 *
 * Three things every version carries, and each earns its place:
 *
 *   · **the link** — for the ordinary case, same browser, one click
 *   · **the code** — for the person who asked on a laptop and is reading this
 *     on a phone. Without it the security binding would simply break that
 *     person's day, and a security control people cannot get past is one they
 *     route around
 *   · **where it came from** — "Chrome on Windows (103.152.44.x)". A reader
 *     who did not make this request can recognise that, and a reader who did
 *     is reassured. It is the only part of the email that helps someone under
 *     attack rather than someone who forgot their password.
 */
interface ResetCopy {
  subject: string;
  body: (input: { name: string; url: string; otp: string; from: string }) => string;
}

const COPY: Record<string, ResetCopy> = {
  en: {
    subject: 'Reset your TaskForge password',
    body: ({ name, url, otp, from }) =>
      `Hi ${name},\n\n` +
      `Someone asked to reset the password for your TaskForge account, from ${from}.\n\n` +
      `${url}\n\n` +
      `If you opened this on a different device from the one you asked on, ` +
      `enter this code when the page asks for it:\n\n` +
      `    ${otp}\n\n` +
      `This link works once and expires in one hour.\n\n` +
      `If this wasn't you, you can ignore this email — your password has not changed.`,
  },
  bn: {
    subject: 'আপনার TaskForge পাসওয়ার্ড রিসেট করুন',
    body: ({ name, url, otp, from }) =>
      `প্রিয় ${name},\n\n` +
      `${from} থেকে আপনার TaskForge অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার অনুরোধ করা হয়েছে।\n\n` +
      `${url}\n\n` +
      `আপনি যদি অন্য ডিভাইসে এটি খুলে থাকেন, পেজে চাওয়া হলে এই কোডটি দিন:\n\n` +
      `    ${otp}\n\n` +
      `এই লিংকটি একবারই কাজ করবে এবং এক ঘণ্টা পরে মেয়াদ শেষ হবে।\n\n` +
      `আপনি যদি এটি না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন — আপনার পাসওয়ার্ড অপরিবর্তিত আছে।`,
  },
  es: {
    subject: 'Restablece tu contraseña de TaskForge',
    body: ({ name, url, otp, from }) =>
      `Hola ${name}:\n\n` +
      `Se ha solicitado restablecer la contraseña de tu cuenta de TaskForge, desde ${from}.\n\n` +
      `${url}\n\n` +
      `Si has abierto esto en un dispositivo distinto del que hiciste la solicitud, ` +
      `introduce este código cuando la página te lo pida:\n\n` +
      `    ${otp}\n\n` +
      `Este enlace funciona una sola vez y caduca en una hora.\n\n` +
      `Si no has sido tú, puedes ignorar este correo: tu contraseña no ha cambiado.`,
  },
  nl: {
    subject: 'Stel je TaskForge-wachtwoord opnieuw in',
    body: ({ name, url, otp, from }) =>
      `Hallo ${name},\n\n` +
      `Er is gevraagd om het wachtwoord van je TaskForge-account opnieuw in te stellen, vanaf ${from}.\n\n` +
      `${url}\n\n` +
      `Heb je dit op een ander apparaat geopend dan waar je het aanvroeg? ` +
      `Vul dan deze code in wanneer de pagina erom vraagt:\n\n` +
      `    ${otp}\n\n` +
      `Deze link werkt één keer en verloopt over een uur.\n\n` +
      `Was jij dit niet? Dan kun je deze e-mail negeren — je wachtwoord is niet gewijzigd.`,
  },
  ar: {
    subject: 'إعادة تعيين كلمة مرور TaskForge',
    body: ({ name, url, otp, from }) =>
      `مرحبًا ${name}،\n\n` +
      `تم طلب إعادة تعيين كلمة المرور لحسابك في TaskForge، من ${from}.\n\n` +
      `${url}\n\n` +
      `إذا فتحت هذا على جهاز غير الجهاز الذي طلبت منه، أدخل هذا الرمز عندما تطلبه الصفحة:\n\n` +
      `    ${otp}\n\n` +
      `يعمل هذا الرابط مرة واحدة فقط وتنتهي صلاحيته خلال ساعة.\n\n` +
      `إذا لم تكن أنت من طلب ذلك، يمكنك تجاهل هذه الرسالة — لم تتغيّر كلمة المرور.`,
  },
};

export function passwordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
  /** The 6-digit cross-device code. */
  otp: string;
  /** "Chrome on Windows (103.152.44.x)". Already truncated by `describeRequest`. */
  requestedFrom: string;
  locale: string;
}): EmailMessage {
  const copy = COPY[input.locale] ?? COPY.en!;

  return {
    to: input.to,
    subject: copy.subject,
    text: copy.body({
      name: input.name,
      url: input.resetUrl,
      otp: input.otp,
      from: input.requestedFrom,
    }),
  };
}
