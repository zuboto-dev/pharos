import {
  matchRanges,
  searchWords,
  type EntityType,
  type SearchHit,
  type SearchResult,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  BadgeCheck,
  BookOpen,
  CornerDownLeft,
  File,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Milestone,
  NotebookPen,
  Package,
  Scale,
  Search,
  Shapes,
  Target,
  type LucideIcon,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { Tooltip } from '../catalog/tooltip';
import { isSearchShortcut, searchShortcut } from './shortcut';

/** How each kind of result looks: its icon and its group's heading. */
export const KINDS: Partial<Record<EntityType, { Icon: LucideIcon; group: string }>> = {
  project: { Icon: FolderKanban, group: 'Projects' },
  task: { Icon: ListChecks, group: 'Tasks' },
  decision: { Icon: Scale, group: 'Decisions' },
  goal: { Icon: Target, group: 'Goals' },
  view: { Icon: LayoutDashboard, group: 'Views and reports' },
  claim: { Icon: BadgeCheck, group: 'Findings' },
  stage: { Icon: Milestone, group: 'Stages' },
  scope_item: { Icon: Shapes, group: 'Scope' },
  artifact: { Icon: Package, group: 'Artifacts' },
  request: { Icon: MessageCircleQuestion, group: 'Questions' },
  term: { Icon: BookOpen, group: 'Terms' },
  record: { Icon: NotebookPen, group: 'Records' },
  file: { Icon: File, group: 'Files' },
};
const kindOf = (type: EntityType) => KINDS[type] ?? { Icon: File, group: 'Other' };

/** Wait after the last keystroke before asking the server. */
export const SEARCH_DEBOUNCE_MS = 120;

const RECENT_KEY = 'pharos-search-recent';
const RECENT_MAX = 6;

type Recent = Pick<SearchHit, 'id' | 'type' | 'title' | 'project' | 'projectId' | 'href'>;

function readRecent(): Recent[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(list)
      ? list.filter((r): r is Recent => !!r && typeof r.href === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function remember(hit: Recent) {
  try {
    const { id, type, title, project, projectId, href } = hit;
    const list = [
      { id, type, title, project, projectId, href },
      ...readRecent().filter((r) => r.id !== id),
    ];
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // Not remembered: the list stays as it was.
  }
}

// ---------------------------------------------------------------- open state

type SearchState = { open: boolean; setOpen: (open: boolean | ((o: boolean) => boolean)) => void };
const SearchContext = createContext<SearchState | null>(null);

/** The palette, and ⌘K (Ctrl+K elsewhere) toggling it from any page. */
export function SearchProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const state = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <SearchContext.Provider value={state}>
      {children}
      {open && <SearchPalette onClose={() => setOpen(false)} />}
    </SearchContext.Provider>
  );
}

/** The way in for a mouse or a finger: the rail, the sidebar's header and the phone bar. */
export function SearchButton({ className }: { className?: string }) {
  const state = useContext(SearchContext);
  if (!state) return null;
  return (
    <Tooltip label="Search" shortcut={searchShortcut()} className={className}>
      <button
        type="button"
        aria-label="Search"
        aria-haspopup="dialog"
        onClick={() => state.setOpen(true)}
        className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink"
      >
        <Search aria-hidden className="size-4" />
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------- the palette

/** `text` with the query's words marked. */
function Marked({ text, words }: { text: string; words: string[] }) {
  const ranges = matchRanges(text, words);
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark
        key={start}
        className="rounded-[2px] bg-amber-100 text-ink dark:bg-amber-400/25 dark:text-ink"
      >
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

type Loaded = { query: string; hits: SearchHit[] } | { query: string; error: true };

function useSearch(query: string): { loaded?: Loaded; pending: boolean } {
  const [loaded, setLoaded] = useState<Loaded>();
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=30`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as SearchResult;
          setLoaded({ query: trimmed, hits: body.hits });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoaded({ query: trimmed, error: true });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);
  return { loaded: trimmed ? loaded : undefined, pending: !!trimmed && loaded?.query !== trimmed };
}

type Group = { heading: string; rows: Recent[] };

/** Results by kind, the kinds in the order of their best result. */
function groupHits(hits: SearchHit[]): Group[] {
  const groups = new Map<string, Group>();
  for (const hit of hits) {
    const heading = kindOf(hit.type).group;
    let group = groups.get(heading);
    if (!group) groups.set(heading, (group = { heading, rows: [] }));
    group.rows.push(hit);
  }
  return [...groups.values()];
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const { loaded, pending } = useSearch(query);
  const words = useMemo(() => searchWords(query), [query]);
  const [recent] = useState(readRecent);

  // Back where you were when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => before?.focus?.();
  }, []);

  const groups: Group[] = useMemo(() => {
    if (!query.trim()) return recent.length ? [{ heading: 'Recently opened', rows: recent }] : [];
    // While the next results load, the last ones stay (no flicker on every keystroke).
    return loaded && 'hits' in loaded ? groupHits(loaded.hits) : [];
  }, [query, loaded, recent]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const offsets = useMemo(() => new Map(rows.map((row, i) => [row, i])), [rows]);
  const snippets = useMemo(
    () => new Map(rows.map((r) => [r.id, (r as Partial<SearchHit>).snippet])),
    [rows],
  );

  // The highlighted row, back to the first whenever the rows change.
  const [picked, setPicked] = useState<{ rows: Recent[]; index: number }>({ rows, index: 0 });
  const active = picked.rows === rows ? picked.index : 0;
  const setActive = (index: number) => setPicked({ rows, index });
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const go = useCallback(
    (row: Recent) => {
      remember(row);
      onClose();
      navigate(row.href);
    },
    [navigate, onClose],
  );

  // Enter typed before the results of what was typed came: open the first of them once they do.
  const [queuedFor, setQueuedFor] = useState<string | null>(null);
  useEffect(() => {
    if (pending || !loaded || queuedFor !== loaded.query || queuedFor !== query.trim()) return;
    if (rows[0]) go(rows[0]);
  }, [queuedFor, pending, loaded, query, rows, go]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((active + step + rows.length) % rows.length);
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      if (pending) {
        e.preventDefault();
        setQueuedFor(query.trim());
        return;
      }
      const row = rows[active];
      if (!row) return;
      e.preventDefault();
      go(row);
    }
  };

  const optionId = (index: number) => `${id}-option-${index}`;
  const searched = loaded && loaded.query === query.trim();

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      data-search-palette=""
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-4 md:pt-[12vh]"
    >
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-neutral-900/30 dark:bg-black/50"
        onClick={onClose}
      />
      <div className="relative flex max-h-[min(36rem,calc(100dvh-2rem))] w-full max-w-xl animate-pop-in flex-col overflow-hidden rounded-block border border-line bg-surface shadow-overlay">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          {pending ? (
            <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-faint" />
          ) : (
            <Search aria-hidden className="size-4 shrink-0 text-faint" />
          )}
          <input
            ref={input}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={`${id}-list`}
            aria-activedescendant={rows.length ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Search everything"
            placeholder="Search projects, tasks, decisions, pages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="h-12 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint md:text-sm"
          />
          <kbd className="hidden shrink-0 rounded-control border border-line px-1.5 py-0.5 text-[11px] text-faint md:inline">
            Esc
          </kbd>
        </div>
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 empty:hidden"
        >
          {groups.map((group) => (
            <div key={group.heading} role="group" aria-label={group.heading} className="pb-1">
              <div className="px-2.5 pt-2 pb-1 text-xs font-medium text-muted">{group.heading}</div>
              {group.rows.map((row) => {
                const i = offsets.get(row) ?? 0;
                const { Icon } = kindOf(row.type);
                const snippet = snippets.get(row.id);
                const selected = i === active;
                return (
                  <div
                    key={`${row.type}-${row.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={selected}
                    data-index={i}
                    onMouseMove={() => i !== active && setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(row)}
                    className={clsx(
                      'flex cursor-pointer items-start gap-3 rounded-tile px-2.5 py-2 text-sm',
                      selected ? 'bg-subtle' : '',
                    )}
                  >
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate font-medium text-ink">
                          <Marked text={row.title} words={words} />
                        </span>
                        {row.type !== 'project' && (
                          <span className="ml-auto max-w-[40%] shrink-0 truncate text-xs text-muted">
                            {row.project}
                          </span>
                        )}
                      </span>
                      {snippet && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-ink-soft">
                          <Marked text={snippet} words={words} />
                        </span>
                      )}
                    </span>
                    {selected && (
                      <CornerDownLeft
                        aria-hidden
                        className="mt-0.5 hidden size-3.5 shrink-0 text-faint md:block"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {!rows.length && (
          <p className="px-4 py-6 text-center text-sm text-muted" role="status">
            {!query.trim()
              ? 'Find any project, task, decision, page or finding by its words.'
              : loaded && 'error' in loaded && searched
                ? 'Search isn’t answering right now. Try again in a moment.'
                : searched
                  ? `Nothing matches “${query.trim()}”.`
                  : 'Searching…'}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
