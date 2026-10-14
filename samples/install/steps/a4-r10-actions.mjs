// v0.2 A4 (R10): Action blocks on the pack pages ("Log a service", "Mark paid", …) and the row
// buttons on the due lists. Adapted from v02/A4/patch-r10-actions.mjs: packs made since R10 already
// carry their Action blocks, so on a project the A1/A3 steps just made this changes nothing; a page
// made before R10 (no Action block) gets them, as the original did. Never stops on "already done".
import { StepError, projectNamed, viewNamed } from '../lib.mjs';
import { PAGES } from './packs.mjs';

export const key = 'A4';
export const title = 'Act in place: Action blocks, short forms, Undo';

const SAMPLES = [
  {
    project: 'Car (sample)',
    pack: 'car',
    headline: 8,
    actions: [
      {
        id: 'log-service',
        w: 4,
        node: {
          component: 'Action',
          label: 'Log a service',
          description: 'Marks the matching reminder done and updates the odometer',
          recordType: 'service',
          fields: ['vehicle', 'date', 'kind', 'odometer', 'cost', 'shop'],
          roll: { recordType: 'reminder', match: ['vehicle', 'kind'], meter: 'odometer' },
          raise: { via: 'vehicle', field: 'odometer', from: 'odometer' },
        },
      },
    ],
  },
  {
    project: 'Money (sample)',
    pack: 'money',
    headline: 8,
    actions: [
      {
        id: 'mark-paid',
        w: 4,
        node: {
          component: 'Action',
          label: 'Mark paid',
          description: 'Moves the bill to its next date and adds the spending',
          recordType: 'bill',
          does: 'done',
          log: {
            recordType: 'spending',
            fields: {
              date: '$date',
              amount: 'fields.amount',
              category: 'fields.category',
              payee: 'fields.payee',
            },
            ask: ['amount'],
          },
        },
      },
    ],
    row: { widget: 'bills', action: 'mark-paid' },
  },
  {
    project: 'Music (sample)',
    pack: 'music',
    headline: 6,
    actions: [
      {
        id: 'log-mix',
        w: 3,
        node: {
          component: 'Action',
          label: 'Log a mix',
          recordType: 'mix',
          fields: ['song', 'date', 'version'],
        },
      },
      {
        id: 'log-session',
        w: 3,
        node: {
          component: 'Action',
          label: 'Log a session',
          recordType: 'session',
          fields: ['song', 'date', 'hours', 'kind'],
        },
      },
    ],
  },
  {
    project: 'Study (sample)',
    pack: 'study',
    headline: 8,
    actions: [
      {
        id: 'log-session',
        w: 4,
        node: { component: 'Action', label: 'Log a session', recordType: 'session' },
      },
    ],
  },
  {
    project: 'Company documents (sample)',
    pack: 'company',
    headline: 8,
    actions: [
      {
        id: 'mark-renewed',
        w: 4,
        node: {
          component: 'Action',
          label: 'Mark renewed',
          description: 'Moves a renewal or filing to its next date',
          recordType: 'renewal',
          does: 'done',
        },
      },
    ],
    row: { widget: 'renewals', action: 'mark-renewed' },
  },
];

export async function run({ call, adopt, log }) {
  const catalog = await call('catalog_list', {});
  if (!JSON.stringify(catalog).includes('"Action"'))
    throw new StepError('This Pharos has no Action block (it predates R10).');
  const rows = [];
  for (const sample of SAMPLES) {
    const project = await projectNamed(call, sample.project);
    if (!project) throw new StepError(`No project "${sample.project}"; the A1/A3 steps make it.`);
    adopt(project.id);
    const found = await viewNamed(call, project.id, PAGES[sample.pack]);
    if (!found) throw new StepError(`"${sample.project}" has no page "${PAGES[sample.pack]}".`);
    const page = await call('view_get', { viewId: found.id });
    const widgets = page.board.widgets;
    const ops = [];
    if (!widgets.some((w) => w.node.component === 'Action')) {
      if (!widgets.some((w) => w.id === 'headline'))
        throw new StepError(`"${page.name}" has no "headline" block (changed by hand?).`);
      ops.push(
        { op: 'update', id: 'headline', w: sample.headline },
        ...sample.actions.map((widget, k) => ({
          op: 'add',
          widget,
          after: k === 0 ? 'headline' : sample.actions[k - 1].id,
        })),
      );
    }
    if (sample.row) {
      const row = widgets.find((w) => w.id === sample.row.widget);
      if (!row) throw new StepError(`"${page.name}" has no "${sample.row.widget}" block.`);
      if (!row.node.action)
        ops.push({ op: 'update', id: sample.row.widget, set: { action: sample.row.action } });
    }
    let made = false;
    if (ops.length) {
      const result = await call('view_update', {
        viewId: found.id,
        expectedRevision: page.revision,
        message: `Add ${sample.actions.map((a) => `"${a.node.label}"`).join(' and ')} to the page, so the owner can record it here (R10)`,
        ops,
      });
      made = true;
      log(`"${sample.project}": added the actions (revision ${result.revision.id})`);
    }
    const actions = (made ? (await call('view_get', { viewId: found.id })).board.widgets : widgets)
      .filter((w) => w.node.component === 'Action')
      .map((w) => w.node.label);
    rows.push({
      project: sample.project,
      projectId: project.id,
      view: page.name,
      viewId: found.id,
      made,
      note: actions.join(', '),
    });
  }
  return rows;
}
