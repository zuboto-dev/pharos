// The agent-compatibility scenarios (eval/compat): six small jobs any agent connected to Pharos
// over MCP should manage. Each one is data: an optional seed (applied through REST as a person
// before the agent starts), a prompt for the agent, and a checker that asserts the end state (see
// checks.mjs for the state's shape). All names and data are made up; `ctx.tag` keeps one run's
// projects apart from another's on the same server.

import {
  check,
  commonChecks,
  componentsOf,
  createdProject,
  docLiveReads,
  inProject,
  meaningOf,
  previewProblems,
} from './checks.mjs';

const ONLY_PHAROS =
  'Use only the Pharos MCP tools. Work without asking me anything: decide sensibly and finish.';

const lower = (s) => String(s ?? '').toLowerCase();

/** a) Set up a project from a three-line brief: a goal, one stage, three tasks. */
const setup = {
  id: 'setup',
  title: 'Set up a project from a brief',
  projectName: (ctx) => `Lantern Bakery site ${ctx.tag}`,
  prompt: (ctx) =>
    [
      `In Pharos, set up a new project named "${setup.projectName(ctx)}" from this brief (a made-up bakery):`,
      '- Goal: launch a simple website for the Lantern Bakery.',
      '- Stage: "Build", the only stage.',
      '- Tasks in that stage: "Write the menu page", "Add opening hours", "Publish the site".',
      'Create nothing outside this project.',
      ONLY_PHAROS,
    ].join('\n'),
  check(state, ctx) {
    const project = createdProject(state, setup.projectName(ctx));
    const results = [check('project-created', project, project ? project.id : 'not found')];
    if (!project) return [...results, ...commonChecks(state, undefined)];
    const goals = inProject(state, 'goal', project.id);
    const stages = inProject(state, 'stage', project.id);
    const tasks = inProject(state, 'task', project.id);
    const stage = stages.length === 1 ? stages[0] : undefined;
    results.push(
      check('one-goal-or-more', goals.length >= 1, `${goals.length} goal(s)`),
      check(
        'one-stage-build',
        stage && lower(stage.data.name).includes('build'),
        stages.map((s) => s.data.name).join(', '),
      ),
    );
    for (const word of ['menu', 'hours', 'publish']) {
      const task = tasks.find((t) => lower(t.data.title).includes(word));
      results.push(
        check(
          `task-${word}`,
          task && stage && task.data.stageId === stage.id,
          task ? `${task.data.title} (stage ${task.data.stageId ?? 'none'})` : 'missing',
        ),
      );
    }
    results.push(check('three-tasks', tasks.length === 3, `${tasks.length} task(s)`));
    return [...results, ...commonChecks(state, project.id)];
  },
};

/** b) Mark one task done, with a revision message, leaving the others alone. */
const markDone = {
  id: 'mark-done',
  title: 'Mark one task done',
  projectName: (ctx) => `Harbor Clinic signage ${ctx.tag}`,
  seed: (ctx) => ({
    message: 'Compatibility test setup: a made-up signage project',
    operations: [
      { op: 'create', type: 'project', ref: 'project', data: { name: markDone.projectName(ctx) } },
      {
        op: 'create',
        type: 'stage',
        ref: 'stage',
        data: { projectId: '$project', name: 'Install', status: 'active' },
      },
      ...[
        ['order', 'Order the sign boards', 'todo'],
        ['paint', 'Paint the floor arrows', 'todo'],
        ['labels', 'Fix the door labels', 'in_progress'],
      ].map(([ref, title, status]) => ({
        op: 'create',
        type: 'task',
        ref,
        data: { projectId: '$project', stageId: '$stage', title, status },
      })),
    ],
  }),
  prompt: (ctx) =>
    [
      `In the Pharos project "${markDone.projectName(ctx)}", the task "Paint the floor arrows" is finished: mark it done, with a revision message saying why.`,
      'Leave the other tasks as they are.',
      ONLY_PHAROS,
    ].join('\n'),
  check(state, ctx) {
    const projectId = ctx.ids.project;
    const project = state.after.find((e) => e.id === projectId);
    const task = (ref) => state.after.find((e) => e.id === ctx.ids[ref]);
    const was = (ref) => state.before.find((e) => e.id === ctx.ids[ref]);
    const paint = task('paint');
    const meaning = meaningOf(project, 'task.status', paint?.data.status);
    const results = [check('task-done', meaning === 'done', `status ${paint?.data.status}`)];
    for (const ref of ['order', 'labels'])
      results.push(
        check(
          `other-task-unchanged-${ref}`,
          task(ref)?.data.status === was(ref)?.data.status,
          `${was(ref)?.data.status} -> ${task(ref)?.data.status}`,
        ),
      );
    const touching = state.revisions.filter((r) =>
      r.changes?.some((c) => c.id === ctx.ids.paint && c.fields?.status),
    );
    results.push(
      check(
        'done-revision-has-message',
        touching.length > 0 && touching.every((r) => r.message?.trim()),
        touching.map((r) => `"${r.message}"`).join('; '),
      ),
    );
    return [...results, ...commonChecks(state, projectId)];
  },
};

