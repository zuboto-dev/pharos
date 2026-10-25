import {
  PERMISSION_ROUTES,
  type PermissionAction,
  type PermissionAsk,
  type PermissionFolder,
  type PermissionLists,
  type PermissionPreview,
  type PermissionScope,
  type PermissionStatus,
  type PermissionSuggestion,
  type PermissionWriteRecord,
  type PermissionWriteResult,
  type PermissionsOverview,
} from '@pharos/schema';
import clsx from 'clsx';
import { ChevronRight, FolderGit2, Hand, KeyRound, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SkeletonRows } from '../catalog/skeleton';
import { Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError, ownerSend as send } from '../lib/api';
import { RISK } from '../catalog/risk';
import { useNotificationEvents } from '../lib/events';
import { plural, timeAgo } from '../lib/format';
import { Section } from './settings-ui';

/**
 * Settings → Agent permissions.
 *
 * - "Waiting now": live asks from the Claude Code hook (an agent is at a permission prompt right
 *   now): which project and agent, the command in plain words and its risk, and Allow always /
 *   Just this once / Deny / answer in the terminal.
 * - Per folder (collapsed): what agents kept asking for in the last two weeks, one line each; a
 *   line opens to what it does, why agents ask, two examples, the risk, and Allow / Deny.
 *
 * Only this page writes a rule: every request says it's the owner (`X-Pharos-Author: human:me`);
 * agents are refused. Every write shows the exact change first, keeps a backup, and can be undone.
 */

const errorText = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Couldn’t reach the server';

const STATUS: Record<PermissionStatus, { label: string; className: string }> = {
  allowed: {
    label: 'Allowed',
    className: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
  denied: {
    label: 'Denied',
    className: 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  },
  ask: {
    label: 'Always asks',
    className: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  },
  not_set: { label: 'Not set', className: 'bg-subtle text-muted' },
};

const SOURCE_LABEL = {
  local: 'settings.local.json',
  shared: 'settings.json',
  user: '~/.claude/settings.json',
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={clsx('rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', className)}
    >
      {children}
    </span>
  );
}

/** "asked 23 times this week", or over the whole window when the week had none. */
export function askedText(
  s: Pick<PermissionSuggestion, 'week' | 'total'>,
  windowDays: number,
): string {
  return s.week > 0
    ? `asked ${plural(s.week, 'time')} this week`
    : `asked ${plural(s.total, 'time')} in ${windowDays} days`;
}

