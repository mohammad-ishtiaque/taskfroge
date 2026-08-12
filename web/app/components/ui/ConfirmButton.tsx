import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { cn } from '~/lib/cn';

interface ConfirmButtonProps {
  /** Text on the button that opens the dialog. */
  children: ReactNode;
  title: string;
  message: string;
  /** Text on the button that actually does it. Defaults to the trigger label. */
  confirmLabel?: string;
  variant?: 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A submit button that asks first.
 *
 * Built on the native `<dialog>` element rather than a custom overlay: focus
 * trapping, Escape to close, the backdrop and the top layer all come for free
 * and behave the way the platform does everywhere else.
 *
 * **Progressive enhancement matters here.** The button is a real `type="submit"`
 * and the click is only intercepted once JavaScript has run. If it has not, the
 * action still works — it simply submits without asking. A confirmation that
 * silently disables the feature it guards would be worse than none.
 */
export function ConfirmButton({
  children,
  title,
  message,
  confirmLabel,
  variant = 'ghost',
  size = 'sm',
  className,
}: ConfirmButtonProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function open(event: React.MouseEvent<HTMLButtonElement>) {
    // Only prevent the submit once we know we can show the dialog.
    if (typeof dialogRef.current?.showModal !== 'function') return;
    event.preventDefault();
    dialogRef.current.showModal();
  }

  function confirm() {
    dialogRef.current?.close();
    // Submit the form the trigger belongs to, including its hidden intent
    // fields. `requestSubmit` runs validation; `submit()` would skip it.
    triggerRef.current?.form?.requestSubmit(triggerRef.current);
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="submit"
        variant={variant}
        size={size}
        onClick={open}
        className={cn(variant === 'ghost' && 'text-danger-600 hover:bg-danger-50', className)}
      >
        {children}
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-title"
        // Clicking the backdrop closes it. The backdrop is the dialog element
        // itself; anything inside is a child, so comparing targets is enough.
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className={cn(
          'w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-stroke-subtle',
          'bg-surface-raised p-card text-content-primary shadow-lg',
          'backdrop:bg-neutral-950/50',
        )}
      >
        <h2 id="confirm-title" className="text-xl">
          {title}
        </h2>
        <p className="mt-2 text-md text-content-secondary">{message}</p>

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {/* Cancel comes first and takes focus. For a destructive action the
              safe choice should be the one an accidental Enter lands on. */}
          <Button
            type="button"
            variant="secondary"
            autoFocus
            onClick={() => dialogRef.current?.close()}
          >
            {t('common.goBack')}
          </Button>
          <Button type="button" variant="danger" onClick={confirm}>
            {confirmLabel ?? children}
          </Button>
        </div>
      </dialog>
    </>
  );
}