/** c) Answer an open question with a view: a StartHere and a TaskTable, passing view checks. */
const answer = {
  id: 'answer-view',
  title: 'Answer a question with a view',
  projectName: (ctx) => `Orchard Library move ${ctx.tag}`,
  seed: (ctx) => ({
    message: 'Compatibility test setup: a made-up library move with an open question',
    operations: [
      {
        op: 'create',
        type: 'project',
        ref: 'project',
        data: { name: answer.projectName(ctx), status: 'active' },
      },
      {
        op: 'create',
        type: 'stage',
        ref: 'stage',
        data: { projectId: '$project', name: 'Pack and move', status: 'active' },
      },
      ...[
        ['Label the book crates', 'done'],
        ['Book the moving van', 'done'],
        ['Pack the reference shelves', 'in_progress'],
        ['Move the reading tables', 'todo'],
        ['Set up the new returns desk', 'todo'],
      ].map(([title, status]) => ({
        op: 'create',
        type: 'task',
        data: { projectId: '$project', stageId: '$stage', title, status },
      })),
      {
        op: 'create',
        type: 'request',
        ref: 'request',
        data: {
          projectId: '$project',
          question: 'What is still left before the library move is finished?',
          status: 'open',
        },
      },
    ],
  }),
  prompt: (ctx) =>
    [
      `In the Pharos project "${answer.projectName(ctx)}" the owner asked a question (an open request).`,
      'Answer it with view_answer, passing its requestId. The answer page opens with a StartHere and shows the tasks that are not done in a TaskTable.',
      'Check the saved view with its preview and fix any warnings before you finish.',
      ONLY_PHAROS,
    ].join('\n'),
  /** The views the runner previews (view_preview) for this checker. */
  previewIds(state, ctx) {
    const request = state.after.find((e) => e.id === ctx.ids.request);
    return request?.data.answerViewId ? [request.data.answerViewId] : [];
  },
  check(state, ctx) {
    const request = state.after.find((e) => e.id === ctx.ids.request);
    const view = state.after.find((e) => e.id === request?.data.answerViewId);
    const components = componentsOf(view);
    const created = view && !state.before.some((e) => e.id === view.id);
    const problems = view ? previewProblems(state.previews?.[view.id]) : ['no view'];
    return [
      check('request-answered', request?.data.status === 'answered', request?.data.status),
      check(
        'answer-view',
        view && created && view.data.kind === 'answer' && view.data.projectId === ctx.ids.project,
        view ? `${view.id} (${view.data.kind})` : 'none',
      ),
      check('has-start-here', components.includes('StartHere'), components.join(', ')),
      check('has-task-table', components.includes('TaskTable'), ''),
      check('passes-view-checks', problems.length === 0, problems.join(' | ')),
      ...commonChecks(state, ctx.ids.project),
    ];
  },
};

/**
 * f) Answer a question that asks to explain and compare with a report document (R14), read live
 * from the data. The prompt doesn't say which kind of view: the agent picks it from what the
 * Pharos tools and guides say about such questions.
 */
const reportAnswer = {
  id: 'report-answer',
  title: 'Answer an explain-and-compare question with a report document',
  projectName: (ctx) => `Made-up household money ${ctx.tag}`,
  seed: (ctx) => ({
    message: 'Compatibility test setup: made-up household spending with an open question',
    operations: [
      {
        op: 'create',
        type: 'project',
        ref: 'project',
        data: {
          name: reportAnswer.projectName(ctx),
          status: 'active',
          recordTypes: [
            {
              key: 'spending',
              name: 'Spending',
              plural: 'Spending',
              fields: [
                { key: 'date', label: 'Date', kind: 'date' },
                { key: 'amount', label: 'Amount', kind: 'money', currency: 'EUR' },
                { key: 'category', label: 'Category', kind: 'text' },
              ],
            },
          ],
        },
      },
      ...[
        ['Corner Market', '2026-07-06', 18450, 'Groceries'],
        ['Rent July', '2026-07-01', 95000, 'Rent'],
        ['Corner Market', '2026-08-05', 21230, 'Groceries'],
        ['Rent August', '2026-08-01', 95000, 'Rent'],
        ['Corner Market', '2026-09-04', 24610, 'Groceries'],
        ['Rent September', '2026-09-01', 95000, 'Rent'],
      ].map(([title, date, cents, category]) => ({
        op: 'create',
        type: 'record',
        data: {
          projectId: '$project',
          recordType: 'spending',
          title,
          fields: { date, amount: { amount: cents, currency: 'EUR' }, category },
        },
      })),
      {
        op: 'create',
        type: 'request',
        ref: 'request',
        data: {
          projectId: '$project',
          question: 'Why did our spending go up from July to September? Compare the months.',
          status: 'open',
        },
      },
    ],
  }),
  prompt: (ctx) =>
    [
      `In the Pharos project "${reportAnswer.projectName(ctx)}" the owner asked a question (an open request).`,
      'Answer it in Pharos, passing its requestId, with the kind of view the Pharos tools and guides say such a question gets.',
      'Use live numbers from the data, not numbers typed in by hand. Check the saved view with its preview and fix any warnings before you finish.',
      ONLY_PHAROS,
    ].join('\n'),
  /** The views the runner previews (view_preview) for this checker. */
  previewIds(state, ctx) {
    const request = state.after.find((e) => e.id === ctx.ids.request);
    return request?.data.answerViewId ? [request.data.answerViewId] : [];
  },
  check(state, ctx) {
    const request = state.after.find((e) => e.id === ctx.ids.request);
    const view = state.after.find((e) => e.id === request?.data.answerViewId);
    const created = view && !state.before.some((e) => e.id === view.id);
    const doc = view?.data.doc;
    const reads = docLiveReads(doc);
    const problems = view ? previewProblems(state.previews?.[view.id]) : ['no view'];
    return [
      check('request-answered', request?.data.status === 'answered', request?.data.status),
      check(
        'answer-view',
        view && created && view.data.kind === 'answer' && view.data.projectId === ctx.ids.project,
        view ? `${view.id} (${view.data.kind})` : 'none',
      ),
      check(
        'is-report-document',
        doc && Array.isArray(doc.blocks),
        !view
          ? 'none'
          : doc
            ? `doc, ${doc.blocks?.length ?? 0} block(s)`
            : view.data.page
              ? 'a report page'
              : 'a board',
      ),
      check('reads-live-data', reads.length > 0, reads.join(', ')),
      check('passes-view-checks', problems.length === 0, problems.join(' | ')),
      ...commonChecks(state, ctx.ids.project),
    ];
  },
};