/** Why agents ask: which routines or sessions, and how the asks ended. */
function whyText(s: PermissionSuggestion, windowDays: number): string {
  const who = s.origins.map((o) => `${o.label} (${o.count})`).join(', ');
  const how = [
    s.approved && `${s.approved} approved by you`,
    s.denied && `${s.denied} waited for an approval nobody gave`,
    s.blocked && `${s.blocked} stopped by auto mode`,
    s.ruleDenied && `${s.ruleDenied} stopped by a rule or hook`,
  ]
    .filter(Boolean)
    .join(', ');
  return `${who ? `From ${who}. ` : ''}${s.total} in ${windowDays} days (${how}); last ${timeAgo(s.lastAt)}.`;
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
      <dt className="text-xs font-medium text-muted sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** Where a scope's rule is written, in words. */
const scopeFile = (scope: PermissionScope) =>
  scope.target === 'user' ? '~/.claude/settings.json' : '.claude/settings.local.json';

/** "Only in breathe: lets agents run `npx pnpm@12.9.1 test …`" (or "agents can't …" for Deny). */
export function scopeSentence(scope: PermissionScope, action: PermissionAction): string {
  return `${scope.where}: ${action === 'allow' ? 'lets agents' : 'agents can’t'} ${scope.phrase}`;
}

/** Inline code in a sentence: `x` becomes <code>. */
function Sentence({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} className="rounded bg-subtle px-1 text-[12px] break-all">
            {p}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

/** "How far": the scopes of a rule, one radio each, with the exact rule and file under the choice. */
function HowFar({
  scopes,
  value,
  onChange,
  action,
  name,
}: {
  scopes: PermissionScope[];
  value: string;
  onChange: (id: string) => void;
  action: PermissionAction;
  name: string;
}) {
  const chosen = scopes.find((s) => s.id === value) ?? scopes[0];
  if (!chosen) return null;
  return (
    <div className="space-y-1.5">
      {scopes.length > 1 && (
        <fieldset className="flex flex-wrap gap-1.5" aria-label="How far">
          {scopes.map((scope) => (
            <label
              key={scope.id}
              className={clsx(
                'tap-area cursor-pointer rounded-control border px-2 py-0.5 text-xs',
                scope.id === chosen.id
                  ? 'border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100'
                  : 'border-line-strong text-ink-soft',
              )}
            >
              <input
                type="radio"
                name={name}
                value={scope.id}
                checked={scope.id === chosen.id}
                onChange={() => onChange(scope.id)}
                className="sr-only"
              />
              <Sentence text={scope.kind === 'folder' ? 'This folder' : scope.label} />
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-sm" aria-label="What this writes">
        <Sentence text={scopeSentence(chosen, action)} />
      </p>
      <p className="text-xs break-all text-muted">
        Writes <code>{chosen.rule}</code> to {scopeFile(chosen)}
      </p>
    </div>
  );
}

function CommandRow({
  s,
  windowDays,
  onChoose,
}: {
  s: PermissionSuggestion;
  windowDays: number;
  onChoose: (action: PermissionAction, scope: PermissionScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scopeId, setScopeId] = useState('folder');
  const status = STATUS[s.status];
  const count = s.week > 0 ? `${s.week} this week` : `${s.total} in ${windowDays} d`;
  const scope = s.scopes.find((x) => x.id === scopeId) ?? s.scopes.find((x) => x.kind === 'folder');
  return (
    <li aria-label={s.rule}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-2.5 text-left"
      >
        <ChevronRight
          className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-sm">{s.summary}</span>
        {s.status !== 'not_set' && (
          <span className={clsx('hidden sm:inline', 'text-xs')}>
            <Pill className={status.className}>{status.label}</Pill>
          </span>
        )}
        <span className="shrink-0 text-xs text-ink-soft tabular-nums">{count}</span>
      </button>
      {open && (
        <dl className="mb-3 ml-5.5 space-y-2.5 rounded-tile bg-sunken p-3">
          <Detail label="What it does">
            {s.summary}.{' '}
            <code className="rounded bg-subtle px-1 text-[12px] break-all">{s.rule}</code>
          </Detail>
          <Detail label="Why agents ask">{whyText(s, windowDays)}</Detail>
          {s.examples.length > 0 && (
            <Detail label="Examples">
              <ul className="space-y-0.5">
                {s.examples.slice(0, 2).map((e) => (
                  <li key={e} className="truncate font-mono text-xs text-ink-soft" title={e}>
                    {e}
                  </li>
                ))}
              </ul>
            </Detail>
          )}
          <Detail label="Risk">
            <Pill className={RISK[s.risk].className}>{RISK[s.risk].label}</Pill>{' '}
            <span className="text-ink-soft">{s.riskWhy}</span>
          </Detail>
          <Detail label="How far">
            <div className="space-y-2">
              <HowFar
                scopes={s.scopes}
                value={scopeId}
                onChange={setScopeId}
                action={s.allowable ? 'allow' : 'deny'}
                name={`how-far-${s.rule}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                {s.statusSource ? (
                  <Tooltip
                    label={`${status.label} in ${SOURCE_LABEL[s.statusSource]}`}
                    detail={s.matchedBy ? `By ${s.matchedBy}` : undefined}
                  >
                    <Pill className={status.className}>{status.label}</Pill>
                  </Tooltip>
                ) : (
                  <Pill className={status.className}>{status.label}</Pill>
                )}
                {s.allowable && scope && (
                  <button
                    type="button"
                    className={BUTTON.secondary}
                    disabled={s.status === 'allowed' && scope.kind === 'folder'}
                    onClick={() => onChoose('allow', scope)}
                  >
                    Allow
                  </button>
                )}
                {scope && (
                  <button
                    type="button"
                    className={BUTTON.secondary}
                    disabled={s.status === 'denied' && scope.kind === 'folder'}
                    onClick={() => onChoose('deny', scope)}
                  >
                    Deny
                  </button>
                )}
                {!s.allowable && <span className="text-xs text-muted">{s.reason}</span>}
              </div>
            </div>
          </Detail>
        </dl>
      )}
    </li>
  );
}

/** Commands a project shows before "Show all". */
export const FOLDER_SHOWN = 5;

function FolderCard({
  folder,
  windowDays,
  onChoose,
  actions,
}: {
  folder: PermissionFolder;
  windowDays: number;
  onChoose: (
    folder: PermissionFolder,
    s: PermissionSuggestion,
    action: PermissionAction,
    scope: PermissionScope,
  ) => void;
  /** For folders not in Pharos: Add to Pharos, Hide. */
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // The five most asked first; the rest one click away (owner's review, 10-23).
  const [all, setAll] = useState(false);
  const shown = all ? folder.suggestions : folder.suggestions.slice(0, FOLDER_SHOWN);
  const count =
    folder.total === 0
      ? 'no asks'
      : folder.week > 0
        ? `${plural(folder.week, 'ask')} this week`
        : `${plural(folder.total, 'ask')} in ${windowDays} days`;
  return (
    <li className="rounded-tile border border-line-soft" aria-label={folder.name}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={folder.displayPath}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={clsx('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <FolderGit2 className="size-4 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{folder.name}</span>
          {actions && (
            <span className="block truncate text-xs text-muted">{folder.displayPath}</span>
          )}
        </span>
        <span className="shrink-0 text-xs text-ink-soft tabular-nums">{count}</span>
      </button>
      {open && (
        <div className="border-t border-line-soft px-3">
          {!actions && (
            <p className="pt-2 text-xs break-all text-muted">
              {folder.projects.length > 0 && <span>{folder.projects.join(', ')} · </span>}
              {folder.displayPath}
            </p>
          )}
          {actions && <div className="flex flex-wrap gap-2 pt-2">{actions}</div>}
          {folder.suggestions.length ? (
            <ul className="divide-y divide-line-soft">
              {shown.map((s) => (
                <CommandRow
                  key={s.rule}
                  s={s}
                  windowDays={windowDays}
                  onChoose={(action, scope) => onChoose(folder, s, action, scope)}
                />
              ))}
            </ul>
          ) : (
            <p className="py-3 text-sm text-muted">Agents didn’t ask for anything here lately.</p>
          )}
          {shown.length < folder.suggestions.length && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="w-full border-t border-line-soft py-2 text-left text-xs font-medium text-accent hover:underline"
            >
              Show all {folder.suggestions.length}
            </button>
          )}
          {(folder.more > 0 || folder.unfixable > 0) && (
            <p className="border-t border-line-soft py-2.5 text-xs text-muted">
              {folder.more > 0 && `${plural(folder.more, 'rarer command')} not listed. `}
              {folder.unfixable > 0 &&
                `${plural(folder.unfixable, 'more call')} stopped for the command’s shape (a variable, cd before git) or by a safety check: no rule changes those.`}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Folders agents asked in that aren't in Pharos: one collapsed group at the bottom. */
/** Pharos folders agents haven't asked anything in: one quiet line, their names on opening. */
function NoAsks({ folders }: { folders: PermissionFolder[] }) {
  const [open, setOpen] = useState(false);
  if (!folders.length) return null;
  return (
    <div aria-label="No asks" className="px-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs text-muted hover:text-ink"
      >
        <ChevronRight
          className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        No asks ({folders.length})
      </button>
      {open && (
        <p className="px-7 pb-1 text-xs text-muted">{folders.map((f) => f.label).join(' · ')}</p>
      )}
    </div>
  );
}

function NotInPharos({
  folders,
  windowDays,
  onChoose,
  onAdd,
  onHide,
}: {
  folders: PermissionFolder[];
  windowDays: number;
  onChoose: React.ComponentProps<typeof FolderCard>['onChoose'];
  onAdd: (folder: PermissionFolder) => void;
  onHide: (folder: PermissionFolder) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!folders.length) return null;
  return (
    <div
      className="rounded-tile border border-dashed border-line-strong"
      aria-label="Not in Pharos"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={clsx('size-4 shrink-0 text-faint transition-transform', open && 'rotate-90')}
          aria-hidden
        />
        <span className="flex-1 text-sm font-medium text-ink-soft">
          Not in Pharos ({folders.length})
        </span>
        <span className="text-xs text-muted">folders agents asked in</span>
      </button>
      {open && (
        <ul className="space-y-2 border-t border-line-soft p-2">
          {folders.map((f) => (
            <FolderCard
              key={f.id}
              folder={f}
              windowDays={windowDays}
              onChoose={onChoose}
              actions={
                <>
                  <button type="button" className={BUTTON.secondary} onClick={() => onAdd(f)}>
                    Add to Pharos
                  </button>
                  <button type="button" className={BUTTON.secondary} onClick={() => onHide(f)}>
                    Hide
                  </button>
                </>
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListDiff({ before, after }: { before: PermissionLists; after: PermissionLists }) {
  const lists = (['allow', 'deny', 'ask'] as const).filter(
    (l) => before[l].length || after[l].length,
  );
  return (
    <div className="space-y-2" aria-label="Before and after">
      {lists.map((list) => {
        const removed = before[list].filter((r) => !after[list].includes(r));
        const added = after[list].filter((r) => !before[list].includes(r));
        const kept = before[list].filter((r) => after[list].includes(r));
        return (
          <div key={list}>
            <p className="text-xs font-medium text-muted">permissions.{list}</p>
            <ul className="mt-0.5 max-h-40 overflow-auto rounded-tile bg-subtle px-2 py-1.5 font-mono text-xs">
              {kept.map((r) => (
                <li key={`k${r}`} className="break-all text-muted">
                  {'  '}
                  {r}
                </li>
              ))}
              {removed.map((r) => (
                <li
                  key={`r${r}`}
                  className="break-all text-rose-700 line-through dark:text-rose-300"
                >
                  − {r}
                </li>
              ))}
              {added.map((r) => (
                <li
                  key={`a${r}`}
                  className="font-semibold break-all text-emerald-700 dark:text-emerald-300"
                >
                  + {r}
                </li>
              ))}
              {!kept.length && !removed.length && !added.length && (
                <li className="text-muted">(empty)</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** What a confirm dialog changes: how to load the preview and how to write it. */
type Change = {
  title: string;
  action: PermissionAction;
  intro: string;
  /** The rule goes in the folder's settings.local.json; the owner may pick settings.json. */
  canShare: boolean;
  preview: (shared: boolean) => Promise<PermissionPreview>;
  write: (hash: string, shared: boolean) => Promise<PermissionWriteRecord | undefined>;
};

function ConfirmChange({
  change,
  onClose,
  onWritten,
}: {
  change: Change;
  onClose: () => void;
  onWritten: (record: PermissionWriteRecord | undefined) => void;
}) {
  const [preview, setPreview] = useState<PermissionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    change.preview(shared).then(
      (p) => !cancelled && setPreview(p),
      (err: unknown) => !cancelled && setError(errorText(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [change, shared]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const write = async () => {
    if (!preview) return;
    setWriting(true);
    try {
      onWritten(await change.write(preview.hash, shared));
    } catch (err) {
      setError(errorText(err));
      setWriting(false);
    }
  };

  const verb = change.action === 'allow' ? 'Allow' : 'Deny';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={change.title}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg animate-pop-in space-y-4 overflow-y-auto rounded-block bg-surface p-5 shadow-overlay">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold break-all">{change.title}</h2>
          <button
            type="button"
            aria-label="Close"
            className="text-faint hover:text-ink"
            onClick={onClose}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
        <p className="text-sm text-ink-soft">
          <Sentence text={change.intro} />
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {!preview && !error && <SkeletonRows rows={3} label="Loading the change" />}
        {preview && (
          <div className="space-y-3">
            <div className="space-y-0.5 text-sm">
              <p className="text-xs font-medium text-muted">
                {preview.exists ? 'File' : 'New file'}
              </p>
              <p className="font-mono text-xs break-all">{preview.path}</p>
            </div>
            <p className="text-sm">
              Adds <code className="break-all">{preview.rule}</code> to <code>{preview.addTo}</code>
              {preview.removeFrom.length > 0 && (
                <>
                  {' '}
                  and takes it out of <code>{preview.removeFrom.join(', ')}</code>
                </>
              )}
              . Nothing else in the file changes; Pharos keeps a copy of it first.
            </p>
            <ListDiff before={preview.before} after={preview.after} />
            {preview.warnings.length > 0 && (
              <ul className="list-disc space-y-1 rounded-tile bg-amber-50 py-2 pr-3 pl-7 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {preview.unchanged && <p className="text-sm text-muted">The rule is already there.</p>}
          </div>
        )}
        {change.canShare && (
          <label className="flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Save for everyone on this repo (settings.json) instead
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={change.action === 'allow' ? BUTTON.primary : BUTTON.danger}
            disabled={!preview || preview.unchanged || writing}
            onClick={() => void write()}
          >
            {writing ? 'Writing…' : `${verb} and write`}
          </button>
        </div>
      </div>
    </div>
  );
}

function secondsLeft(ask: PermissionAsk, now: number): number {
  return Math.max(0, Math.round((new Date(ask.expiresAt).getTime() - now) / 1000));
}

const ANSWERED: Partial<Record<PermissionAsk['status'], string>> = {
  allowed_once: 'Allowed once',
  allowed_always: 'Allowed always',
  denied: 'Denied',
  terminal: 'Left to the terminal',
  expired: 'Asked in the terminal (no answer in time)',
  dismissed: 'Dismissed',
};

function AskCard({
  ask,
  now,
  onAnswer,
  onAlways,
}: {
  ask: PermissionAsk;
  now: number;
  onAnswer: (answer: 'once' | 'deny' | 'terminal' | 'dismiss') => void;
  onAlways: (scope: PermissionScope) => void;
}) {
  const where = ask.projects[0] ?? ask.displayFolder;
  const [scopeId, setScopeId] = useState('folder');
  const scope =
    ask.scopes.find((x) => x.id === scopeId) ?? ask.scopes.find((x) => x.kind === 'folder');
  // Asked in a run nobody watches: the hook didn't wait; a rule is for next time.
  const notifyOnly = ask.status === 'unattended';
  return (
    <li
      aria-label={`Ask from ${where}`}
      className={clsx(
        'space-y-3 rounded-tile border p-3',
        notifyOnly
          ? 'border-line-strong bg-sunken'
          : 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Hand className="size-4 shrink-0 text-warn" aria-hidden />
            {where}
          </p>
          <p className="text-xs break-all text-muted">
            {ask.agent} · {ask.displayFolder}
          </p>
        </div>
        <span className="text-xs text-ink-soft tabular-nums">
          {notifyOnly
            ? timeAgo(ask.at)
            : `waits ${secondsLeft(ask, now)} s, then asks in the terminal`}
        </span>
      </div>
      <dl className="space-y-2">
        <Detail label={notifyOnly ? 'Wanted to' : 'Wants to'}>{ask.summary}</Detail>
        <Detail label="Command">
          <code className="block rounded bg-surface px-1.5 py-0.5 font-mono text-xs break-all">
            {ask.example}
          </code>
        </Detail>
        <Detail label="Risk">
          <Pill className={RISK[ask.risk].className}>{RISK[ask.risk].label}</Pill>{' '}
          <span className="text-ink-soft">{ask.riskWhy}</span>
        </Detail>
      </dl>
      {notifyOnly && (
        <p className="text-sm text-ink-soft">
          Asked during {ask.agent}, which nobody watches, so it couldn’t wait and Claude Code
          refused it there. {ask.canAlwaysAllow ? 'Answer for next time with Allow always.' : ''}
        </p>
      )}
      {ask.canAlwaysAllow && ask.scopes.length > 0 && (
        <dl>
          <Detail label="Allow always">
            <HowFar
              scopes={ask.scopes}
              value={scopeId}
              onChange={setScopeId}
              action="allow"
              name={`how-far-ask-${ask.id}`}
            />
          </Detail>
        </dl>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {ask.canAlwaysAllow && scope && (
          <button type="button" className={BUTTON.primary} onClick={() => onAlways(scope)}>
            Allow always
          </button>
        )}
        {notifyOnly ? (
          <button type="button" className={BUTTON.secondary} onClick={() => onAnswer('dismiss')}>
            Dismiss
          </button>
        ) : (
          <>
            <button type="button" className={BUTTON.secondary} onClick={() => onAnswer('once')}>
              Just this once
            </button>
            <button type="button" className={BUTTON.secondary} onClick={() => onAnswer('deny')}>
              Deny
            </button>
            <button
              type="button"
              className="tap-area text-sm text-accent hover:underline"
              onClick={() => onAnswer('terminal')}
            >
              I’ll answer in the terminal
            </button>
          </>
        )}
      </div>
      {!ask.canAlwaysAllow && (
        <p className="text-xs text-muted">
          {ask.allowable
            ? 'No “Allow always” here: the agent isn’t working in a project folder.'
            : `No “Allow always”: ${ask.reason ?? 'it can only be denied'}.`}
        </p>
      )}
    </li>
  );
}

function WaitingAsks({
  asks,
  onChanged,
  onChange,
  onError,
}: {
  asks: PermissionAsk[];
  onChanged: () => void;
  onChange: (change: Change) => void;
  onError: (message: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const waiting = asks.filter((a) => a.status === 'waiting');
  const notified = asks.filter((a) => a.status === 'unattended');
  const answered = asks
    .filter((a) => a.status !== 'waiting' && a.status !== 'unattended')
    .slice(0, 3);
  useEffect(() => {
    if (!waiting.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting.length]);
  if (!asks.length) return null;

  const answer = async (ask: PermissionAsk, answer: 'once' | 'deny' | 'terminal' | 'dismiss') => {
    try {
      await send(`${PERMISSION_ROUTES.asks}/${ask.id}/answer`, { answer });
    } catch (err) {
      onError(errorText(err));
    }
    onChanged();
  };

  return (
    <div className="space-y-2" aria-label="Waiting now">
      {waiting.length > 0 && <h3 className="text-sm font-semibold">Waiting now</h3>}
      {!waiting.length && notified.length > 0 && (
        <h3 className="text-sm font-semibold">Asked while nobody was watching</h3>
      )}
      <ul className="space-y-2">
        {[...waiting, ...notified].map((ask) => (
          <AskCard
            key={ask.id}
            ask={ask}
            now={now}
            onAnswer={(a) => void answer(ask, a)}
            onAlways={(scope) => {
              const targetOf = (shared: boolean) =>
                scope.target === 'user' ? 'user' : shared ? 'shared' : 'local';
              onChange({
                title: `Allow always: ${ask.summary}`,
                action: 'allow',
                intro: `${scopeSentence(scope, 'allow')}${ask.status === 'waiting' ? ', starting with the one waiting now' : ', from the next run on'}.`,
                canShare: scope.target === 'local',
                preview: (shared) =>
                  send<PermissionPreview>(`${PERMISSION_ROUTES.asks}/${ask.id}/preview`, {
                    target: targetOf(shared),
                    rule: scope.rule,
                  }),
                write: async (hash, shared) =>
                  (
                    await send<PermissionAsk>(`${PERMISSION_ROUTES.asks}/${ask.id}/answer`, {
                      answer: 'always',
                      rule: scope.rule,
                      target: targetOf(shared),
                      hash,
                    })
                  ).record,
              });
            }}
          />
        ))}
      </ul>
      {answered.length > 0 && (
        <ul className="space-y-1 text-xs text-muted" aria-label="Answered asks">
          {answered.map((a) => (
            <li key={a.id} className="truncate">
              {ANSWERED[a.status]}: {a.summary.toLowerCase()} ({a.projects[0] ?? a.displayFolder},{' '}
              {timeAgo(a.answeredAt ?? a.at)})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentChanges({
  recent,
  onUndo,
}: {
  recent: PermissionWriteRecord[];
  onUndo: (r: PermissionWriteRecord) => void;
}) {
  if (!recent.length) return null;
  return (
    <div className="space-y-2 border-t border-line-soft pt-4">
      <h3 className="text-sm font-semibold">Changes Pharos made</h3>
      <ul className="space-y-1.5">
        {recent.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 flex-1">
              <span className={r.action === 'allow' ? 'text-ok' : 'text-danger'}>
                {r.action === 'allow' ? 'Allowed' : 'Denied'}
              </span>{' '}
              <code className="text-[13px] break-all">{r.rule}</code>
              <span className="block text-xs break-all text-muted">
                {r.path} · {timeAgo(r.at)}
                {r.undone && ' · undone'}
              </span>
            </span>
            {r.undoable && (
              <button type="button" className={BUTTON.secondary} onClick={() => onUndo(r)}>
                <Undo2 className="size-3.5" aria-hidden />
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentPermissions() {
  const [data, setData] = useState<PermissionsOverview | null>(null);
  const [asks, setAsks] = useState<PermissionAsk[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [done, setDone] = useState<PermissionWriteRecord | null>(null);

  const load = useCallback(() => {
    send<PermissionsOverview>(PERMISSION_ROUTES.list).then(
      (o) => {
        setData(o);
        setLoadError(null);
      },
      (err: unknown) => setLoadError(errorText(err)),
    );
  }, []);
  const loadAsks = useCallback(() => {
    send<PermissionAsk[]>(PERMISSION_ROUTES.asks).then(
      (list) => setAsks(Array.isArray(list) ? list : []),
      () => {},
    );
  }, []);
  useEffect(load, [load]);
  useEffect(loadAsks, [loadAsks]);
  // A new ask arrives as a notification; waiting ones also expire, so look again now and then.
  useNotificationEvents(loadAsks, loadAsks);
  const anyWaiting = asks.some((a) => a.status === 'waiting');
  useEffect(() => {
    const timer = setInterval(loadAsks, anyWaiting ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [loadAsks, anyWaiting]);

  const undo = async (record: PermissionWriteRecord) => {
    try {
      await send(PERMISSION_ROUTES.undo, { id: record.id });
      setDone(null);
      setError(null);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const choose = (
    folder: PermissionFolder,
    s: PermissionSuggestion,
    action: PermissionAction,
    scope: PermissionScope,
  ) => {
    setError(null);
    const body = (shared: boolean) => ({
      folderId: folder.id,
      base: s.rule,
      rule: scope.rule,
      action,
      target: scope.target === 'user' ? 'user' : shared ? 'shared' : 'local',
    });
    setChange({
      title: `${action === 'allow' ? 'Allow' : 'Deny'}: ${s.summary}`,
      action,
      intro: `${scopeSentence(scope, action)}.`,
      canShare: scope.target === 'local',
      preview: (shared) => send<PermissionPreview>(PERMISSION_ROUTES.preview, body(shared)),
      write: async (hash, shared) =>
        (await send<PermissionWriteResult>(PERMISSION_ROUTES.write, { ...body(shared), hash }))
          .record,
    });
  };

  const folderAction = async (folder: PermissionFolder, what: 'add' | 'hide') => {
    try {
      await send(`${PERMISSION_ROUTES.list}/folders/${folder.id}/${what}`, {});
      setError(null);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const folders = data?.folders ?? [];
  return (
    <Section
      id="permissions"
      title="Agent permissions"
      icon={KeyRound}
      description="Pharos reads Claude Code’s session logs on this computer (never sends them anywhere) and counts the tool calls that needed your approval or were stopped, over the last two weeks. With the Pharos hook installed (pnpm agents install), an agent waiting at a permission prompt shows here too. Only you, here, can write a rule; agents can’t."
    >
      <WaitingAsks asks={asks} onChanged={loadAsks} onChange={setChange} onError={setError} />
      <p className="text-sm text-ink-soft">
        What Claude Code agents kept asking for, per folder. Open a command to choose how far a rule
        reaches; it goes in that folder’s{' '}
        <code className="text-[13px]">.claude/settings.local.json</code> (just you, not committed)
        unless you choose otherwise.
      </p>
      {done && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-tile bg-sunken px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            {done.action === 'allow' ? 'Allowed' : 'Denied'}{' '}
            <code className="text-[13px] break-all">{done.rule}</code> in{' '}
            <span className="break-all">{done.path}</span>
          </span>
          <button type="button" className={BUTTON.secondary} onClick={() => void undo(done)}>
            <Undo2 className="size-3.5" aria-hidden />
            Undo
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {loadError && !data ? (
        <p className="text-sm text-danger">Couldn’t load permissions: {loadError}</p>
      ) : !data ? (
        <SkeletonRows rows={3} label="Reading Claude Code’s logs" />
      ) : folders.length ? (
        <>
          <ul className="space-y-2" aria-label="Folders">
            {folders
              .filter((f) => f.inPharos && f.total > 0)
              .map((f) => (
                <FolderCard key={f.id} folder={f} windowDays={data.windowDays} onChoose={choose} />
              ))}
          </ul>
          {/* Folders agents never asked in fold into one line (owner's review, 10-23). */}
          <NoAsks folders={folders.filter((f) => f.inPharos && f.total === 0)} />
          <NotInPharos
            folders={folders.filter((f) => !f.inPharos)}
            windowDays={data.windowDays}
            onChoose={choose}
            onAdd={(f) => void folderAction(f, 'add')}
            onHide={(f) => void folderAction(f, 'hide')}
          />
          {data.hidden > 0 && (
            <button
              type="button"
              className="text-xs text-muted hover:underline"
              onClick={() =>
                void send(`${PERMISSION_ROUTES.list}/folders/show-hidden`, {}).then(load, (err) =>
                  setError(errorText(err)),
                )
              }
            >
              {plural(data.hidden, 'hidden folder')} · Show again
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">
          No Claude Code sessions asked for permission in the last {data.windowDays} days.
        </p>
      )}
      {data && <RecentChanges recent={data.recent ?? []} onUndo={(r) => void undo(r)} />}
      {change && (
        <ConfirmChange
          change={change}
          onClose={() => setChange(null)}
          onWritten={(record) => {
            setChange(null);
            if (record) setDone(record);
            load();
            loadAsks();
          }}
        />
      )}
    </Section>
  );
}
