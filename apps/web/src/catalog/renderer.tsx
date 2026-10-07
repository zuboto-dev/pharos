import {
  toBoard,
  type ComponentName,
  type NodeOf,
  type ViewNode,
  type ViewSpec,
} from '@pharos/schema';
import { BoardView, type BoardChange } from './board';
import clsx from 'clsx';
import { Component, useState, type ReactNode } from 'react';
import { COMPONENTS } from './components';
import { Panel } from './ui';

const COLS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
};
const SPANS: Record<number, string> = {
  1: '',
  2: 'md:col-span-2',
  3: 'md:col-span-3',
  4: 'md:col-span-4',
};

class NodeErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { error: Error | null }
> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
        <strong>{this.props.name}</strong> failed to render: {this.state.error.message}
      </div>
    );
  }
}

function Heading({ title, description }: { title?: string; description?: string }) {
  if (!title && !description) return null;
  return (
    <header className="space-y-0.5">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {description && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
      )}
    </header>
  );
}

function Children({ nodes }: { nodes: ViewNode[] }) {
  return nodes.map((child, i) => <Node key={i} node={child} />);
}

function Grid({ node }: { node: NodeOf<'Grid'> }) {
  return (
    <div className="space-y-3">
      <Heading title={node.title} />
      <div className={clsx('grid grid-cols-1 gap-4', COLS[node.columns ?? 2])}>
        {node.children.map((child, i) => (
          // Children stretch to the row's height so neighbouring panels line up.
          <div
            key={i}
            className={clsx(
              'flex min-w-0 flex-col *:flex-1',
              SPANS[Math.min(child.span ?? 1, node.columns ?? 2)],
            )}
          >
            <Node node={child} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ node }: { node: NodeOf<'Section'> }) {
  return (
    <div className="space-y-4">
      <Heading title={node.title} description={node.description} />
      <Children nodes={node.children} />
    </div>
  );
}

function Tabs({ node }: { node: NodeOf<'Tabs'> }) {
  const [active, setActive] = useState(0);
  const tab = node.tabs[active] ?? node.tabs[0];
  return (
    <div className="space-y-4">
      <Heading title={node.title} />
      <div
        role="tablist"
        className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800"
      >
        {node.tabs.map((t, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={clsx(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium',
              i === active
                ? 'border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab && (
        <div className="space-y-4">
          <Children nodes={tab.children} />
        </div>
      )}
    </div>
  );
}

const LAYOUTS = { Grid, Section, Tabs } as const;

export function Node({ node }: { node: ViewNode }) {
  const name = node.component as ComponentName;
  let content: ReactNode;
  if (name in LAYOUTS) {
    const Layout = LAYOUTS[name as keyof typeof LAYOUTS] as (p: { node: ViewNode }) => ReactNode;
    content = <Layout node={node} />;
  } else {
    const def = COMPONENTS[name as keyof typeof COMPONENTS];
    if (!def) {
      return (
        <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-sm text-neutral-500 dark:border-neutral-700">
          Unknown component “{name}”
        </div>
      );
    }
    const Render = def.render as (p: { node: ViewNode }) => ReactNode;
    content = def.bare ? (
      <div className="flex flex-col gap-2">
        {node.title && !def.ownTitle && <h3 className="text-sm font-semibold">{node.title}</h3>}
        <div className="flex flex-1 flex-col *:flex-1">
          <Render node={node} />
        </div>
      </div>
    ) : (
      <Panel title={node.title} flush={def.flush}>
        <Render node={node} />
      </Panel>
    );
  }
  return <NodeErrorBoundary name={name}>{content}</NodeErrorBoundary>;
}

/** Renders any view spec as a board; `editing` turns on the layout controls. */
export function ViewRenderer({
  spec,
  editing = false,
  onChange = () => {},
  view,
}: {
  spec: ViewSpec;
  editing?: boolean;
  onChange?: BoardChange;
  /** The view being shown, so widgets can say where a question was asked from. */
  view?: { id: string; name: string };
}) {
  return <BoardView board={toBoard(spec)} editing={editing} onChange={onChange} view={view} />;
}
