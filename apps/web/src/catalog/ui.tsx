import clsx from 'clsx';
import { ExternalLink, FileText } from 'lucide-react';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { glanceName } from '../files/files';
import { humanize } from '../lib/format';

export type Tone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'muted';

const BADGE_TONES: Record<Tone, string> = {
  neutral:
    'bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700',
  blue: 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900',
  green:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  amber:
    'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  red: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900',
  violet:
    'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:ring-violet-900',
  muted:
    'bg-transparent text-neutral-500 ring-neutral-200 dark:text-neutral-400 dark:ring-neutral-800',
};

export const DOT_TONES: Record<Tone, string> = {
  neutral: 'bg-neutral-400',
  blue: 'bg-sky-500',
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  violet: 'bg-violet-500',
  muted: 'bg-neutral-300 dark:bg-neutral-600',
};

/**
 * Colours for project statuses. Other statuses, priorities, and groups come from the project's
 * options (see `options.tsx`).
 */
const STATUS_TONES: Record<string, Tone> = {
  planning: 'violet',
  active: 'blue',
  paused: 'amber',
  done: 'green',
  archived: 'muted',
};

export function toneOf(value: string | undefined): Tone {
  return (value && STATUS_TONES[value]) || 'neutral';
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  return <Badge tone={toneOf(value)}>{humanize(value)}</Badge>;
}

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      className={clsx('inline-block size-2 shrink-0 rounded-full', DOT_TONES[tone], className)}
    />
  );
}

export function Panel({
  title,
  children,
  className,
  flush = false,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section
      className={clsx(
        'flex min-h-0 min-w-0 flex-col rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900',
        className,
      )}
    >
      {title && (
        <h3 className="border-b border-neutral-100 px-4 py-2.5 text-sm font-semibold text-neutral-800 dark:border-neutral-800 dark:text-neutral-100">
          {title}
        </h3>
      )}
      <div className={clsx('min-h-0 flex-1 overflow-auto', !flush && 'p-4')}>{children}</div>
    </section>
  );
}

export function ProgressBar({
  value,
  tone = 'green',
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800',
        className,
      )}
    >
      <div
        className={clsx('h-full rounded-full transition-all', DOT_TONES[tone])}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">{children}</p>
  );
}

/** Extra Markdown plugins and element renderers, e.g. tap-to-explain terms (`useMarkdownTerms`). */
export type MarkdownExtras = { remarkPlugins?: Options['remarkPlugins']; components?: Components };

export function Markdown({
  children,
  className,
  remarkPlugins,
  components,
}: { children: string; className?: string } & MarkdownExtras) {
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Only http(s) addresses open as links; anything else (a path, a file name) is shown as text. */
export function isHttp(uri: string | undefined): uri is string {
  return !!uri && /^https?:\/\//.test(uri);
}

/**
 * An artifact's address at a glance (v0.2 B2): a link that opens in a new tab when it's http(s),
 * plain text otherwise. `children` replaces the shown text, e.g. the source's title or "Source".
 * The host and the folders aren't written out: a web page reads "Web page" (its address is in the
 * tooltip), a local document its file name; the full address is in the artifact's details.
 */
export function Uri({
  uri,
  children,
  className,
  title,
}: {
  uri: string;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  if (isHttp(uri)) {
    return (
      <a
        href={uri}
        target="_blank"
        rel="noreferrer"
        title={title ?? uri}
        className={clsx(
          'inline-flex min-w-0 items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400',
          className,
        )}
      >
        <span className="truncate">{children ?? 'Web page'}</span>
        <ExternalLink className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    );
  }
  return (
    <span
      className={clsx(
        'inline-flex min-w-0 items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400',
        className,
      )}
    >
      <FileText className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{children ?? glanceName(uri)}</span>
    </span>
  );
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Complete button styles per variant. Kept as separate full strings (never layered with clsx)
 * so a variant can't be half-overridden by another's colours.
 */
export const BUTTON = {
  secondary: `${BUTTON_BASE} border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800`,
  accent: `${BUTTON_BASE} border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-200 dark:hover:bg-sky-900`,
  danger: `${BUTTON_BASE} border-rose-600 bg-rose-600 text-white hover:bg-rose-700 dark:border-rose-500 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-500`,
  primary: `${BUTTON_BASE} border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-700 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300`,
} as const;
