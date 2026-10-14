// v0.2 A2 (R10.19): "Choose an empty state", a needs-you page with two DecisionBlocks.
// Adapted from v02/A2/patch-decision-block.mjs: the folder comes from the installer's one request,
// the two wireframes the R7.13 step added are reused, and the decisions' apply (one revision) is
// skipped when the decision is there, so a run that stopped before the view finishes it.
import { StepError, day, ensureView, optionValue, unaddedFiles } from '../lib.mjs';

export const key = 'A2';
export const title = 'Decision block: choose an empty state';

const VIEW = 'Choose an empty state';
const TAG = 'empty-state-choice';
const QUESTION = 'Which empty state should Pharos pages use?';
const SECOND = 'Where should Ask sit on a block?';

const PICTURES = [
  {
    ref: 'picA',
    path: 'ui-examples/empty-state-a.png',
    art: 'artA',
    title: 'Empty state A: just “No items”',
    alt: 'Wireframe of an empty Projects list that only says “No items”',
  },
  {
    ref: 'picB',
    path: 'ui-examples/empty-state-b.png',
    art: 'artB',
    title: 'Empty state B: icon, line and a button',
    alt: 'Wireframe of an empty Projects list with an icon, “No projects yet. Start one to plan your work.” and a New project button',
  },
];
const fileName = (path) => path.slice(path.lastIndexOf('/') + 1);

