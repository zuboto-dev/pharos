import { runQuery, type Entity, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import { Circle, CircleCheck, CircleSlash } from 'lucide-react';
import { useViewData } from '../context';
import { Clickable } from '../interactive';
import { EditOptionsButton, OptionDot, useOptions } from '../options';
import { QuickAdd, useCreate } from '../quickadd';
import { Empty } from '../ui';

type GoalNode = { goal: Entity<'goal'>; children: GoalNode[] };

const GOAL_ICONS = {
  open: <Circle className="size-4 text-neutral-400" />,
  achieved: <CircleCheck className="size-4 text-emerald-500" />,
  dropped: <CircleSlash className="size-4 text-neutral-400" />,
};

function GoalItem({ node, showCriteria }: { node: GoalNode; showCriteria: boolean }) {
  const { goal } = node;
  const meaning = useOptions().meaning('goal.status', goal.data.status) as keyof typeof GOAL_ICONS;
  const dropped = meaning === 'dropped';
  return (
    <li>
      <Clickable
        id={goal.id}
        className="-mx-2 flex items-start gap-2 rounded-md px-2 py-1 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
      >
        <span className="mt-0.5">{GOAL_ICONS[meaning] ?? GOAL_ICONS.open}</span>
        <div className="min-w-0">
          <div className={clsx('text-sm font-medium', dropped && 'text-neutral-400 line-through')}>
            {goal.data.title}
          </div>
          {showCriteria && goal.data.successCriteria.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {goal.data.successCriteria.map((c, i) => (
                <li key={i} className="flex gap-1.5">
                  <span aria-hidden>·</span>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Clickable>
      {node.children.length > 0 && (
        <ul className="mt-1 ml-2 space-y-1 border-l border-neutral-200 pl-4 dark:border-neutral-800">
          {node.children.map((child) => (
            <GoalItem key={child.goal.id} node={child} showCriteria={showCriteria} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function GoalTree({ node }: { node: NodeOf<'GoalTree'> }) {
  const data = useViewData();
  const goals = runQuery(data, 'goal', node.filter);
  const create = useCreate();
  const addGoal = <QuickAdd label="Add goal" onAdd={(title) => create('goal', { title })} />;
  if (!goals.length) {
    return (
      <>
        <Empty>No goals yet</Empty>
        {addGoal}
      </>
    );
  }
  const nodes = new Map(goals.map((goal) => [goal.id, { goal, children: [] as GoalNode[] }]));
  const roots: GoalNode[] = [];
  for (const item of nodes.values()) {
    const parent = item.goal.data.parentId ? nodes.get(item.goal.data.parentId) : undefined;
    (parent ? parent.children : roots).push(item);
  }
  return (
    <ul className="space-y-2">
      {roots.map((root) => (
        <GoalItem key={root.goal.id} node={root} showCriteria={node.showCriteria ?? true} />
      ))}
      <li className="-mx-2">{addGoal}</li>
    </ul>
  );
}

export function ScopeBoard({ node }: { node: NodeOf<'ScopeBoard'> }) {
  const data = useViewData();
  const options = useOptions();
  const create = useCreate();
  // `kinds` picks columns by meaning, so custom scope groups show up under the right filter.
  const columns = options
    .list('scope_item.kind')
    .filter((o) => !node.kinds || (node.kinds as string[]).includes(o.meaning));
  return (
    <div className="space-y-2">
      <div className="-mt-1 flex justify-end">
        <EditOptionsButton field="scope_item.kind" label="Edit groups" />
      </div>
      {!data.scopeItems.length && <Empty>No scope defined yet</Empty>}
      {
        <div className={clsx('grid gap-4', columns.length > 1 && 'sm:grid-cols-2 lg:grid-cols-3')}>
          {columns.map((column) => {
            const items = data.scopeItems.filter((i) => i.data.kind === column.value);
            return (
              <div key={column.value} className="min-w-0">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-neutral-600 uppercase dark:text-neutral-300">
                  <OptionDot field="scope_item.kind" value={column.value} />
                  {column.label}{' '}
                  <span className="font-normal text-neutral-400">{items.length}</span>
                </h4>
                <ul className="space-y-2">
                  {items.map((item) => (
                    <li key={item.id}>
                      <Clickable
                        id={item.id}
                        className="rounded-lg bg-neutral-50 px-3 py-2 hover:bg-neutral-100 dark:bg-neutral-800/50 dark:hover:bg-neutral-800"
                      >
                        <div className="text-sm">{item.data.title}</div>
                        {item.data.rationale && (
                          <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                            {item.data.rationale}
                          </div>
                        )}
                      </Clickable>
                    </li>
                  ))}
                  <li>
                    <QuickAdd
                      label="Add"
                      onAdd={(title) => create('scope_item', { title, kind: column.value })}
                    />
                  </li>
                </ul>
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}