/** d) Start a project from a pack and add one record. */
const pack = {
  id: 'pack',
  title: 'Start from a pack and add a record',
  projectName: (ctx) => `Runabout car ${ctx.tag}`,
  prompt: (ctx) =>
    [
      `In Pharos, start a new project named "${pack.projectName(ctx)}" from the car pack (pack_list, then pack_apply; no example records).`,
      'Then add one record for the car itself: a made-up 2019 Made-up Motors Runabout, plate CMP-0001, odometer 42000 km.',
      ONLY_PHAROS,
    ].join('\n'),
  check(state, ctx) {
    const project = createdProject(state, pack.projectName(ctx));
    const results = [check('project-created', project, project ? project.id : 'not found')];
    if (!project) return [...results, ...commonChecks(state, undefined)];
    const types = (project.data.recordTypes ?? []).map((t) => t.key);
    const records = inProject(state, 'record', project.id);
    const vehicle = records.find((r) => r.data.recordType === 'vehicle');
    const fields = vehicle?.data.fields ?? {};
    results.push(
      check('car-pack-applied', types.includes('vehicle'), types.join(', ')),
      check('vehicle-record', vehicle, `${records.length} record(s)`),
      check(
        'vehicle-details',
        Number(fields.year) === 2019 && lower(fields.plate).includes('cmp-0001'),
        vehicle ? JSON.stringify(fields) : '',
      ),
    );
    return [...results, ...commonChecks(state, project.id)];
  },
};

/** e) Ask the owner for a folder and stop, saying it waits for the owner. */
const folder = {
  id: 'folder-request',
  title: 'Ask for a folder and wait',
  projectName: (ctx) => `Made-up Trading Co papers ${ctx.tag}`,
  /** The runner makes this empty folder (made up) before the run; ctx.folderPath is its path. */
  needsFolder: true,
  seed: (ctx) => ({
    message: 'Compatibility test setup: a made-up company papers project',
    operations: [
      { op: 'create', type: 'project', ref: 'project', data: { name: folder.projectName(ctx) } },
    ],
  }),
  prompt: (ctx) =>
    [
      `The papers for the Pharos project "${folder.projectName(ctx)}" are in the folder ${ctx.folderPath}.`,
      'Ask the owner in Pharos to share that folder with this project (details level), then stop: the owner has to approve it.',
      'Finish with one line saying what happens next.',
      ONLY_PHAROS,
    ].join('\n'),
  check(state, ctx) {
    const requests = (state.folderRequests ?? []).filter((r) => r.path === ctx.folderPath);
    const request = requests[0];
    return [
      check('folder-requested', requests.length === 1, `${requests.length} request(s)`),
      check('request-pending', request?.status === 'pending', request?.status),
      check(
        'for-the-project',
        request?.projectId === ctx.ids.project,
        request?.projectId ?? 'no project',
      ),
      check(
        'requested-by-agent',
        request && request.requestedBy && request.requestedBy !== 'me',
        request?.requestedBy,
      ),
      check(
        'says-it-waits',
        /approv|owner|wait/i.test(state.finalMessage ?? ''),
        String(state.finalMessage ?? '')
          .trim()
          .slice(0, 160),
      ),
      ...commonChecks(state, ctx.ids.project, { expectRevisions: false }),
    ];
  },
};

export const SCENARIOS = [setup, markDone, answer, pack, folder, reportAnswer];
