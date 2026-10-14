// R7.12 (supersedes R7.11): an agent brings Example Co's made-up business registration papers into
// "Pharos samples", links a task, a decision and two sources, and builds a page for them.
// Adapted from R7.12/patch-agent-docs.mjs: the folder comes from the installer's one request; each
// part is skipped when it's there already (the papers' apply is one revision, keyed on the task).
import { StepError, day, ensureView, optionValue, sleep, unaddedFiles } from '../lib.mjs';

export const key = 'R7.12';
export const title = 'Business registration papers (files, linked work, sources)';

const VIEW = 'Business registration documents';
const TAG = 'business-registration';
const TASK = 'Renew the tax registration';
const DECISION = 'Registered address moved';
const SOURCES = ['Company seal image', 'Business registry (made-up page)'];

const DOCS = [
  {
    ref: 'cert',
    path: 'business-registration/business-registration-certificate.pdf',
    title: 'Business registration certificate',
    kind: 'certificate',
    issuer: 'Example City Business Registry',
    issuedDate: '2024-03-01',
  },
  {
    ref: 'notice',
    path: 'business-registration/registered-address-change-notice.pdf',
    title: 'Registered address change notice',
    kind: 'certificate',
    issuer: 'Example City Business Registry',
    issuedDate: '2025-06-15',
  },
  {
    ref: 'tax',
    path: 'business-registration/tax-registration-letter.pdf',
    title: 'Tax registration letter',
    kind: 'certificate',
    issuer: 'Example Tax Office',
    issuedDate: '2024-03-20',
    expiryDate: '2026-12-31',
  },
  {
    ref: 'seal',
    path: 'business-registration/company-seal.png',
    title: 'Company seal',
    kind: 'other',
    issuer: 'Example Co',
  },
  {
    ref: 'notes',
    path: 'business-registration/notes.md',
    title: 'Registration notes',
    kind: 'other',
  },
];
const addedTitle = (path) => path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');

