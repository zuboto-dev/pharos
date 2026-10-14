// v0.2 B1: "Look and motion" (one-line top bar, file glances, motion, live updates), plus seven
// small views of the papers so the tab row overflows into "More".
// Adapted from v02/B1/patch-look-and-motion.mjs: each view is made only when missing (so a run that
// stopped half way finishes), and every missing view is previewed before any is saved.
import { StepError, ensureView, previewOrStop, viewNamed } from '../lib.mjs';

export const key = 'B1';
export const title = 'Look and motion (top bar, glances, motion, live updates)';

const VIEW = 'Look and motion';
const TAG = 'business-registration';
const SOURCES = ['Company seal image', 'Business registry (made-up page)'];

export async function run({ call, samples, log }) {
  const projectId = samples.id;
  const files = (await call('list', { type: 'file', projectId })).filter((f) =>
    (f.tags ?? []).includes(TAG),
  );
  const byTitle = (t) => files.find((f) => f.title === t);
  const papers = {
    cert: byTitle('Business registration certificate'),
    notice: byTitle('Registered address change notice'),
    tax: byTitle('Tax registration letter'),
    seal: byTitle('Company seal'),
    notes: byTitle('Registration notes'),
  };
  const missing = Object.entries(papers).filter(([, f]) => !f);
  if (missing.length)
    throw new StepError(
      `The business registration papers aren't all in "Pharos samples" (missing: ${missing.map(([k]) => k).join(', ')}); the R7.12 step makes them.`,
    );
  const artifacts = await call('list', { type: 'artifact', projectId });
  const sources = artifacts.filter((a) => SOURCES.includes(a.title));

  const note = (text) => ({ id: 'note', node: { component: 'Markdown', content: text } });
  const PART =
    'Part of the **Look and motion** sample: one of several small views, so the tab row has more tabs than fit and shows **More**.';
  const small = [
    [
      'Certificates',
      [
        note(PART),
        {
          id: 'list',
          node: {
            component: 'FileList',
            title: 'Certificates',
            filter: { where: { id: [papers.cert.id, papers.notice.id, papers.tax.id] } },
            controls: [],
          },
        },
      ],
    ],
    [
      'Tax letter',
      [
        note(PART),
        { id: 'doc', node: { component: 'FileView', file: papers.tax.id, size: 'compact' } },
      ],
    ],
    [
      'Address change',
      [
        note(PART),
        { id: 'doc', node: { component: 'FileView', file: papers.notice.id, size: 'compact' } },
      ],
    ],
    [
      'Seal',
      [
        note(PART),
        {
          id: 'pics',
          node: { component: 'Gallery', files: { where: { id: [papers.seal.id] } }, columns: 2 },
        },
      ],
    ],
    [
      'Notes',
      [
        note(PART),
        { id: 'doc', node: { component: 'FileView', file: papers.notes.id, size: 'compact' } },
      ],
    ],
    [
      'Expiring',
      [
        note(PART),
        {
          id: 'list',
          node: {
            component: 'FileList',
            title: 'With an expiry date',
            filter: { where: { tags: TAG, expiryDate: { exists: true } } },
            groupBy: 'none',
            controls: [],
          },
        },
      ],
    ],
    [
      'Sources',
      [
        note(PART),
        {
          id: 'table',
          node: {
            component: 'DataTable',
            title: 'Sources',
            query: { type: 'artifact', where: { id: sources.map((s) => s.id) } },
            columns: [{ field: 'title' }, { field: 'uri', label: 'Where' }],
          },
        },
      ],
    ],
  ];

  const HOW = [
    '**How to see it** (made-up data; every motion is 120–220 ms, and with *Reduce motion* turned on in the system settings only the fades remain):',
    '',
    "- **One-line top bar:** the tabs above never wrap. The ones that don't fit are under **More**; Files, History and Customize are icons with tooltips (hover or Tab to them). ← → move between tabs.",
    "- **Glance:** blocks show a file's icon, name and one date. Tap one for its details: where it is on disk, and every action.",
    '- **Motion:** switch tabs (a fade), open a file (the drawer slides in and out), open the seal in the gallery (the lightbox), hide the sidebar with `⌘\\` (Ctrl+\\\\ off a Mac), or Customize → Add widget and remove it again.',
    '- **Live updates:** with this page open and scrolled down, let an agent add a task linked to the tax letter (the B1 scratch folder has `live-update.mjs`). The tasks block below gets the new task and a soft ring that fades; your scroll position and focus stay.',
  ].join('\n');
  const main = [
    { id: 'how', w: 7, node: { component: 'Markdown', title: 'Look and motion', content: HOW } },
    {
      id: 'seal',
      w: 5,
      node: {
        component: 'Gallery',
        title: 'Seal',
        files: { where: { id: [papers.seal.id] } },
        columns: 2,
      },
    },
    {
      id: 'papers',
      w: 6,
      node: {
        component: 'FileList',
        title: 'Papers at a glance',
        filter: { where: { tags: TAG } },
        controls: ['search'],
        showIn: 'document',
      },
    },
    {
      id: 'document',
      w: 6,
      node: { component: 'FileView', title: 'Document', file: papers.tax.id, size: 'compact' },
    },
    {
      id: 'live',
      w: 6,
      node: {
        component: 'TaskTable',
        title: 'Work on the papers (changes live)',
        filter: { where: { fileIds: Object.values(papers).map((f) => f.id) } },
        columns: ['status', 'dueDate'],
      },
    },
    {
      id: 'sources',
      w: 6,
      node: {
        component: 'DataTable',
        title: 'Sources at a glance',
        query: { type: 'artifact', where: { id: sources.map((s) => s.id) } },
        columns: [{ field: 'title' }, { field: 'uri', label: 'Where' }],
      },
    },
  ];

  // Every missing view is previewed before any is saved, so a warning never leaves half a sample.
  const all = [...small, [VIEW, main]];
  const todo = [];
  for (const [name, widgets] of all)
    if (!(await viewNamed(call, projectId, name))) todo.push([name, widgets]);
  for (const [name, widgets] of todo) await previewOrStop(call, projectId, name, widgets);

  const rows = [];
  for (const [name, widgets] of all) {
    const isMain = name === VIEW;
    const view = await ensureView(
      call,
      projectId,
      name,
      isMain
        ? 'v0.2 B1 sample: the one-line top bar, files at a glance, calm motion and live updates (made-up data)'
        : `Look and motion sample: Example Co's papers, ${name.toLowerCase()} (made up)`,
      widgets,
      isMain
        ? 'A view showing the v0.2 look and motion work: one-line top bar, file glances, transitions and live updates (v0.2 B1 sample)'
        : `Add the small view "${name}" for the Look and motion sample, so the tab row needs More (v0.2 B1)`,
    );
    // The small views are there to fill the tab row; the table lists them after the main one.
    rows.push({
      project: samples.name,
      projectId,
      view: name,
      viewId: view.id,
      made: view.made,
      ...(isMain ? {} : { minor: true }),
    });
  }
  if (todo.length) log(`made ${todo.length} views: ${todo.map(([n]) => n).join(', ')}`);
  return [...rows.filter((r) => !r.minor), ...rows.filter((r) => r.minor)];
}