export async function run({ call, samples, folderId, log }) {
  const projectId = samples.id;
  const decided = await call('list', { type: 'decision', projectId, where: { title: QUESTION } });

  if (!decided.length) {
    // ---------------------------------------------------------------- the two wireframes
    const inProject = await call('list', { type: 'file', projectId });
    const fileOf = (pic) =>
      inProject.find(
        (f) =>
          f.title === fileName(pic.path) || f.title === fileName(pic.path).replace(/\.png$/, ''),
      );
    const fileId = {};
    const add = [];
    for (const pic of PICTURES) {
      const existing = fileOf(pic);
      if (existing) fileId[pic.ref] = existing.id;
      else add.push(pic);
    }
    if (add.length) {
      const unadded = await unaddedFiles(
        call,
        projectId,
        folderId,
        'empty-state',
        add.map((p) => p.path),
      );
      for (const pic of add)
        if (!unadded.has(pic.path))
          throw new StepError(
            `The folder's scan hasn't found ${pic.path}. Regenerate it (node samples/make-ui-examples.mjs), then run this again.`,
            2,
          );
      // An image names a file by id, so the pictures are added first (a "$ref" is for references only).
      const added = await call('apply', {
        message:
          'Add the two made-up empty-state wireframes from the approved folder (v0.2 A2 sample)',
        operations: add.map((pic) => ({
          op: 'create',
          type: 'file',
          ref: pic.ref,
          data: {
            projectId,
            rootId: folderId,
            path: pic.path,
            title: fileName(pic.path),
            tags: [TAG],
          },
        })),
      });
      for (const pic of add) fileId[pic.ref] = added.created[pic.ref];
      log(`added ${add.length} wireframes`);
    }

    // ---------------------------------------------------------------- pictures, findings, decisions
    const project = await call('get', { id: projectId });
    const today = day(0);
    const operations = PICTURES.map((pic) => ({
      op: 'create',
      type: 'artifact',
      ref: pic.art,
      data: {
        projectId,
        title: pic.title,
        kind: optionValue(project, 'artifact.kind', 'design'),
        status: optionValue(project, 'artifact.status', 'delivered'),
        image: fileId[pic.ref],
        alt: pic.alt,
        tags: [TAG],
      },
    }));
    operations.push(
      {
        op: 'create',
        type: 'claim',
        ref: 'clmA',
        data: {
          projectId,
          statement: 'Empty state A shows only “No items” in the empty list.',
          assumption: 'The wireframe shows the whole empty state, with nothing below the fold.',
          checkedOn: today,
          sourceIds: ['$artA'],
          tags: [TAG],
        },
      },
      {
        op: 'create',
        type: 'claim',
        ref: 'clmB',
        data: {
          projectId,
          statement:
            'Empty state B shows an icon, one line on what to do and a “New project” button.',
          assumption: 'The button starts the same New project flow as the sidebar.',
          checkedOn: today,
          sourceIds: ['$artB'],
          tags: [TAG],
        },
      },
      {
        op: 'create',
        type: 'decision',
        ref: 'choice',
        data: {
          projectId,
          title: QUESTION,
          body: 'Every view, file list and record page needs one empty state. Two wireframes were drawn (made up for the samples).',
          options: [
            {
              id: 'a',
              label: 'Just “No items”',
              summary: 'Empty lists say so and nothing more',
              pros: ['Quiet', 'Nothing to draw'],
              cons: ['No next step'],
              claimIds: ['$clmA'],
            },
            {
              id: 'b',
              label: 'Icon, line and a button',
              summary: 'Empty lists say what to do and start it in one tap',
              pros: ['Shows the next step', 'One tap to start'],
              cons: ['An icon and a line per page'],
              claimIds: ['$clmB'],
            },
          ],
          recommendedOptionId: 'b',
          recommendationReason: 'A new reader sees what to do and can start it at once.',
          fileIds: PICTURES.map((p) => fileId[p.ref]),
        },
      },
      {
        op: 'create',
        type: 'decision',
        ref: 'ask',
        data: {
          projectId,
          title: SECOND,
          options: [
            {
              id: 'menu',
              label: 'In the block menu',
              pros: ['Quiet pages'],
              cons: ['Harder to find'],
            },
            {
              id: 'button',
              label: 'A button on hover',
              pros: ['Easy to find'],
              cons: ['Not on a phone'],
            },
          ],
          recommendedOptionId: 'menu',
          recommendationReason: 'Works the same on a phone.',
        },
      },
    );
    const applied = await call('apply', {
      message:
        'Ask the owner to choose an empty state: the two wireframes as pictures, a finding per option, and the decision with its options and recommendation (v0.2 A2 sample)',
      operations,
    });
    if (applied.warnings?.length) log(`apply warns: ${applied.warnings.join('; ')}`);
    log(`added two pictures, two findings and two decisions (revision ${applied.revision.id})`);
  }

  // ---------------------------------------------------------------- the view
  const decisions = await call('list', { type: 'decision', projectId });
  const decisionId = decisions.find((d) => d.title === QUESTION)?.id;
  const askId = decisions.find((d) => d.title === SECOND)?.id;
  const artifacts = await call('list', { type: 'artifact', projectId });
  const art = (t) => artifacts.find((a) => a.title === t && (a.tags ?? []).includes(TAG))?.id;
  const artA = art(PICTURES[0].title);
  const artB = art(PICTURES[1].title);
  if (!decisionId || !askId || !artA || !artB)
    throw new StepError(
      'The empty-state decision, its second question or its pictures are missing.',
    );
  const widgets = [
    {
      id: 'start',
      node: {
        component: 'StartHere',
        purpose: 'needs-you',
        due: day(7),
        why: 'Every empty page should tell the reader what to do next',
        headline: 'Pick the one empty state every Pharos list will use.',
        yourPart: 'Choose an empty state below.',
        yourPartTarget: 'choice',
        evidence: [
          { id: artA, label: 'Option A' },
          { id: artB, label: 'Option B' },
        ],
        date: day(0),
        path: [
          {
            label: 'What they look like',
            says: 'Both wireframes side by side',
            target: 'pictures',
          },
          { label: 'The choice', says: 'Pros, cons and our pick', target: 'choice' },
          { label: 'Decided so far', says: 'Answers you gave', target: 'log' },
        ],
      },
    },
    {
      id: 'pictures',
      node: {
        component: 'Gallery',
        title: 'The two empty states',
        artifacts: { where: { tags: TAG } },
        layout: 'compare',
      },
    },
    { id: 'choice', node: { component: 'DecisionBlock', decision: decisionId } },
    { id: 'ask', w: 7, node: { component: 'DecisionBlock', decision: askId } },
    {
      id: 'log',
      w: 5,
      node: {
        component: 'DecisionLog',
        title: 'Decided so far',
        filter: { where: { id: [decisionId, askId] } },
      },
    },
  ];
  const view = await ensureView(
    call,
    projectId,
    VIEW,
    'A needs-you page: the owner chooses the empty state Pharos pages use',
    widgets,
    'A needs-you page for the empty-state choice: StartHere, both wireframes, the decision block and what was decided (v0.2 A2 sample)',
  );
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made: view.made }];
}
