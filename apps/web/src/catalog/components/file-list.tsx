import { runQuery, type Entity, type NodeOf } from '@pharos/schema';
import { formatDate } from '../../lib/format';
import { useViewData } from '../context';
import { Clickable } from '../interactive';
import { useOptions } from '../options';
import { Empty } from '../ui';

// R7.1 stub (docs/reframe/roadmap-2.md §3): the project's files, grouped by kind, each row
// opening the entity drawer. R7.4 builds the full block: the name search and the kind, tag, issuer
// and expiry filters (`controls`), every entry of `details`, the file drawer with its preview and
// actions, and keyboard use.

type File = Entity<'file'>;

export function FileList({ node }: { node: NodeOf<'FileList'> }) {
  const data = useViewData();
  const options = useOptions();
  const files = runQuery(data, 'file', { sort: [{ field: 'title' }], ...node.filter });
  if (!files.length) return <Empty>No files added yet</Empty>;

  const groups: { label: string; files: File[] }[] = [];
  if (node.groupBy === 'none') groups.push({ label: '', files });
  else {
    for (const option of options.list('file.kind')) {
      const inKind = files.filter((f) => f.data.kind === option.value);
      if (inKind.length) groups.push({ label: option.label, files: inKind });
    }
    const known = new Set(options.list('file.kind').map((o) => o.value));
    const rest = files.filter((f) => !known.has(f.data.kind));
    if (rest.length) groups.push({ label: 'Other', files: rest });
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label || 'Files'}>
          {group.label && (
            <h3 className="mb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              {group.label}
            </h3>
          )}
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {group.files.map((file) => (
              <li key={file.id}>
                <Clickable
                  id={file.id}
                  className="flex items-baseline justify-between gap-3 rounded px-1 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <span className="min-w-0 truncate">{file.data.title}</span>
                  <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                    {[
                      file.data.issuer,
                      file.data.expiryDate && `Expires ${formatDate(file.data.expiryDate)}`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Clickable>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
