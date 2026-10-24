import {
  DELIVERABLE_KINDS,
  type Deliverable,
  type DeliverableKind,
  type Entity,
} from '@pharos/schema';
import {
  Database,
  FileText,
  GitCommitHorizontal,
  Link2,
  Package,
  PanelsTopLeft,
  Square,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useViewData } from './context';
import { EditableList } from './editable';
import { EntityRef } from './interactive';

/**
 * A task's details in the drawer: what to do (numbered), when it's done (a checklist look; the
 * checks are statements, not state) and what it produces (by kind). The owner edits each list in
 * place, one item per line.
 */
export function TaskDetails({ task }: { task: Entity<'task'> }) {
  return (
    <div className="space-y-5" data-task-details="">
      <Part title="What to do">
        <EditableList
          entity={task}
          field="actions"
          addLabel="Add steps"
          placeholder="One step per line, in order"
          display={(items) => (
            <ol className="list-decimal space-y-1 pl-5 text-sm marker:text-faint">
              {items.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ol>
          )}
        />
      </Part>
      <Part title="Done when">
        <EditableList
          entity={task}
          field="acceptance"
          addLabel="Add checks"
          placeholder="One “done when” statement per line"
          display={(items) => (
            <ul className="space-y-1 text-sm">
              {items.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Square aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}
        />
      </Part>
      <Part title="Produces">
        <EditableList<Deliverable>
          entity={task}
          field="deliverables"
          addLabel="Add results"
          placeholder={`One per line: label | kind | where\nkinds: ${DELIVERABLE_KINDS.join(', ')}`}
          toLine={deliverableLine}
          fromLine={parseDeliverable}
          display={(items) => (
            <ul className="space-y-1.5 text-sm">
              {items.map((d, i) => (
                <DeliverableItem key={i} item={d} />
              ))}
            </ul>
          )}
        />
      </Part>
    </div>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

const KIND_ICONS: Record<DeliverableKind, LucideIcon> = {
  file: FileText,
  page: PanelsTopLeft,
  link: Link2,
  commit: GitCommitHorizontal,
  record: Database,
  other: Package,
};

function DeliverableItem({ item }: { item: Deliverable }) {
  const Icon = KIND_ICONS[item.kind ?? 'other'];
  return (
    <li className="flex items-start gap-2" data-kind={item.kind ?? 'other'}>
      <Icon aria-label={item.kind ?? 'other'} className="mt-0.5 size-3.5 shrink-0 text-muted" />
      <span className="min-w-0 space-y-0.5">
        <span className="block">{item.label}</span>
        {item.ref && <DeliverableRef value={item.ref} />}
      </span>
    </li>
  );
}

/** Where a result is: a Pharos record opens, a URL opens in a new tab, anything else is code. */
function DeliverableRef({ value }: { value: string }) {
  const { entityById } = useViewData();
  if (entityById.has(value)) return <EntityRef id={value} />;
  if (/^https?:\/\//i.test(value))
    return (
      <a
        href={value}
        target="_blank"
        rel="noreferrer noopener"
        className="block truncate text-xs text-accent-strong hover:underline"
      >
        {value}
      </a>
    );
  return (
    <code className="block rounded bg-sunken px-1 py-0.5 text-xs break-all text-ink-soft">
      {value}
    </code>
  );
}

function deliverableLine(d: Deliverable): string {
  return [d.label, d.kind ?? '', d.ref ?? ''].join(' | ').replace(/( \| )+$/, '');
}

/** "label | kind | where"; a kind that isn't one is read as the where. */
export function parseDeliverable(line: string): Deliverable | null {
  const [label = '', ...rest] = line.split('|').map((p) => p.trim());
  if (!label) return null;
  const kind = DELIVERABLE_KINDS.find((k) => k === rest[0]?.toLowerCase());
  // An empty kind ("label |  | where", as a result without one is written) is skipped too.
  const ref = (kind || rest[0] === '' ? rest.slice(1) : rest).join(' | ').trim();
  return { label, ...(kind ? { kind } : {}), ...(ref ? { ref } : {}) };
}
