// v0.2 A5 (R11, Live and calm): "changed since you looked" and a stale answer, in "Pharos samples".
//
// Made-up errands (three tasks named "R11 sample: …"), a saved page that lists them, and an answer
// ("Which R11 sample errands are blocked?") written from them. Then, as a separate revision, the
// agent marks one errand done: the owner then sees a dot on both tabs (and on the project in the
// sidebar) until they open them, a "Since you last looked" line on each page, and the answer marked
// "May be out of date" with Refresh, because the data it was written from changed.
//
// Idempotent: tasks and views are found by name and only what's missing is made; the data change
// happens only in the run that made the answer, so a re-run changes nothing.
import { StepError, ensureView, optionValue, viewNamed } from '../lib.mjs';

export const key = 'A5';
export const title = 'Live and calm: changed since you looked, stale answers';

const PREFIX = 'R11 sample: ';
const TASKS = [
  { title: `${PREFIX}renew the parking permit`, status: 'blocked' },
  { title: `${PREFIX}book the tyre change`, status: 'todo' },
  { title: `${PREFIX}pay the TV licence`, status: 'blocked' },
];
const CHANGED = `${PREFIX}pay the TV licence`;
const PAGE = 'Changed since you looked';
const QUESTION = 'Which R11 sample errands are blocked?';
/** view_answer names an answer after its question (up to 40 characters). */
const ANSWER = QUESTION.length > 40 ? `${QUESTION.slice(0, 39).trimEnd()}…` : QUESTION;

/** The views this step makes, by name, for the table. */
export const VIEWS = [PAGE, ANSWER];

const mine = { title: { contains: PREFIX } };

export async function run({ call, samples, log }) {
  const projectId = samples.id;
  const project = await call('get', { id: projectId });
  const status = (meaning) => optionValue(project, 'task.status', meaning);

  // 1. The made-up errands.
  const existing = (await call('list', { type: 'task', projectId })).filter((t) =>
    t.title.startsWith(PREFIX),
  );
  const missing = TASKS.filter((t) => !existing.some((e) => e.title === t.title));
  if (missing.length) {
    await call('apply', {
      message: 'Add made-up errands for the R11 sample (changed since you looked, stale answers)',
      operations: missing.map((t) => ({
        op: 'create',
        type: 'task',
        data: { projectId, title: t.title, status: status(t.status) },
      })),
    });
    log(`added ${missing.length} made-up errands`);
  }

  // 2. A saved page that lists them.
  const page = await ensureView(
    call,
    projectId,
    PAGE,
    'R11 sample: a dot on this tab means something here changed since you last opened it',
    [
      {
        id: 'about',
        node: {
          component: 'Text',
          content:
            'Made-up errands. When an agent changes one, this tab gets a dot until you open it, and this page says what changed and who changed it.',
        },
      },
      {
        id: 'errands',
        node: { component: 'TaskTable', title: 'Errands', filter: { where: mine } },
      },
    ],
    'R11 sample: a page whose data the sample changes, to show "changed since you looked"',
  );

  // 3. An answer written from the errands as they are now.
  let answer = await viewNamed(call, projectId, ANSWER);
  let answered = false;
  if (!answer) {
    const made = await call('view_answer', {
      projectId,
      question: QUESTION,
      widgets: [
        {
          id: 'answer',
          node: {
            component: 'Text',
            content: 'Two errands are blocked: the parking permit and the TV licence.',
          },
        },
        {
          id: 'blocked',
          node: {
            component: 'TaskTable',
            title: 'Blocked errands',
            filter: { where: { ...mine, status: status('blocked') } },
          },
        },
      ],
      expiresInDays: 90,
    });
    answer = made.view;
    answered = true;
    log(`answered "${QUESTION}" (${answer.id})`);
  }

  // 4. Later, the data changes: one blocked errand is done. Only in the run that wrote the answer.
  if (answered) {
    const task = (await call('list', { type: 'task', projectId })).find((t) => t.title === CHANGED);
    if (!task) throw new StepError(`No task "${CHANGED}"`);
    const result = await call('apply', {
      message:
        'R11 sample: the TV licence was paid (a made-up change, so the pages show what changed)',
      operations: [{ op: 'update', type: 'task', id: task.id, data: { status: status('done') } }],
    });
    log(`marked "${CHANGED}" done (revision ${result.revision?.id}): both tabs now have a dot`);
  }

  return [
    { project: samples.name, projectId, view: PAGE, viewId: page.id, made: page.made },
    { project: samples.name, projectId, view: ANSWER, viewId: answer.id, made: answered },
  ];
}
