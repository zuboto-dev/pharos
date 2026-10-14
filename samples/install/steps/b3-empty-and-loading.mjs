// v0.2 B3: "Empty and loading", every list block pointed at nothing on purpose, so each shows its
// empty state. Adapted from v02/B3/patch-empty-and-loading.mjs (made only when missing; warnings
// that a block is empty are the point of the page, any other warning stops it).
import { ensureView, viewNamed } from '../lib.mjs';

export const key = 'B3';
export const title = 'Empty states and loading skeletons';

const VIEW = 'Empty and loading';
const NOTHING = 'Nothing matches this on purpose (B3 sample)';
/** The point of the page: empty widgets. Anything else is a real problem. */
const notExpected = (m) => !/empty|no (rows|items|matches)|matches nothing|nothing/i.test(m);

export async function run({ call, samples }) {
  const projectId = samples.id;
  const existing = await viewNamed(call, projectId, VIEW);
  if (existing)
    return [{ project: samples.name, projectId, view: VIEW, viewId: existing.id, made: false }];
  const none = { where: { title: NOTHING } };
  const w = (id, width, node) => ({ id, w: width, node });
  const board = [
    w('note', 12, {
      component: 'Callout',
      tone: 'info',
      title: 'Empty on purpose',
      body:
        'Every block below points at nothing (made-up filters), so each shows its **empty state**: ' +
        'what is missing, what to do next, and a button where you can act. While a page loads, ' +
        'blocks show calm grey skeletons instead of "Loading…".',
    }),
    w('tasks', 7, { component: 'TaskTable', title: 'Tasks', filter: none }),
    w('mine', 5, {
      component: 'TaskChecklist',
      title: 'Your tasks',
      assigneeKind: 'human',
      filter: none,
    }),
    w('goals', 6, { component: 'GoalTree', title: 'Goals', filter: none }),
    w('stages', 6, {
      component: 'StageTracker',
      title: 'Stages',
      filter: { where: { name: NOTHING } },
    }),
    w('timeline', 6, {
      component: 'Timeline',
      title: 'Timeline',
      filter: { where: { name: NOTHING } },
    }),
    w('milestones', 6, {
      component: 'MilestoneList',
      title: 'Milestones',
      filter: { where: { name: NOTHING } },
    }),
    w('graph', 6, { component: 'DependencyGraph', title: 'What waits on what', filter: none }),
    w('who', 6, { component: 'AssigneeMatrix', title: 'Workload', filter: none }),
    w('decisions', 6, { component: 'DecisionLog', title: 'Decisions', filter: none }),
    w('outputs', 6, { component: 'ArtifactGallery', title: 'Deliverables', filter: none }),
    w('files', 6, {
      component: 'FileList',
      title: 'Papers',
      filter: { where: { title: NOTHING } },
    }),
    w('pictures', 6, {
      component: 'Gallery',
      title: 'Pictures',
      artifacts: { where: { tags: 'none-on-purpose' } },
    }),
    w('findings', 6, {
      component: 'DataList',
      title: 'Findings',
      query: { type: 'claim', where: { statement: NOTHING } },
    }),
    w('table', 6, {
      component: 'DataTable',
      title: 'Open questions',
      query: { type: 'decision', where: { title: NOTHING } },
      columns: [{ field: 'title' }, { field: 'status' }],
    }),
    w('count', 12, {
      component: 'CountChart',
      title: 'Goals by status',
      query: { type: 'goal', where: { title: NOTHING } },
      by: 'status',
    }),
  ];
  const view = await ensureView(
    call,
    projectId,
    VIEW,
    'v0.2 B3 sample: every list block empty on purpose, showing its empty state (made-up filters)',
    board,
    'A view showing every block’s empty state: what is missing and the next step (v0.2 B3 sample)',
    notExpected,
  );
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made: view.made }];
}
