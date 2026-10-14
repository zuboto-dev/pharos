// v0.2 A1 (R8): "Car (sample)" and "Money (sample)", each started from its pack with made-up records.
// Adapted from v02/A1/patch-r8-packs.mjs: pack_list now returns { guide, packs } (the original read
// it as a list and broke), and an existing project of that name is reused instead of stopping.
// New (S1): the made-up papers in samples/files/car and samples/files/money are added, so the
// pages' "Registration and insurance" and "Statements" blocks show files instead of an empty state.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { StepError, unaddedFiles } from '../lib.mjs';
import { checkFindings, ensurePack } from './packs.mjs';

export const key = 'A1';
export const title = 'Records and packs: Car and Money';

export const SAMPLES = [
  { pack: 'car', name: 'Car (sample)' },
  { pack: 'money', name: 'Money (sample)' },
];

/** The papers each sample gets, with the details an agent fills in (dates as the PDFs say). */
const PAPERS = {
  car: [
    {
      path: 'car/vehicle-registration.pdf',
      title: 'Vehicle registration certificate',
      kind: 'registration',
      issuer: 'Example Vehicle Licensing Office',
      issuedDate: '2022-03-14',
    },
    {
      path: 'car/insurance-certificate.pdf',
      title: 'Motor insurance certificate',
      kind: 'insurance',
      issuer: 'Example Mutual Insurance',
      issuedDate: '2025-10-19',
      expiryDate: '2026-10-18',
    },
  ],
  money: [
    {
      path: 'money/bank-statement-2026-09.pdf',
      title: 'Bank statement, September 2026',
      kind: 'statement',
      issuer: 'Example Savings Bank',
      issuedDate: '2026-10-01',
    },
  ],
};

async function addPapers({ call, folderId, sampleFolder, log }, pack, name, projectId) {
  const papers = PAPERS[pack];
  if (!papers.every((p) => existsSync(join(sampleFolder, p.path)))) {
    log(
      `no samples/files/${pack} papers in the repo (node samples/make-sample-files.mjs); skipped`,
    );
    return;
  }
  const inProject = await call('list', { type: 'file', projectId });
  const missing = papers.filter((p) => !inProject.some((f) => f.title === p.title));
  if (!missing.length) return;
  const unadded = await unaddedFiles(
    call,
    projectId,
    folderId,
    `${pack}/`,
    missing.map((p) => p.path),
  );
  const operations = [];
  for (const [i, p] of missing.entries()) {
    if (!unadded.has(p.path))
      throw new StepError(
        `The folder's scan hasn't found ${p.path}; scan the folder in Settings, then run this again.`,
        2,
      );
    const { path, title, kind, ...details } = p;
    operations.push(
      {
        op: 'create',
        type: 'file',
        ref: `f${i}`,
        data: { projectId, rootId: folderId, path, title, kind },
      },
      { op: 'update', type: 'file', id: `$f${i}`, data: details },
    );
  }
  const res = await call('apply', {
    message: `Add the made-up ${pack === 'car' ? 'registration and insurance papers' : 'bank statement'} from the shared folder, with their issuers and dates (v0.2 samples)`,
    operations,
  });
  log(
    `"${name}": added ${missing.length} made-up paper${missing.length === 1 ? '' : 's'} (revision ${res.revision?.id ?? res.revision})`,
  );
}

export async function run(ctx) {
  const rows = [];
  for (const { pack, name } of SAMPLES) {
    const { projectId, viewId, made } = await ensurePack(ctx, pack, name);
    await addPapers(ctx, pack, name, projectId);
    await checkFindings(ctx.call, name, viewId);
    const view = (await ctx.call('view_get', { viewId })).name;
    rows.push({ project: name, projectId, view, viewId, made });
  }
  return rows;
}