export async function run({ call, samples, folderId, log }) {
  const projectId = samples.id;
  const project = await call('get', { id: projectId });
  const tasks = await call('list', { type: 'task', projectId, where: { title: TASK } });

  // ---------------------------------------------------------------- the papers, links, sources
  if (!tasks.length) {
    const inProject = await call('list', { type: 'file', projectId });
    const fileFor = (doc) =>
      inProject.find((f) => f.title === doc.title || f.title === addedTitle(doc.path));
    const missing = DOCS.filter((doc) => !fileFor(doc)).map((doc) => doc.path);
    const unadded = await unaddedFiles(call, projectId, folderId, TAG, missing);
    const operations = [];
    const idOf = {};
    for (const doc of DOCS) {
      const existing = fileFor(doc);
      if (existing) {
        idOf[doc.ref] = existing.id;
        continue;
      }
      if (!unadded.has(doc.path))
        throw new StepError(
          `The folder's scan hasn't found ${doc.path}. Check samples/files in the repo (node samples/make-sample-files.mjs) or scan the folder in Settings, then run this again.`,
          2,
        );
      operations.push({
        op: 'create',
        type: 'file',
        ref: doc.ref,
        data: { projectId, rootId: folderId, path: doc.path, title: doc.title },
      });
      idOf[doc.ref] = `$${doc.ref}`;
    }
    const existingFiles = new Map(inProject.map((f) => [f.id, f]));
    for (const doc of DOCS) {
      const id = idOf[doc.ref];
      operations.push({
        op: 'update',
        type: 'file',
        id,
        data: {
          title: doc.title,
          kind: optionValue(project, 'file.kind', doc.kind),
          tags: [...new Set([...(existingFiles.get(id)?.tags ?? []), TAG])],
          ...(doc.issuer ? { issuer: doc.issuer } : {}),
          ...(doc.issuedDate ? { issuedDate: doc.issuedDate } : {}),
          ...(doc.expiryDate ? { expiryDate: doc.expiryDate } : {}),
        },
      });
    }
    operations.push(
      {
        op: 'create',
        type: 'task',
        ref: 'renew',
        data: {
          projectId,
          title: TASK,
          description:
            'The tax registration letter is valid until Dec 31, 2026. Renew it before then.',
          dueDate: '2026-12-31',
          priority: optionValue(project, 'task.priority', 'high'),
          fileIds: [idOf.tax],
        },
      },
      {
        op: 'create',
        type: 'decision',
        ref: 'moved',
        data: {
          projectId,
          title: DECISION,
          body: 'Example Co moved its registered address; the change notice records it.',
          status: optionValue(project, 'decision.status', 'accepted'),
          decisionDate: '2025-06-15',
          fileIds: [idOf.notice],
        },
      },
      {
        op: 'create',
        type: 'artifact',
        ref: 'sealSource',
        data: {
          projectId,
          title: SOURCES[0],
          kind: 'other',
          uri: 'business-registration/company-seal.png',
        },
      },
      {
        op: 'create',
        type: 'artifact',
        ref: 'registry',
        data: {
          projectId,
          title: SOURCES[1],
          kind: 'other',
          uri: 'https://example.com/business-registry',
        },
      },
    );
    const applied = await call('apply', {
      message:
        'Bring in the business registration papers: add them from the approved folder, tag and date them, and link the renewal task and the address decision (R7.12 sample)',
      operations,
    });
    log(
      `added ${operations.filter((o) => o.op === 'create' && o.type === 'file').length} papers, the task, the decision and two sources (revision ${applied.revision.id})`,
    );
    // Pharos links the relative source to the file it names, just after the revision.
    let linked = false;
    for (let i = 0; i < 50 && !linked; i++) {
      linked = !!(await call('get', { id: applied.created.sealSource })).data.fileId;
      if (!linked) await sleep(100);
    }
    log(
      linked
        ? 'Pharos linked the relative source to the seal file'
        : 'the relative source is not linked yet',
    );
  }

  // ---------------------------------------------------------------- the view
  const files = await call('list', { type: 'file', projectId });
  const idOf = {};
  for (const doc of DOCS) {
    const f = files.find((x) => x.title === doc.title);
    if (!f) throw new StepError(`"${doc.title}" isn't in "Pharos samples" any more.`);
    idOf[doc.ref] = f.id;
  }
  const taskId = (await call('list', { type: 'task', projectId, where: { title: TASK } }))[0]?.id;
  const artifacts = await call('list', { type: 'artifact', projectId });
  const sourceIds = SOURCES.map((t) => artifacts.find((a) => a.title === t)?.id).filter(Boolean);
  const fileIds = DOCS.map((doc) => idOf[doc.ref]);
  const widgets = [
    {
      id: 'start',
      node: {
        component: 'StartHere',
        purpose: 'needs-you',
        due: '2026-12-31',
        why: "Keep Example Co's registration papers together, linked to the work they need",
        headline:
          'The five registration papers are in Pharos; the tax registration needs renewing by Dec 31.',
        yourPart: 'Renew the tax registration before Dec 31, 2026.',
        evidence: [{ id: idOf.tax, label: 'Tax letter' }, ...(taskId ? [taskId] : [])],
        date: day(0),
        path: [
          { label: 'The papers', says: 'All five; tap one to show it', target: 'papers' },
          { label: 'The document', says: 'Its preview, dates and actions', target: 'document' },
          { label: 'Linked work', says: 'The renewal and the address change', target: 'work' },
        ],
      },
    },
    {
      id: 'papers',
      w: 6,
      node: {
        component: 'FileList',
        title: 'Registration papers',
        filter: { where: { tags: TAG } },
        controls: ['search'],
        details: ['issuedDate', 'expiryDate'],
        showIn: 'document',
      },
    },
    {
      id: 'document',
      w: 6,
      node: { component: 'FileView', title: 'Document', file: idOf.cert, size: 'compact' },
    },
    {
      id: 'work',
      w: 6,
      node: {
        component: 'TaskTable',
        title: 'Linked tasks',
        filter: { where: { fileIds } },
        columns: ['status', 'dueDate'],
      },
    },
    {
      id: 'decisions',
      w: 6,
      node: { component: 'DecisionLog', title: 'Linked decisions', filter: { where: { fileIds } } },
    },
    {
      id: 'expiry',
      w: 6,
      node: {
        component: 'FileList',
        title: 'Expiry dates',
        filter: {
          where: { tags: TAG, expiryDate: { exists: true } },
          sort: [{ field: 'expiryDate' }],
        },
        groupBy: 'none',
        controls: [],
        details: ['issuer', 'expiryDate'],
        showIn: 'document',
      },
    },
    {
      id: 'sources',
      w: 6,
      node: {
        component: 'DataTable',
        title: 'Sources',
        query: { type: 'artifact', where: { id: sourceIds } },
        columns: [{ field: 'title' }, { field: 'uri', label: 'Where' }],
      },
    },
  ];
  const view = await ensureView(
    call,
    projectId,
    VIEW,
    "Example Co's business registration papers, the work they need, and their sources",
    widgets,
    'A view for the business registration papers: the list, the document, the linked task and decision, expiry dates and sources (R7.12 sample)',
  );
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made: view.made }];
}
