import clsx from 'clsx';
import type { EntityType } from '@pharos/schema';
import { FilePlus, Inbox, MessageCircleQuestion, type LucideIcon } from 'lucide-react';
import { createContext, useContext, type ReactNode } from 'react';
import { useViewData } from './context';
import { BUTTON } from './ui';

// Empty states (v0.2 B8): a block with nothing to show says what's missing and the next step,
// with a button when the reader can act. The pattern is "icon, line and a button" (option B in the
// R7.13 UI examples): an icon in a soft circle, one line for what's missing, a quieter line for
// what to do, then the action (Add task, Add files, Ask an agent…).

/** Asks the agent about the block this is in (set per board widget); undefined where asking isn't available. */
export type AskHere = (question?: string) => void;

const AskHereContext = createContext<AskHere | null>(null);

export function AskHereProvider({ ask, children }: { ask: AskHere | null; children: ReactNode }) {
  return <AskHereContext.Provider value={ask}>{children}</AskHereContext.Provider>;
}

/** Ask the agent about this block, prefilled with `question`; undefined when asking isn't available. */
export function useAskHere(): AskHere | undefined {
  const here = useContext(AskHereContext);
  const { actions } = useViewData();
  if (!actions.ask) return undefined;
  if (here) return here;
  return (question) => actions.ask!({ label: 'This block', question });
}

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
  className,
}: {
  icon: LucideIcon;
  /** What's missing, e.g. "No tasks yet". */
  title: string;
  /** The next step, e.g. "Add the first one, or ask your agent to plan the work." */
  hint?: ReactNode;
  /** The actions: buttons the reader can use right here. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-empty-state
      className={clsx('flex flex-col items-center gap-1 px-2 py-5 text-center', className)}
    >
      <span className="mb-1.5 grid size-10 place-items-center rounded-full bg-sky-50 text-accent dark:bg-sky-950/60">
        <Icon className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {children && (
        <div
          data-no-open
          className="mt-2.5 flex w-full max-w-sm flex-wrap items-center justify-center gap-2"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * "Ask an agent" in an empty state, prefilled with what to ask; nothing where asking isn't
 * available (a static page, a test).
 */
export function AskAgentButton({
  question,
  children = 'Ask an agent',
}: {
  question: string;
  children?: ReactNode;
}) {
  const ask = useAskHere();
  if (!ask) return null;
  return (
    <button type="button" onClick={() => ask(question)} className={BUTTON.secondary}>
      <MessageCircleQuestion className="size-3.5" aria-hidden /> {children}
    </button>
  );
}

/** What a list of each type is called in an empty state ("No findings match this list"). */
const PLURAL: Record<EntityType, string> = {
  section: 'sections',
  repository: 'repositories',
  assignee: 'people',
  project: 'projects',
  goal: 'goals',
  scope_item: 'scope items',
  stage: 'stages',
  task: 'tasks',
  artifact: 'artifacts',
  decision: 'decisions',
  view: 'views',
  request: 'questions',
  claim: 'findings',
  term: 'terms',
  file: 'files',
  record: 'records',
  comment: 'comments',
};

export const FILES_HINT =
  'Add statements, receipts or certificates from your folders. They stay where they are.';

/**
 * A query block (DataTable, DataList, CountChart) with no rows: whether the project has none of
 * that type yet or none match the block's filter, and the next step for each.
 */
export function NothingMatches({ type }: { type: EntityType }) {
  const { entityById } = useViewData();
  const words = PLURAL[type];
  const any = [...entityById.values()].some((e) => e.type === type);
  if (type === 'file')
    return (
      <EmptyState
        icon={Inbox}
        title={any ? 'No files match this list' : 'No files in this project yet'}
        hint={any ? 'Files that match its filter show up here.' : FILES_HINT}
      >
        {!any && <AddFilesActions />}
      </EmptyState>
    );
  return (
    <EmptyState
      icon={Inbox}
      title={any ? `No ${words} match this list` : `No ${words} yet`}
      hint={
        any
          ? `${words[0]!.toUpperCase()}${words.slice(1)} that match its filter show up here.`
          : `When this project has ${words}, they show up here.`
      }
    >
      <AskAgentButton question={`Add the ${words} this list should show.`} />
    </EmptyState>
  );
}

const AddFilesContext = createContext<(() => void) | null>(null);

/** Where "Add files" opens the picker in place (the Files page) instead of going to that page. */
export function AddFilesProvider({ onAdd, children }: { onAdd: () => void; children: ReactNode }) {
  return <AddFilesContext.Provider value={onAdd}>{children}</AddFilesContext.Provider>;
}

/**
 * "Add files" (the project's Files page, which opens its picker) and "Ask an agent for a folder",
 * for blocks with no files.
 */
export function AddFilesActions({ onAdd: given }: { onAdd?: () => void }) {
  const { project } = useViewData();
  const fromPage = useContext(AddFilesContext);
  const onAdd = given ?? fromPage ?? undefined;
  return (
    <>
      {onAdd ? (
        <button type="button" onClick={onAdd} className={BUTTON.accent}>
          <FilePlus className="size-3.5" aria-hidden /> Add files
        </button>
      ) : (
        <a
          href={`/projects/${encodeURIComponent(project.id)}/files?add=1`}
          className={BUTTON.accent}
        >
          <FilePlus className="size-3.5" aria-hidden /> Add files
        </a>
      )}
      <AskAgentButton question="Find the folder with this project’s documents and ask me for access to it.">
        Ask an agent for a folder
      </AskAgentButton>
    </>
  );
}
