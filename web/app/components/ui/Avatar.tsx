import { cn } from '~/lib/cn';

const SIZES = {
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
} as const;

/**
 * Falls back to initials on a colour derived from the name.
 *
 * A team roster with no uploaded photos would otherwise be a column of
 * identical grey circles — useless for scanning. The hue is deterministic, so
 * the same person is the same colour on every screen.
 */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full',
        'font-semibold text-white select-none',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: src ? undefined : hueFor(name) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Saturation and lightness are fixed so every result clears contrast on white. */
function hueFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = name.charCodeAt(index) + ((hash << 5) - hash);
  }
  return `hsl(${Math.abs(hash) % 360} 42% 45%)`;
}
