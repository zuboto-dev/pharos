import {
  PERMISSION_ROUTES,
  PERMISSION_TARGETS,
  type PermissionAction,
  type PermissionFolder,
  type PermissionLists,
  type PermissionPreview,
  type PermissionStatus,
  type PermissionSuggestion,
  type PermissionTarget,
  type PermissionWriteRecord,
  type PermissionWriteResult,
  type PermissionsOverview,
} from '@pharos/schema';
import clsx from 'clsx';
import { ChevronRight, FolderGit2, KeyRound, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { SkeletonRows } from '../catalog/skeleton';
import { InfoTip, Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError } from '../lib/api';
import { plural, timeAgo } from '../lib/format';
import { Section } from './settings-ui';

/**
 * Settings → Agent permissions: what Claude Code agents kept asking permission for (or were
 * stopped on) per project folder, and one-click Allow / Deny that Pharos writes into that
 * folder's Claude Code settings after showing the exact change. Only this page writes a rule:
 * every request says it's the owner (`X-Pharos-Author: human:me`), and agents are refused.
 */

const OWNER_HEADERS = { 'x-pharos-author': 'human:me' };

async function send<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...OWNER_HEADERS,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      res.status,
      data?.error?.message ?? `HTTP ${res.status}`,
      data?.error?.issues,
    );
  return data as T;
}

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

/** "asked 23 times this week", or over the whole window when the week had none. */
export function askedText(
  s: Pick<PermissionSuggestion, 'week' | 'total'>,
  windowDays: number,
): string {
  return s.week > 0
    ? `asked ${plural(s.week, 'time')} this week`
    : `asked ${plural(s.total, 'time')} in ${windowDays} days`;
}

function breakdown(s: PermissionSuggestion): string {
  const parts = [
    s.approved && `${s.approved} approved by you at the prompt`,
    s.denied &&
      `${s.denied} needed approval nobody gave (you said no, or a background run couldn’t ask)`,
    s.blocked && `${s.blocked} stopped by auto mode’s safety check`,
    s.ruleDenied && `${s.ruleDenied} stopped by a rule or hook`,
  ].filter(Boolean);
  return `${parts.join('; ')}. ${s.total} in the last two weeks, last ${timeAgo(s.lastAt)}.`;
}

function StatusBadge({ s }: { s: PermissionSuggestion }) {
  const status = STATUS[s.status];
  const badge = (
    <span
      className={clsx(
        'rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        status.className,
      )}
    >
      {status.label}
    </span>
  );
  if (!s.statusSource) return badge;
  return (
    <Tooltip
      label={`${status.label} in ${SOURCE_LABEL[s.statusSource]}`}
      detail={s.matchedBy ? `By ${s.matchedBy}` : undefined}
    >
      {badge}
    </Tooltip>
  );
}

