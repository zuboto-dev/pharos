// v0.2 A3 (R9): "Music (sample)", "Study (sample)" and "Company documents (sample)" from their packs.
// Adapted from v02/A3/patch-r9-packs.mjs: the folder comes from the installer's one request (the
// original asked again without a project), each project is reused when there, and each project's
// follow-up apply (the mixes' audio, Example Co's papers) is skipped when it's done.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StepError, day, unaddedFiles } from '../lib.mjs';
import { checkFindings, ensurePack } from './packs.mjs';

export const key = 'A3';
export const title = 'More packs: Music, Study, Company documents';

export const NAMES = {
  music: 'Music (sample)',
  study: 'Study (sample)',
  company: 'Company documents (sample)',
};

const MIXES = [
  ['f1', 'music/night-bus-mix-1.wav', 'Night Bus mix 1'],
  ['f2', 'music/night-bus-mix-2.wav', 'Night Bus mix 2'],
  ['f3', 'music/night-bus-mix-3.wav', 'Night Bus mix 3'],
  ['f4', 'music/paper-boats-rough.wav', 'Paper Boats rough mix'],
  ['f5', 'music/low-tide-demo.wav', 'Low Tide demo'],
];

const PAPERS = [
  {
    ref: 'cert',
    path: 'business-registration/business-registration-certificate.pdf',
    title: 'Certificate of registration',
    kind: 'registration',
    update: () => ({ issuer: 'Companies registry (sample)', issuedDate: day(-700) }),
    renewal: 'Annual return',
  },
  {
    ref: 'tax',
    path: 'business-registration/tax-registration-letter.pdf',
    title: 'Tax registration letter',
    kind: 'tax',
    update: () => ({ issuer: 'Tax office (sample)', issuedDate: day(-340), expiryDate: day(25) }),
    renewal: 'Quarterly VAT filing',
  },
  {
    ref: 'notice',
    path: 'business-registration/registered-address-change-notice.pdf',
    title: 'Registered address notice',
    kind: 'licence',
    update: () => ({
      issuer: 'City business office (sample)',
      issuedDate: day(-380),
      expiryDate: day(-6),
    }),
    renewal: 'Trading licence renewal',
  },
];

function addFile(projectId, folderId, files, ref, path, title, details) {
  if (!files.has(path))
    throw new StepError(
      `${path} isn't in the shared folder's scan (or is in the project already).`,
      2,
    );
  return [
    {
      op: 'create',
      type: 'file',
      ref,
      data: {
        projectId,
        rootId: folderId,
        path,
        title,
        kind: details.kind,
        tags: details.tags ?? [],
      },
    },
    ...(details.update
      ? [{ op: 'update', type: 'file', id: `$${ref}`, data: details.update }]
      : []),
  ];
}

async function music(ctx, projectId) {
  const { call, folderId, sampleFolder, log } = ctx;
  const records = await call('list', { type: 'record', projectId });
  if (records.some((r) => r.title === 'Night Bus mix 3')) return;
  const hasAudio = existsSync(join(sampleFolder, 'music', 'night-bus-mix-3.wav'));
  const files = hasAudio
    ? await unaddedFiles(
        call,
        projectId,
        folderId,
        'music/',
        MIXES.map(([, p]) => p),
      )
    : new Map();
  const byTitle = (t) => records.find((r) => r.title === t)?.id;
  const operations = hasAudio
    ? MIXES.flatMap(([ref, path, title]) =>
        addFile(projectId, folderId, files, ref, path, title, { kind: 'audio', tags: ['mix'] }),
      )
    : [];
  for (const [ref, , title] of hasAudio ? MIXES : []) {
    const id = byTitle(title);
    if (id)
      operations.push({ op: 'update', type: 'record', id, data: { fields: { file: `$${ref}` } } });
  }
  operations.push({
    op: 'create',
    type: 'record',
    data: {
      projectId,
      recordType: 'mix',
      title: 'Night Bus mix 3',
      fields: {
        song: byTitle('Night Bus'),
        date: day(-2),
        version: 'v3',
        ...(hasAudio ? { file: '$f3' } : {}),
      },
    },
  });
  const res = await call('apply', {
    message:
      'Add the made-up sample mixes from the shared folder and point each mix at its audio, so the page plays the latest mix of each song (R9 sample)',
    operations,
  });
  log(
    `"${NAMES.music}": revision ${res.revision?.id ?? res.revision} with ${hasAudio ? '5 audio files and ' : ''}a third Night Bus mix`,
  );
  if (!hasAudio)
    log(
      'no samples/files/music in the repo: the mixes have no audio (run samples/make-sample-audio.mjs)',
    );
}

async function company(ctx, projectId) {
  const { call, folderId, log } = ctx;
  const inProject = await call('list', { type: 'file', projectId });
  if (PAPERS.every((p) => inProject.some((f) => f.title === p.title))) return;
  if (inProject.some((f) => PAPERS.some((p) => p.title === f.title)))
    throw new StepError(
      `"${NAMES.company}" has some of Example Co's papers but not all; add the rest by hand.`,
    );
  const files = await unaddedFiles(
    call,
    projectId,
    folderId,
    'business-registration/',
    PAPERS.map((p) => p.path),
  );
  const records = await call('list', { type: 'record', projectId });
  const byTitle = (t) => records.find((r) => r.title === t)?.id;
  const operations = PAPERS.flatMap((p) =>
    addFile(projectId, folderId, files, p.ref, p.path, p.title, {
      kind: p.kind,
      tags: ['example-co'],
      update: p.update(),
    }),
  );
  for (const p of PAPERS) {
    const id = byTitle(p.renewal);
    if (!id) throw new StepError(`"${NAMES.company}" has no renewal "${p.renewal}".`);
    operations.push({
      op: 'update',
      type: 'record',
      id,
      data: { fields: { document: `$${p.ref}` } },
    });
  }
  const res = await call('apply', {
    message:
      "Add Example Co's made-up papers with their issuers and dates, and link the renewals to them (R9 sample)",
    operations,
  });
  log(`"${NAMES.company}": revision ${res.revision?.id ?? res.revision} with 3 papers`);
}

export async function run(ctx) {
  const rows = [];
  for (const [pack, name] of Object.entries(NAMES)) {
    const { projectId, viewId, made } = await ensurePack(ctx, pack, name);
    if (pack === 'music') await music(ctx, projectId);
    if (pack === 'company') await company(ctx, projectId);
    await checkFindings(ctx.call, name, viewId);
    const view = (await ctx.call('view_get', { viewId })).name;
    rows.push({ project: name, projectId, view, viewId, made });
  }
  return rows;
}
