import { FILE_EXPIRY_SOON, fileDue, type Due, type Entity } from '@pharos/schema';
import { CalendarClock, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useViewData } from '../catalog/context';
import { formatDate, localToday, plural } from '../lib/format';

/**
 * Expiry reminders (R7.15): a quiet notice on the project page for files that expired or expire
 * within 60 days (FILE_EXPIRY_SOON), soonest first. Dismissing it hides it until the list
 * changes (remembered in this browser only).
 */

export type Expiring = { file: Entity<'file'>; due: Due };

export function expiringFiles(files: Entity<'file'>[], today: string): Expiring[] {
  return files
    .flatMap((file) => {
      const due = fileDue(file.data.expiryDate, today);
      return due && (due.days ?? Infinity) <= FILE_EXPIRY_SOON.urgentDays ? [{ file, due }] : [];
    })
    .sort((a, b) => (a.due.days ?? 0) - (b.due.days ?? 0));
}

/** "expired 2 Oct", "expires today", "expires 3 Nov (in 21 days)". */
export function expiryText(due: Due): string {
  const date = formatDate(due.date!, true);
  const days = due.days ?? 0;
  if (days < 0) return `expired ${date}`;
  if (days === 0) return 'expires today';
  return `expires ${date} (in ${plural(days, 'day')})`;
}

const key = (projectId: string) => `pharos:expiry-dismissed:${projectId}`;

function readDismissed(projectId: string): string | null {
  try {
    return window.localStorage.getItem(key(projectId));
  } catch {
    return null;
  }
}

export function ExpiryNotice() {
  const { project, files, actions } = useViewData();
  const list = expiringFiles(files ?? [], localToday());
  const signature = list.map((e) => `${e.file.id}:${e.file.data.expiryDate}`).join(',');
  const [dismissed, setDismissed] = useState(() => readDismissed(project.id));
  if (!list.length || dismissed === signature) return null;
  const expired = list.filter((e) => (e.due.days ?? 0) < 0).length;
  const heading =
    expired === list.length
      ? `${plural(list.length, 'file')} expired`
      : expired
        ? `${plural(list.length, 'file')} expired or expire within ${FILE_EXPIRY_SOON.urgentDays} days`
        : `${plural(list.length, 'file')} ${list.length === 1 ? 'expires' : 'expire'} within ${FILE_EXPIRY_SOON.urgentDays} days`;
  const dismiss = () => {
    try {
      window.localStorage.setItem(key(project.id), signature);
    } catch {
      // Private windows may refuse storage; it still hides for now.
    }
    setDismissed(signature);
  };
  return (
    <section
      aria-label="Expiring files"
      className="flex items-start gap-3 rounded-tile border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
    >
      <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{heading}</p>
        <ul className="space-y-0.5">
          {list.slice(0, 3).map(({ file, due }) => (
            <li key={file.id} className="flex flex-wrap items-baseline gap-x-1.5">
              <button
                type="button"
                onClick={() => actions.open({ entity: file.id })}
                className="min-w-0 truncate text-left font-medium underline decoration-amber-400 underline-offset-2 hover:decoration-amber-700 dark:decoration-amber-700"
              >
                {file.data.title}
              </button>
              <span className="text-amber-800 dark:text-amber-300">{expiryText(due)}</span>
            </li>
          ))}
        </ul>
        {list.length > 3 && (
          <p className="text-xs">
            {list.length - 3} more on the{' '}
            <Link to={`/projects/${project.id}/files`} className="underline underline-offset-2">
              Files page
            </Link>
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss until the list changes"
        title="Dismiss until the list changes"
        className="-m-1 rounded p-1.5 text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"
      >
        <X aria-hidden className="size-4" />
      </button>
    </section>
  );
}
