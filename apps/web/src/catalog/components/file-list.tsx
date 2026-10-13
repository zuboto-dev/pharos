import { FILE_LIST_CONTROLS, fileTypeOf, runQuery, type Entity, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import { File, FileAudio, FileImage, FileSpreadsheet, FileText, Search, X } from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { expiryOf, extensionOf, fileName, formatSize, type Expiry } from '../../files/files';
import { formatDate, localToday, plural } from '../../lib/format';
import { useBoardFiles } from '../board-files';
import { useViewData } from '../context';
import { Clickable } from '../interactive';
import { OptionBadge, useOptions } from '../options';
import { Select } from '../select';
import { Badge, Empty } from '../ui';
import { GlanceDate } from '../../files/glance';
import { PlayButton, isAudio } from '../../files/audio';

// The project's files (docs/reframe/roadmap-2.md §3): find a named document fast and open it in
// the file drawer (preview, details, actions). Grouped by kind, with a name search and filters
// for kind, tag, issuer and expiry. Keyboard: ↓ from the search moves into the list, ↑ ↓ move
// between files, Enter opens one (Enter in the search opens the first match). With `showIn`
// naming a FileView on the same board, a row shows its file there instead (R7.11).

type FileEntity = Entity<'file'>;
type Control = (typeof FILE_LIST_CONTROLS)[number];
type Detail = NonNullable<NodeOf<'FileList'>['details']>[number];
type ExpiryFilter = '' | Expiry | 'any' | 'none';

const SPREADSHEETS = new Set(['csv', 'xls', 'xlsx', 'numbers']);
const AUDIO = new Set(['m4a', 'mp3', 'wav', 'ogg', 'flac', 'aif', 'aiff']);

/** An icon for the file's type, from its extension (never its contents). */
export function FileTypeIcon({ path, className }: { path: string; className?: string }) {
  const ext = extensionOf(path);
  const preview = fileTypeOf(path).preview;
  const Icon =
    preview === 'image'
      ? FileImage
      : AUDIO.has(ext)
        ? FileAudio
        : SPREADSHEETS.has(ext)
          ? FileSpreadsheet
          : preview === 'none' && !['doc', 'docx', 'pages', 'rtf'].includes(ext)
            ? File
            : FileText;
  return <Icon className={clsx('shrink-0', className)} aria-hidden />;
}

const EXPIRY_TONE = { expired: 'red', soon: 'amber', later: 'muted' } as const;

/** "Expired Mar 2, 2026", "Expires in 12 days", "Expires Dec 31, 2026". */
export function ExpiryBadge({ date, today = localToday() }: { date: string; today?: string }) {
  const state = expiryOf(date, today)!;
  const text = state === 'expired' ? `Expired ${formatDate(date)}` : `Expires ${formatDate(date)}`;
  return <Badge tone={EXPIRY_TONE[state]}>{text}</Badge>;
}

const EXPIRY_CHOICES: { value: ExpiryFilter; label: string }[] = [
  { value: '', label: 'Any expiry' },
  { value: 'expired', label: 'Expired' },
  { value: 'soon', label: 'Expires within 60 days' },
  { value: 'later', label: 'Expires later' },
  { value: 'none', label: 'No expiry date' },
];

function matchesExpiry(file: FileEntity, filter: ExpiryFilter, today: string): boolean {
  if (!filter || filter === 'any') return true;
  const state = expiryOf(file.data.expiryDate, today);
  return filter === 'none' ? state === null : state === filter;
}

const unique = (values: (string | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));

/** Lowercased words, so "tax 2025" finds "2025 Tax return.pdf". */
const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

function FileRow({
  file,
  details,
  showKind,
  today,
  onOpen,
  shown,
}: {
  file: FileEntity;
  /** What follows the title; by default the glance: the one date that matters (v0.2 B2). */
  details: Detail[] | undefined;
  showKind: boolean;
  today: string;
  /** Shows the file in a FileView on the board instead of opening the drawer. */
  onOpen?: () => void;
  /** The file is the one that FileView shows now. */
  shown?: boolean;
}) {
  const d = file.data;
  const parts: string[] = [];
  for (const detail of details ?? []) {
    if (detail === 'issuer' && d.issuer) parts.push(d.issuer);
    if (detail === 'issuedDate' && d.issuedDate) parts.push(formatDate(d.issuedDate));
    if (detail === 'size') parts.push(formatSize(d.size));
    if (detail === 'modifiedAt') parts.push(`Changed ${formatDate(d.modifiedAt.slice(0, 10))}`);
  }
  const showExpiry = d.expiryDate && details?.includes('expiryDate');
  const tags = details?.includes('tags') ? d.tags : [];
  return (
    <Clickable
      id={file.id}
      title={fileName(d.path)}
      onOpen={onOpen}
      pressed={onOpen ? !!shown : undefined}
      className={clsx(
        'flex items-start gap-2.5 rounded-control px-1.5 py-2 sm:items-center',
        shown ? 'bg-sky-50 dark:bg-sky-950/50' : 'hover:bg-sunken',
      )}
    >
      <FileTypeIcon path={d.path} className="mt-0.5 size-4 text-faint sm:mt-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-center">
        <span className="min-w-0 truncate text-sm font-medium text-ink sm:flex-1">{d.title}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted sm:shrink-0 sm:justify-end">
          {showKind && <OptionBadge field="file.kind" value={d.kind} />}
          {parts.length > 0 && <span className="truncate">{parts.join(' · ')}</span>}
          {tags.map((tag) => (
            <Badge key={tag} tone="muted">
              #{tag}
            </Badge>
          ))}
          {showExpiry && <ExpiryBadge date={d.expiryDate!} today={today} />}
          {!details && <GlanceDate file={d} today={today} />}
        </span>
      </div>
    </Clickable>
  );
}

/** ↑ ↓ Home End move between the rows of every group; the search hands focus over with ↓. */
function moveFocus(e: KeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  if (!container || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const rows = [...container.querySelectorAll<HTMLElement>('li > [role="button"]')];
  if (!rows.length) return;
  const index = rows.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : index < 0
          ? 0
          : Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
  e.preventDefault();
  rows[next]!.focus();
}

export function FileList({ node }: { node: NodeOf<'FileList'> }) {
  const data = useViewData();
  const options = useOptions();
  const today = localToday();
  const controls = new Set<Control>(node.controls ?? FILE_LIST_CONTROLS);
  const details = node.details;
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [issuer, setIssuer] = useState('');
  const [expiry, setExpiry] = useState<ExpiryFilter>('');
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const boardFiles = useBoardFiles();
  // A FileView on the same board to show tapped files in; else rows open the drawer.
  const target = node.showIn && boardFiles?.has(node.showIn) ? node.showIn : undefined;
  const openFile = (fileId: string) => {
    if (!target) return data.actions.open({ entity: fileId });
    boardFiles!.show(target, fileId);
    const widget = document.querySelector<HTMLElement>(`[data-widget="${CSS.escape(target)}"]`);
    // On a phone the FileView sits below the list: bring it into view.
    widget?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  };
  const shownId = target ? boardFiles!.shown(target) : undefined;

  const all = useMemo(
    () => runQuery(data, 'file', { sort: [{ field: 'title' }], ...node.filter }),
    [data, node.filter],
  );
  const kindLabel = (value: string) => options.get('file.kind', value).label;

  const terms = words(query);
  const shown = all.filter((f) => {
    if (kind && f.data.kind !== kind) return false;
    if (tag && !f.data.tags.includes(tag)) return false;
    if (issuer && f.data.issuer !== issuer) return false;
    if (!matchesExpiry(f, expiry, today)) return false;
    if (!terms.length) return true;
    const text = [
      f.data.title,
      fileName(f.data.path),
      f.data.issuer,
      kindLabel(f.data.kind),
      ...f.data.tags,
    ]
      .join(' ')
      .toLowerCase();
    return terms.every((t) => text.includes(t));
  });

  if (!all.length) {
    return (
      <Empty>
        {data.files?.length ? 'No files match this list' : 'No files added to this project yet'}
      </Empty>
    );
  }

  const kinds = unique(all.map((f) => f.data.kind));
  const tags = unique(all.flatMap((f) => f.data.tags));
  const issuers = unique(all.map((f) => f.data.issuer));
  const hasExpiry = all.some((f) => f.data.expiryDate);
  const filtering = Boolean(query || kind || tag || issuer || expiry);
  const clear = () => {
    setQuery('');
    setKind('');
    setTag('');
    setIssuer('');
    setExpiry('');
  };

  const groups: { label: string; files: FileEntity[] }[] = [];
  if (node.groupBy === 'none') groups.push({ label: '', files: shown });
  else {
    const known = options.list('file.kind');
    for (const option of known) {
      const inKind = shown.filter((f) => f.data.kind === option.value);
      if (inKind.length) groups.push({ label: option.label, files: inKind });
    }
    const values = new Set(known.map((o) => o.value));
    const rest = shown.filter((f) => !values.has(f.data.kind));
    if (rest.length) groups.push({ label: 'Other', files: rest });
  }

  const filters = [
    controls.has('kind') && kinds.length > 1 && (
      <Select
        key="kind"
        label="Kind"
        value={kind}
        onChange={setKind}
        className="w-auto"
        options={[
          { value: '', label: 'All kinds' },
          ...kinds.map((k) => ({
            value: k,
            label: kindLabel(k),
            color: options.get('file.kind', k).color,
          })),
        ]}
      />
    ),
    controls.has('tag') && tags.length > 0 && (
      <Select
        key="tag"
        label="Tag"
        value={tag}
        onChange={setTag}
        className="w-auto"
        options={[
          { value: '', label: 'All tags' },
          ...tags.map((t) => ({ value: t, label: `#${t}` })),
        ]}
      />
    ),
    controls.has('issuer') && issuers.length > 1 && (
      <Select
        key="issuer"
        label="Issuer"
        value={issuer}
        onChange={setIssuer}
        className="w-auto"
        options={[
          { value: '', label: 'All issuers' },
          ...issuers.map((i) => ({ value: i, label: i })),
        ]}
      />
    ),
    controls.has('expiry') && hasExpiry && (
      <Select
        key="expiry"
        label="Expiry"
        value={expiry}
        onChange={(v) => setExpiry(v as ExpiryFilter)}
        className="w-auto"
        options={EXPIRY_CHOICES}
      />
    ),
  ].filter(Boolean);

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && shown[0]) {
      e.preventDefault();
      openFile((groups[0]?.files[0] ?? shown[0]).id);
    } else if (e.key === 'Escape' && query) {
      e.stopPropagation();
      setQuery('');
    } else if (e.key === 'ArrowDown') moveFocus(e, list);
  };

  return (
    <div className="space-y-3">
      {(controls.has('search') || filters.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {controls.has('search') && (
            <label className="relative min-w-0 flex-1 basis-48">
              <span className="sr-only">Find a file</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-neutral-400"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKey}
                placeholder="Find a file by name, issuer or tag"
                className="w-full rounded-control border border-line-strong bg-surface py-1.5 pr-2.5 pl-8 text-sm placeholder:text-neutral-400 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:outline-none dark:focus-visible:ring-sky-800"
              />
            </label>
          )}
          {filters}
        </div>
      )}
      {filtering && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span role="status">
            {shown.length} of {plural(all.length, 'file')}
          </span>
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 rounded px-1 hover:text-ink"
          >
            <X className="size-3" aria-hidden /> Clear filters
          </button>
        </div>
      )}
      <div ref={setList} onKeyDown={(e) => moveFocus(e, list)} className="space-y-4">
        {groups.map((group) => (
          <section key={group.label || 'files'} aria-label={group.label || 'Files'}>
            {group.label && (
              <h4 className="mb-0.5 flex items-baseline gap-1.5 px-1.5 text-xs font-medium tracking-wide text-muted uppercase">
                {group.label}
                <span className="font-normal text-faint normal-case">{group.files.length}</span>
              </h4>
            )}
            <ul className="divide-y divide-line-soft">
              {group.files.map((file) => (
                <li
                  key={file.id}
                  className="flex items-center gap-1 [&>[role=button]]:min-w-0 [&>[role=button]]:flex-1"
                >
                  <FileRow
                    file={file}
                    details={details}
                    showKind={node.groupBy === 'none'}
                    today={today}
                    onOpen={target ? () => openFile(file.id) : undefined}
                    shown={shownId === file.id}
                  />
                  {/* Audio plays in place (R9), beside the row rather than inside its button. */}
                  {isAudio(file.data.path) && (
                    <PlayButton fileId={file.id} title={file.data.title} className="mr-1" />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {!shown.length && <Empty>No files match. Try fewer words or clear the filters.</Empty>}
      </div>
    </div>
  );
}
