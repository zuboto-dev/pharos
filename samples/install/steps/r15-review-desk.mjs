// R15: a review desk, "Review desk (sample)", in "Pharos samples".
//
// A report document with three sheets, the way an agent hands work to the owner for review: one
// with before/after phone screenshots of a made-up app (pair) and a decision to answer, one with
// numbered steps and a command to copy plus a phone shot, one with a short sound and a checklist to
// tick; a details block at the top level and inside the first sheet. Pharos draws the "Needs you"
// header and live progress above the sheets.
//
// Made-up only: "Pantry" is an invented shopping-list app; its screenshots and the chime are in
// samples/files/review-desk/ (made by samples/make-review-desk-media.mjs: HTML rendered in headless
// Chrome, and a synthesized WAV). They are uploaded to the view with report_asset_put.
//
// Idempotent: the decision, the two tasks and the document are made only when missing (by name);
// a document that is there is left as it is (the owner may have answered it), and only its missing
// files are uploaded.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StepError, optionValue, viewNamed, warningsOf } from '../lib.mjs';

export const key = 'R15';
export const title = 'Rich documents and the review desk: sheets with pictures, steps and answers';

const VIEW = 'Review desk (sample)';
export const VIEWS = [VIEW];

const QUESTION = 'Move the offline banner above the list in Pantry?';
const TASKS = ['Play the new chime at full volume', 'Play it on a phone speaker at low volume'];

/** Files uploaded to the view: path in the document → file in samples/files/review-desk/. */
const FILES = {
  'shots/banner-before.png': 'banner-before.png',
  'shots/banner-after.png': 'banner-after.png',
  'shots/import-after.png': 'import-after.png',
  'audio/reminder-chime.wav': 'reminder-chime.wav',
};

const text = (id, content) => ({ kind: 'block', id, node: { component: 'Text', content } });
const markdown = (id, content) => ({ kind: 'block', id, node: { component: 'Markdown', content } });

export function reviewDoc(decisionId) {
  return {
    summary:
      'Three things from this week of work on Pantry (a made-up list app) need you: approve the offline banner fix, try the new import, and listen to the new reminder chime.',
    blocks: [
      text(
        'lead',
        [
          '# Three things need you, about ten minutes',
          '',
          "This week's work on **Pantry**, a made-up shopping-list app, is checked. One sheet per item: what changed, the evidence, what I need from you.",
        ].join('\n'),
      ),
      {
        kind: 'details',
        id: 'about',
        summary: 'How this review was made',
        blocks: [
          markdown(
            'about-text',
            'Screenshots were taken at 390 px wide, the width of a small phone, in a headless browser. The chime is the file the app will ship. Everything here is made up: the app, its lists and the sound.',
          ),
        ],
      },
      {
        kind: 'sheet',
        id: 'banner',
        title: 'Approve the offline banner fix',
        time: '5 min',
        tags: ['review'],
        decisions: [decisionId],
        blocks: [
          text(
            'banner-what',
            '**What changed.** When the phone is offline, the banner now sits above the list instead of floating over it.\n\n**Why.** Floating, it hid the first row and half of the second, so an item added on another phone went unnoticed until you scrolled.',
          ),
          {
            kind: 'figure',
            id: 'banner-shots',
            layout: 'pair',
            items: [
              {
                src: 'shots/banner-before.png',
                alt: 'Pantry offline: a dark banner floats over the top of the list and hides "Oat milk" and half of "Rye bread"',
                caption: '**Before.** The banner covers the first row and a half.',
              },
              {
                src: 'shots/banner-after.png',
                alt: 'Pantry offline: the banner sits above the title and all eight items show',
                caption: '**After.** The banner pushes the list down; all eight items show.',
              },
            ],
            caption: 'Both taken offline at 390 px. Click a picture to see it full size.',
          },
          {
            kind: 'block',
            id: 'banner-ask',
            node: { component: 'DecisionBlock', decision: decisionId },
          },
          {
            kind: 'details',
            id: 'banner-tried',
            summary: 'What I tried first',
            blocks: [
              markdown(
                'banner-tried-text',
                'A smaller floating banner (one line, no dot) still covered a row at 320 px, and a banner at the bottom sat on top of the "Add item" field. Moving it into the page is the only version that hides nothing at any width I tried (320, 390 and 430 px).',
              ),
            ],
          },
        ],
      },
      {
        kind: 'sheet',
        id: 'import',
        title: 'Try the new import',
        time: '3 min',
        tags: ['try it'],
        blocks: [
          text(
            'import-what',
            '**What changed.** Importing a list you already have no longer doubles it: rows already on the list are skipped, and a note says how many were added.\n\n**Why.** You imported the same file twice last week and had to delete eight rows by hand.',
          ),
          {
            kind: 'steps',
            id: 'import-check',
            title: 'How to check',
            items: [
              {
                text: 'Start the app from the Pantry folder.',
                command: 'npm run dev -- --port 5180',
                expect: 'It opens at `http://localhost:5180` with your list.',
              },
              {
                text: 'Import the sample list from **Settings → Import**, then import it again.',
                command: 'open samples/groceries.csv',
                expect: 'The second import says "2 added, 8 already on the list".',
              },
              {
                text: 'Look at the list.',
                expect: 'Ten items, the two new ones marked **NEW**, as in the picture below.',
              },
            ],
          },
          {
            kind: 'figure',
            id: 'import-shot',
            layout: 'phone',
            items: [
              {
                src: 'shots/import-after.png',
                alt: 'Pantry after the second import: ten items, Chickpeas and Ginger outlined as new, and a note "Imported groceries.csv: 2 added, 8 already on the list"',
                caption: 'After the second import.',
              },
            ],
          },
        ],
      },
      {
        kind: 'sheet',
        id: 'chime',
        title: 'Listen to the new reminder chime',
        time: '2 min',
        tags: ['listen'],
        blocks: [
          text(
            'chime-what',
            '**What changed.** The reminder sound is now two soft notes instead of a single beep.\n\n**Why.** Testers said the beep sounded like an error. Tick each check once you have listened.',
          ),
          {
            kind: 'figure',
            id: 'chime-sound',
            items: [
              {
                src: 'audio/reminder-chime.wav',
                alt: 'The new reminder chime: two soft bell notes, rising, about a second and a half',
                caption: 'The new chime (1.6 s).',
              },
            ],
          },
          {
            kind: 'block',
            id: 'chime-checks',
            node: {
              component: 'TaskChecklist',
              filter: { where: { title: TASKS } },
              hideDone: false,
            },
          },
        ],
      },
    ],
  };
}

