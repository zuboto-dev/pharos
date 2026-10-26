import {
  TASK_ANSWER,
  addDays,
  nextMonday,
  type TaskAnswer,
  type TaskAnswerState,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  Ban,
  CalendarClock,
  Clock,
  Ellipsis,
  MessageSquare,
  SearchCheck,
  Undo2,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { formatDate, localToday } from '../../lib/format';
import { Menu, MenuItem } from '../menu';
import { MENU_PANEL } from '../select';
import { BUTTON } from '../ui';

/**
 * The owner's other answers on a task they were asked to do (a TaskChecklist in a report, the
 * desk): besides "Mark done", one small button opens Won't do, Later (a day, next Monday by
 * default) and Reply (their own words). Answered rows say which, compactly, with Change to
 * reopen. The words live in the accessible names and tooltips; the row shows icons.
 */

const INPUT =
  'w-full rounded-control border border-neutral-300 bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-200 dark:border-neutral-700 dark:focus:border-sky-700 dark:focus:ring-sky-900';

const ICON_BUTTON =
  'tap-area relative inline-flex size-6 shrink-0 items-center justify-center rounded-control text-faint transition hover:bg-subtle hover:text-ink-soft disabled:opacity-40';

/** Keeps clicks inside the menu and its forms from opening the row they sit in. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

/** A small panel under a button for a form (the menu's Later and Reply), in a portal. */
function Popover({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: DOMRect;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const width = Math.min(288, window.innerWidth - 16);
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - 220));
  return createPortal(
    <div data-no-open="" onClick={stop}>
      <div className="fixed inset-0 z-[60]" onClick={onClose} />
      <div
        role="dialog"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
        style={{ top, left, width }}
        className={clsx('fixed z-[61] p-3 text-sm', MENU_PANEL)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function LaterForm({ onSave }: { onSave: (until: string) => void }) {
  const today = localToday();
  const tomorrow = addDays(today, 1);
  const [until, setUntil] = useState(nextMonday(today));
  const id = useId();
  const ok = Boolean(until) && until >= tomorrow;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(until);
      }}
    >
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        <Clock aria-hidden className="size-3.5 text-faint" /> Later, on
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="date"
          autoFocus
          min={tomorrow}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className={clsx(INPUT, 'w-auto flex-1 tabular-nums dark:[color-scheme:dark]')}
        />
        <button type="submit" disabled={!ok} className={BUTTON.primary}>
          Later
        </button>
      </div>
    </form>
  );
}

function ReplyForm({ title, onSave }: { title: string; onSave: (text: string) => void }) {
  const [text, setText] = useState('');
  const id = useId();
  const send = () => {
    if (text.trim()) onSave(text.trim());
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        <MessageSquare aria-hidden className="size-3.5 text-faint" /> Reply
        <span className="sr-only"> on “{title}”</span>
      </label>
      <textarea
        id={id}
        autoFocus
        rows={3}
        maxLength={TASK_ANSWER.replyChars}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder="Instead: send it to Ana, wait for counsel first, …"
        className={INPUT}
      />
      <div className="flex justify-end">
        <button type="submit" disabled={!text.trim()} className={BUTTON.primary}>
          Reply
        </button>
      </div>
    </form>
  );
}

/**
 * The button beside "Mark done" that opens the other answers. `onAnswer` saves one (a revision
 * from a report, the desk's answer from the desk) and says whether it worked.
 */
export function OtherAnswerButton({
  title,
  busy,
  onAnswer,
}: {
  title: string;
  busy?: boolean;
  onAnswer: (answer: TaskAnswer) => Promise<unknown> | void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [mode, setMode] = useState<'menu' | 'later' | 'reply' | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setMode(null);
    setAnchor(null);
  };
  const answer = async (a: TaskAnswer) => {
    close();
    await onAnswer(a);
  };
  // Keep the panel under its button when the page scrolls or resizes.
  useEffect(() => {
    if (!mode) return;
    const place = () => button.current && setAnchor(button.current.getBoundingClientRect());
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [mode]);
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={busy}
        aria-label={`Other answer for “${title}”`}
        aria-haspopup="menu"
        aria-expanded={mode !== null}
        title="Other answer"
        data-other-answer=""
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          e.stopPropagation();
          setAnchor(e.currentTarget.getBoundingClientRect());
          setMode((m) => (m ? null : 'menu'));
        }}
        className={clsx(ICON_BUTTON, mode && 'bg-subtle text-ink-soft')}
      >
        <Ellipsis aria-hidden className="size-4" />
      </button>
      {anchor && mode === 'menu' && (
        <span data-no-open="" onClick={stop}>
          <Menu anchor={anchor} align="end" label={`Answer “${title}”`} onClose={close}>
            <MenuItem icon={Ban} onClick={() => void answer({ kind: 'wontDo' })}>
              Won’t do
            </MenuItem>
            <MenuItem icon={Clock} onClick={() => setMode('later')}>
              Later…
            </MenuItem>
            <MenuItem icon={MessageSquare} onClick={() => setMode('reply')}>
              Reply…
            </MenuItem>
          </Menu>
        </span>
      )}
      {anchor && mode === 'later' && (
        <Popover anchor={anchor} label={`Later: “${title}”`} onClose={close}>
          <LaterForm onSave={(until) => void answer({ kind: 'later', until })} />
        </Popover>
      )}
      {anchor && mode === 'reply' && (
        <Popover anchor={anchor} label={`Reply on “${title}”`} onClose={close}>
          <ReplyForm title={title} onSave={(text) => void answer({ kind: 'reply', text })} />
        </Popover>
      )}
    </>
  );
}

/**
 * How the owner answered a task, in one quiet line: an icon and "Won't do", "Later · Oct 27" or
 * their reply (clamped to a line; all of it in the tooltip), then Change to reopen it.
 */
export function TaskAnswered({
  title,
  state,
  reply,
  until,
  busy,
  onChange,
}: {
  title: string;
  state: Exclude<TaskAnswerState, 'open' | 'done'>;
  reply?: string;
  until?: string;
  busy?: boolean;
  onChange: () => void;
}) {
  const [Icon, text, full] =
    state === 'wontDo'
      ? [Ban, 'Won’t do', 'Won’t do']
      : state === 'later'
        ? [CalendarClock, `Later · ${formatDate(until ?? '', true)}`, `Later, on ${until}`]
        : state === 'review'
          ? [SearchCheck, 'Needs review', 'Nothing left for you: an agent checks it']
          : [MessageSquare, reply ?? '', `Your reply: ${reply ?? ''}`];
  return (
    <span data-task-answer={state} className="flex min-w-0 shrink items-center gap-1">
      <span
        title={full}
        className="flex min-w-0 items-center gap-1 text-xs text-muted"
        data-no-open=""
      >
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="max-w-[16rem] truncate">{text}</span>
      </span>
      <button
        type="button"
        disabled={busy}
        aria-label={`Change answer on “${title}”`}
        title="Change"
        onClick={(e) => {
          e.stopPropagation();
          onChange();
        }}
        className={ICON_BUTTON}
      >
        <Undo2 aria-hidden className="size-3.5" />
      </button>
    </span>
  );
}
