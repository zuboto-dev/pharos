// R7.13: "UI examples", six made-up wireframes as pictures in a Gallery grid and a compare.
// Adapted from R7.13/patch-gallery-sample.mjs: the agent path only (the folder comes from the
// installer's one request; no --as-owner or --image-base), and every part is reused when there.
import { StepError, day, ensureView, optionValue, unaddedFiles } from '../lib.mjs';

export const key = 'R7.13';
export const title = 'Gallery of UI examples (pictures)';

const VIEW = 'UI examples';
const FOLDER_PART = 'ui-examples';
const GRID_TAG = 'ui-examples';
const COMPARE_TAG = 'ui-examples-empty-state';

const PICTURES = [
  {
    path: 'ui-examples/card-layout.png',
    title: 'Card layout',
    alt: 'Three cards in a row, each with a photo, a name, a distance and an Open button',
    description: 'Cards suit items people compare by picture first.',
    tag: GRID_TAG,
  },
  {
    path: 'ui-examples/stepper.png',
    title: 'Stepper',
    alt: 'Four numbered steps joined by a line, the third one current, above a payment form',
    description: 'A stepper shows where you are in a short, fixed sequence.',
    tag: GRID_TAG,
  },
  {
    path: 'ui-examples/tabs.png',
    title: 'Tabs',
    alt: 'Four tabs with Tasks selected, above a list of three tasks with checkboxes',
    description: 'Tabs switch between views of the same thing.',
    tag: GRID_TAG,
  },
  {
    path: 'ui-examples/toast.png',
    title: 'Toast',
    alt: 'A dark message at the bottom saying Saved, with an Undo link',
    description: 'A toast confirms a change briefly and offers Undo.',
    tag: GRID_TAG,
  },
  {
    path: 'ui-examples/empty-state-a.png',
    title: 'Empty state, option A',
    alt: 'An empty Projects list that only says No items',
    description: 'Says nothing is there, and stops.',
    tag: COMPARE_TAG,
  },
  {
    path: 'ui-examples/empty-state-b.png',
    title: 'Empty state, option B',
    alt: 'An empty Projects list with a folder icon, a short line on what to do and a New project button',
    description: 'Says what is missing and offers the next step.',
    tag: COMPARE_TAG,
  },
];
/** The title Pharos gives a file when it is added: its name without the extension. */
const addedTitle = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

export async function run({ call, samples, folderId, log }) {
  const projectId = samples.id;
  const existingView = await call('view_list', { projectId, includeArchived: true });
  const done = existingView.find((v) => v.name === VIEW);
  if (done) return [{ project: samples.name, projectId, view: VIEW, viewId: done.id, made: false }];

  // ---------------------------------------------------------------- the six files
  const fileOf = (files, picture) => files.find((f) => f.title === addedTitle(picture.path));
  let files = await call('list', { type: 'file', projectId });
  const missing = PICTURES.filter((p) => !fileOf(files, p)).map((p) => p.path);
  if (missing.length) {
    const unadded = await unaddedFiles(call, projectId, folderId, FOLDER_PART, missing);
    const absent = missing.filter((p) => !unadded.has(p));
    if (absent.length)
      throw new StepError(
        `The folder's scan didn't find ${absent.join(', ')}. Regenerate them with node samples/make-ui-examples.mjs, then run this again.`,
        2,
      );
    await call('apply', {
      message: 'Add the made-up UI example pictures for the Gallery sample (R7.13)',
      operations: missing.map((path) => ({
        op: 'create',
        type: 'file',
        data: { projectId, rootId: folderId, path },
      })),
    });
    log(`added ${missing.length} pictures from the folder`);
    files = await call('list', { type: 'file', projectId });
  }
  const images = PICTURES.map((p) => fileOf(files, p)?.id);
  if (images.some((id) => !id))
    throw new StepError(
      'The pictures were added but agents still don’t see them: is the folder Hidden?',
      2,
    );

  // ---------------------------------------------------------------- one artifact per picture
  const project = await call('get', { id: projectId });
  const artifacts = await call('list', { type: 'artifact', projectId });
  const artifactOf = (p) =>
    artifacts.find((a) => a.title === p.title && (a.tags ?? []).includes(p.tag));
  const toMake = PICTURES.map((p, i) => [p, i]).filter(([p]) => !artifactOf(p));
  let created = {};
  if (toMake.length) {
    const made = await call('apply', {
      message:
        'Store six made-up UI examples as pictures (artifacts with an image), so a Gallery can show them (R7.13 sample)',
      operations: toMake.map(([p, i]) => ({
        op: 'create',
        type: 'artifact',
        ref: `pic${i}`,
        data: {
          projectId,
          title: p.title,
          description: p.description,
          kind: optionValue(project, 'artifact.kind', 'design'),
          status: optionValue(project, 'artifact.status', 'delivered'),
          image: images[i],
          alt: p.alt,
          tags: [p.tag],
        },
      })),
    });
    created = made.created;
    log(`stored ${toMake.length} pictures as artifacts`);
  }
  const artifactIds = PICTURES.map((p, i) => artifactOf(p)?.id ?? created[`pic${i}`]);

  // ---------------------------------------------------------------- the view
  const optionB = artifactIds[5];
  const widgets = [
    {
      id: 'start',
      node: {
        component: 'StartHere',
        purpose: 'done',
        why: 'Collect UI patterns to borrow for the next screens, as pictures',
        headline: 'Four patterns and two empty states are collected as pictures to compare.',
        yourPart: 'Pick an empty state: option B is the one we suggest.',
        evidence: [
          { id: artifactIds[0], label: 'Card layout' },
          { id: optionB, label: 'Option B' },
        ],
        date: day(0),
        path: [
          { label: 'Patterns', says: 'Four patterns; tap one to see it large', target: 'patterns' },
          { label: 'Empty states', says: 'Option A and B side by side', target: 'empty' },
        ],
      },
    },
    {
      id: 'patterns',
      node: {
        component: 'Gallery',
        title: 'Patterns',
        artifacts: { where: { tags: GRID_TAG } },
        layout: 'grid',
        columns: 4,
        caption: 'title',
      },
    },
    {
      id: 'empty',
      node: {
        component: 'Gallery',
        title: 'Empty state: A or B',
        artifacts: { where: { tags: COMPARE_TAG } },
        layout: 'compare',
        caption: 'description',
        highlight: [optionB],
      },
    },
  ];
  const view = await ensureView(
    call,
    projectId,
    VIEW,
    'Made-up UI patterns and two empty states, shown as pictures',
    widgets,
    'A view of UI examples as pictures: a grid of patterns and two empty states compared (R7.13 sample)',
  );
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made: view.made }];
}