export async function run({ call, samples, repo, log }) {
  const projectId = samples.id;
  const guide = await call('report_guide', {});
  if (typeof guide !== 'string' || !guide.includes('review desk'))
    throw new StepError('This Pharos has no review desk (R15): update it first. Nothing changed.');
  const project = await call('get', { id: projectId });

  // ---------------------------------------------------------------- the decision and the checks
  let [decision] = await call('list', { type: 'decision', projectId, where: { title: QUESTION } });
  if (!decision) {
    const res = await call('apply', {
      message: 'R15 sample: a made-up decision for the review desk sample to ask',
      operations: [
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: {
            projectId,
            title: QUESTION,
            status: optionValue(project, 'decision.status', 'proposed'),
            options: [
              {
                id: 'above',
                label: 'Move it above the list',
                summary: 'Nothing is hidden; the list starts a little lower while offline',
                pros: ['Hides no row at any width'],
                cons: ['The list moves down by one line'],
              },
              {
                id: 'smaller',
                label: 'Keep it floating, smaller',
                summary: 'The list stays put; the banner still covers part of a row',
                pros: ['The list never moves'],
                cons: ['Still covers a row at 320 px'],
              },
            ],
            recommendedOptionId: 'above',
            recommendationReason:
              'It is the only version that hides nothing at 320, 390 and 430 px.',
          },
        },
      ],
    });
    decision = { id: res.created.d };
    log('Made the decision the first sheet asks.');
  }
  const tasks = await call('list', { type: 'task', projectId });
  const missing = TASKS.filter((t) => !tasks.some((x) => x.title === t));
  if (missing.length) {
    await call('apply', {
      message: 'R15 sample: two made-up checks for the review desk sample to tick',
      operations: missing.map((t) => ({
        op: 'create',
        type: 'task',
        data: { projectId, title: t },
      })),
    });
    log(`Made ${missing.length} task${missing.length === 1 ? '' : 's'} for the checklist.`);
  }

  // ---------------------------------------------------------------- the document
  const doc = reviewDoc(decision.id);
  let view = await viewNamed(call, projectId, VIEW);
  let made = false;
  if (!view) {
    const draft = await call('view_preview', { projectId, doc });
    // Its files can only be uploaded once it is saved.
    const warnings = warningsOf(draft).filter((w) => !/ uploaded yet: /.test(w));
    if (warnings.length || draft.findings?.length)
      throw new StepError(
        `view_preview warns for "${VIEW}", so it wasn't saved:\n- ${warnings.join('\n- ')}`,
      );
    const res = await call('view_create', {
      projectId,
      name: VIEW,
      description: 'R15 sample: a review desk with three sheets, pictures, steps and answers',
      doc,
      message:
        'R15 sample: a review desk: three sheets to review (screenshots and a decision, steps to try, a sound and a checklist)',
    });
    view = res.view;
    made = true;
  }
  const have = new Set((await call('report_asset_list', { viewId: view.id })).map((a) => a.path));
  let uploaded = 0;
  for (const [path, file] of Object.entries(FILES)) {
    if (have.has(path)) continue;
    let bytes;
    try {
      bytes = readFileSync(join(repo, 'samples', 'files', 'review-desk', file));
    } catch {
      throw new StepError(
        `samples/files/review-desk/${file} is missing: make it with node samples/make-review-desk-media.mjs, then run this again.`,
      );
    }
    await call('report_asset_put', { viewId: view.id, path, base64: bytes.toString('base64') });
    uploaded++;
  }
  if (uploaded) log(`Uploaded ${uploaded} of its files (screenshots and the chime).`);
  if (made) {
    const preview = await call('view_preview', { viewId: view.id });
    const after = warningsOf(preview);
    if (after.length)
      throw new StepError(`Saved "${VIEW}", but its preview warns:\n- ${after.join('\n- ')}`);
    log(`Review desk made (${preview.summary}).`);
  }
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made }];
}
