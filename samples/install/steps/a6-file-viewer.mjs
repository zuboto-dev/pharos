// v0.2 A6: files at a glance, opened in the file viewer, in "Pharos samples".
//
// A page with the made-up Example Co registration papers (from the R7.12 step) as a FileList and
// nothing else beside it: no FileView. Each row shows the file's icon, name and the one date that
// matters; tapping one opens the file viewer (preview, actions as icons, Details on request), and
// ← → step through the list. A StartHere card says what the page is for.
//
// Idempotent: the page is found by name and made only when it's missing.
import { StepError, day, ensureView } from '../lib.mjs';

export const key = 'A6';
export const title = 'Files at a glance: a list that opens the file viewer';

const VIEW = 'Files at a glance';
const TAG = 'business-registration';
const TAX = 'Tax registration letter';

/** The views this step makes, by name, for the table. */
export const VIEWS = [VIEW];

export async function run({ call, samples }) {
  const projectId = samples.id;
  const files = await call('list', { type: 'file', projectId, where: { tags: TAG } });
  if (!files.length)
    throw new StepError(
      `No files tagged "${TAG}" in "${samples.name}": the R7.12 step brings them in first.`,
    );
  const tax = files.find((f) => f.title === TAX);
  const widgets = [
    {
      id: 'start',
      node: {
        component: 'StartHere',
        purpose: 'done',
        why: "Example Co's registration papers, ready to read and hand on",
        headline: 'Every registration paper is here at a glance; tap one to read it.',
        ...(tax ? { evidence: [{ id: tax.id, label: 'Tax letter' }] } : {}),
        date: day(0),
        path: [
          { label: 'The papers', says: 'Name and the one date that matters', target: 'papers' },
          { label: 'One paper', says: 'Tap it: preview, actions, ← → for the next' },
        ],
      },
    },
    {
      id: 'papers',
      node: {
        component: 'FileList',
        title: 'Registration papers',
        filter: { where: { tags: TAG } },
        controls: ['search'],
      },
    },
  ];
  const page = await ensureView(
    call,
    projectId,
    VIEW,
    'A6 sample: files show at a glance; tapping one opens the file viewer',
    widgets,
    'A6 sample: a page that lists the registration papers at a glance; tapping one opens the file viewer (no FileView needed)',
  );
  return [{ project: samples.name, projectId, view: VIEW, viewId: page.id, made: page.made }];
}