function SuggestionRow({
  s,
  windowDays,
  onChoose,
}: {
  s: PermissionSuggestion;
  windowDays: number;
  onChoose: (action: PermissionAction) => void;
}) {
  const allowDisabled = !s.allowable || s.status === 'allowed';
  return (
    <li className="space-y-1.5 py-3" aria-label={s.rule}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px] break-all">{s.rule}</code>
            <StatusBadge s={s} />
          </div>
          <p className="flex items-center gap-1 text-sm text-ink-soft">
            {askedText(s, windowDays)}
            <InfoTip label={`About the asks for ${s.rule}`} detail={breakdown(s)} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {s.allowable ? (
            <button
              type="button"
              className={BUTTON.secondary}
              disabled={allowDisabled}
              onClick={() => onChoose('allow')}
            >
              Allow
            </button>
          ) : (
            <Tooltip label="Deny only" detail={s.reason}>
              <button
                type="button"
                className={BUTTON.secondary}
                disabled
                aria-label={`Allow (${s.reason ?? 'deny only'})`}
              >
                Allow
              </button>
            </Tooltip>
          )}
          <button
            type="button"
            className={BUTTON.secondary}
            disabled={s.status === 'denied'}
            onClick={() => onChoose('deny')}
          >
            Deny
          </button>
        </div>
      </div>
      {s.examples.length > 0 && (
        <ul aria-label="Examples" className="space-y-0.5">
          {s.examples.map((e) => (
            <li key={e} className="truncate font-mono text-xs text-muted" title={e}>
              {e}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

const SHOWN = 5;

function FolderCard({
  folder,
  windowDays,
  open: initiallyOpen,
  onChoose,
}: {
  folder: PermissionFolder;
  windowDays: number;
  open: boolean;
  onChoose: (folder: PermissionFolder, s: PermissionSuggestion, action: PermissionAction) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [all, setAll] = useState(false);
  const list = all ? folder.suggestions : folder.suggestions.slice(0, SHOWN);
  const hidden = folder.suggestions.length - list.length + (all ? folder.more : 0);
  const summary =
    folder.total === 0
      ? 'No asks in the last two weeks'
      : folder.week > 0
        ? `${plural(folder.week, 'ask')} this week · ${folder.total} in ${windowDays} days`
        : `${plural(folder.total, 'ask')} in ${windowDays} days`;
  return (
    <li className="rounded-tile border border-line-soft">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-start gap-x-2 gap-y-1 px-3 py-2.5 text-left"
      >
        <ChevronRight
          className={clsx(
            'mt-0.5 size-4 shrink-0 text-faint transition-transform',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <FolderGit2 className="size-4 shrink-0 text-faint" aria-hidden />
              {folder.label}
            </span>
            {folder.projects.length > 0 && (
              <span className="text-xs text-muted">{folder.projects.join(', ')}</span>
            )}
          </span>
          <span className="block text-xs break-all text-muted">{folder.displayPath}</span>
        </span>
        <span className="basis-full pl-6 text-xs text-ink-soft tabular-nums sm:basis-auto sm:pl-0">
          {summary}
        </span>
      </button>
      {open && (
        <div className="border-t border-line-soft px-3">
          {folder.suggestions.length ? (
            <ul className="divide-y divide-line-soft">
              {list.map((s) => (
                <SuggestionRow
                  key={s.rule}
                  s={s}
                  windowDays={windowDays}
                  onChoose={(action) => onChoose(folder, s, action)}
                />
              ))}
            </ul>
          ) : (
            <p className="py-3 text-sm text-muted">Agents didn’t ask for anything here lately.</p>
          )}
          {(hidden > 0 || folder.unfixable > 0) && (
            <div className="space-y-1 border-t border-line-soft py-2.5 text-xs text-muted">
              {!all && folder.suggestions.length > SHOWN && (
                <button
                  type="button"
                  className="font-medium text-accent hover:underline"
                  onClick={() => setAll(true)}
                >
                  Show {folder.suggestions.length - SHOWN} more
                </button>
              )}
              {all && folder.more > 0 && <p>{plural(folder.more, 'rarer rule')} not listed.</p>}
              {folder.unfixable > 0 && (
                <p>
                  {plural(folder.unfixable, 'more call')} stopped for the command’s shape (a
                  variable, cd before git) or by a built-in safety check: no rule changes those.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
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

type Pending = { folder: PermissionFolder; s: PermissionSuggestion; action: PermissionAction };

function ConfirmChange({
  pending,
  target,
  onClose,
  onWritten,
}: {
  pending: Pending;
  target: PermissionTarget;
  onClose: () => void;
  onWritten: (result: PermissionWriteResult) => void;
}) {
  const [preview, setPreview] = useState<PermissionPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const change = {
    folderId: pending.folder.id,
    rule: pending.s.rule,
    action: pending.action,
    target,
  };

  useEffect(() => {
    let cancelled = false;
    send<PermissionPreview>(PERMISSION_ROUTES.preview, change).then(
      (p) => !cancelled && setPreview(p),
      (err: unknown) => !cancelled && setError(errorText(err)),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const write = async () => {
    if (!preview) return;
    setWriting(true);
    try {
      onWritten(
        await send<PermissionWriteResult>(PERMISSION_ROUTES.write, {
          ...change,
          hash: preview.hash,
        }),
      );
    } catch (err) {
      setError(errorText(err));
      setWriting(false);
    }
  };

  const verb = pending.action === 'allow' ? 'Allow' : 'Deny';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${verb} ${pending.s.rule}`}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <div className="relative max-h-[calc(100dvh-2rem)] w-full max-w-lg animate-pop-in space-y-4 overflow-y-auto rounded-block bg-surface p-5 shadow-overlay">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold">
            {verb} <code className="text-[15px] break-all">{pending.s.rule}</code>
          </h2>
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
          {pending.action === 'allow'
            ? `Claude Code will run these without asking in ${pending.folder.label}.`
            : `Claude Code won’t run these in ${pending.folder.label}, even when asked.`}
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
              Adds it to <code>{preview.addTo}</code>
              {preview.removeFrom.length > 0 && (
                <>
                  {' '}
                  and takes it out of{' '}
                  {preview.removeFrom.map((l, i) => (
                    <span key={l}>
                      {i > 0 && ', '}
                      <code>{l}</code>
                    </span>
                  ))}
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
        <div className="flex justify-end gap-2">
          <button type="button" className={BUTTON.secondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={pending.action === 'allow' ? BUTTON.primary : BUTTON.danger}
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<PermissionTarget>('local');
  const [pending, setPending] = useState<Pending | null>(null);
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
  useEffect(load, [load]);

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

  const folders = data?.folders ?? [];
  return (
    <Section
      id="permissions"
      title="Agent permissions"
      icon={KeyRound}
      description="Pharos reads Claude Code’s session logs on this computer (never sends them anywhere) and counts the tool calls that needed your approval or were stopped, over the last two weeks. Only you, here, can write a rule; agents can’t."
    >
      <p className="text-sm text-ink-soft">
        What Claude Code agents kept asking for, per folder. Allow or Deny writes the rule into that
        folder’s <code className="text-[13px]">.claude/settings.local.json</code> (just you, not
        committed), or into the shared <code className="text-[13px]">.claude/settings.json</code> if
        you pick it.
      </p>
      <fieldset className="flex flex-wrap items-center gap-2 text-sm">
        <legend className="sr-only">Where rules go</legend>
        <span className="text-muted">Write to</span>
        {(Object.keys(PERMISSION_TARGETS) as PermissionTarget[]).map((t) => (
          <label
            key={t}
            className={clsx(
              'tap-area cursor-pointer rounded-control border px-2.5 py-1',
              target === t
                ? 'border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-100'
                : 'border-line-strong text-ink-soft',
            )}
          >
            <input
              type="radio"
              name="permission-target"
              value={t}
              checked={target === t}
              onChange={() => setTarget(t)}
              className="sr-only"
            />
            {PERMISSION_TARGETS[t].label}
          </label>
        ))}
      </fieldset>
      {done && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-tile bg-sunken px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1">
            {done.action === 'allow' ? 'Allowed' : 'Denied'}{' '}
            <code className="text-[13px]">{done.rule}</code> in{' '}
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
        <ul className="space-y-2">
          {folders.map((f, i) => (
            <FolderCard
              key={f.id}
              folder={f}
              windowDays={data.windowDays}
              open={i === 0 && f.total > 0}
              onChoose={(folder, s, action) => {
                setError(null);
                setPending({ folder, s, action });
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          No Claude Code sessions asked for permission in the last {data.windowDays} days.
        </p>
      )}
      {data && <RecentChanges recent={data.recent ?? []} onUndo={(r) => void undo(r)} />}
      {pending && (
        <ConfirmChange
          pending={pending}
          target={target}
          onClose={() => setPending(null)}
          onWritten={(result) => {
            setPending(null);
            setDone(result.record);
            load();
          }}
        />
      )}
    </Section>
  );
}
