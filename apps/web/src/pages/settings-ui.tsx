import clsx from 'clsx';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { InfoTip } from '../catalog/tooltip';

/** A settings card: its symbol and title lead; what it's for waits behind the (i). */
export function Section({
  title,
  icon: Icon,
  description,
  children,
  id,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={title}
      className="scroll-mt-16 space-y-4 rounded-block border border-line bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-4 text-faint" aria-hidden />
        {title}
        {description && <InfoTip label={`About ${title.toLowerCase()}`} detail={description} />}
      </h2>
      {children}
    </section>
  );
}

/** An on/off switch with its words as its accessible name. */
export function Switch({
  checked,
  disabled,
  label,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  describedBy?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'tap-area relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700',
      )}
    >
      <span
        className={clsx(
          'inline-block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
