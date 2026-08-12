import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '~/components/ui/Icon';

/* ==========================================================================
   Turning on notifications
   --------------------------------------------------------------------------
   Three rules this component exists to honour, all of them about not being
   obnoxious:

   1. **Never ask on load.** A permission prompt the user did not ask for is
      the fastest way to a permanent "Block", and "Block" cannot be undone from
      the page — the user has to find it in browser settings. The prompt only
      ever follows a click on this switch.

   2. **Say why it is unavailable.** Push has three separate ways of not
      working — unsupported browser, permission already denied, iOS without the
      app installed — and "nothing happens" is the worst answer to all three.

   3. **Server and browser stay in step.** Unsubscribing tells both. A row the
      server keeps is one it keeps delivering to, and a notification arriving
      after you turned them off is a broken promise.
   ========================================================================== */

type State =
  | 'checking'
  | 'unsupported'
  | 'needs-install'
  | 'denied'
  | 'off'
  | 'on'
  | 'working';

export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (!publicKey) {
      setState('unsupported');
      return;
    }

    // iOS only exposes `PushManager` to an installed app, and only since 16.4.
    // Detecting it by feature rather than by user-agent means this is right on
    // whatever Safari does next.
    const supported =
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    if (!supported) {
      const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const installed = window.matchMedia('(display-mode: standalone)').matches;
      setState(isIOS && !installed ? 'needs-install' : 'unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setState(subscription ? 'on' : 'off'))
      .catch(() => setState('unsupported'));
  }, [publicKey]);

  async function enable() {
    if (!publicKey) return;
    setState('working');

    try {
      // Asked only now, after a deliberate click.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }

      const registration = await navigator.serviceWorker.ready;

      const subscription = await registration.pushManager.subscribe({
        // Required by every browser: a push must result in something the user
        // can see. Silent pushes are not on offer, and asking for them fails.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      const response = await fetch('/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!response.ok) {
        // The browser subscribed but the server did not record it. Undo the
        // browser half rather than leaving a switch that says "on" while
        // nothing will ever arrive.
        await subscription.unsubscribe().catch(() => undefined);
        setState('off');
        return;
      }

      setState('on');
    } catch {
      setState('off');
    }
  }

  async function disable() {
    setState('working');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        await fetch('/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);

        await subscription.unsubscribe();
      }
    } finally {
      setState('off');
    }
  }

  if (state === 'checking') return null;

  const message =
    state === 'unsupported' ? t('push.unsupported')
    : state === 'needs-install' ? t('push.needsInstall')
    : state === 'denied' ? t('push.denied')
    : null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-stroke-subtle bg-surface-raised p-card">
      <Icon name="bell" size={18} className="mt-0.5 shrink-0 text-content-secondary" />

      <div className="min-w-0 flex-1">
        <p className="text-md font-medium text-content-primary">{t('push.title')}</p>
        <p className="mt-0.5 text-sm text-content-tertiary">{message ?? t('push.hint')}</p>
      </div>

      {message === null && (
        <button
          type="button"
          disabled={state === 'working'}
          onClick={() => void (state === 'on' ? disable() : enable())}
          className={state === 'on' ? 'btn-secondary' : 'btn-primary'}
        >
          {state === 'working' ? t('common.saving') : state === 'on' ? t('push.turnOff') : t('push.turnOn')}
        </button>
      )}
    </div>
  );
}

/**
 * The VAPID key travels as base64url and `subscribe` wants raw bytes.
 *
 * Not interchangeable: base64url swaps `+/` for `-_` and drops the padding, so
 * handing the string straight to `atob` throws on roughly one key in three —
 * which looks like "push is broken on some deployments" rather than an
 * encoding bug.
 */
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);

  // Backed by a plain ArrayBuffer rather than the union `Uint8Array` defaults
  // to, because `applicationServerKey` will not accept a possibly-shared one.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
