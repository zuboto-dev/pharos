// Installs every v0.2 sample view in one go, for the owner's single review · Opus 5.5
//
//   node samples/install/install-samples.mjs --url http://127.0.0.1:<port> [--repo <pharos repo>]
//
// Made-up data only (samples/files/ in the repo, the packs' own examples). It works as agent
// "Opus 5.5" over MCP, never the owner's routes, and only on a Pharos on this computer. In order:
//  0. finds (or creates) the project "Pharos samples" and makes ONE folder request: <repo>/samples/
//     files, level Details (it holds business-registration/, ui-examples/, music/, car/ and money/). While the
//     request waits, it prints what the owner clicks and exits 2 having changed nothing else; run it
//     again after approving and it continues.
//  1. runs the samples in feature order (steps/): R7.12 business registration papers (supersedes
//     R7.11), R7.13 UI examples gallery, B1 look and motion, A1 Car and Money packs, A2 decision
//     block, B2 visual system, A3 Music/Study/Company packs, B3 empty and loading, A4 actions on the
//     pack pages, A5 (R11) changed since you looked and a stale answer, A6 files at a glance
//     (a FileList that opens the file viewer), R13 a report page ("Spending story": HTML with live
//     numbers from made-up spending records, a what-if slider, an SVG chart and one asset).
//  2. prints a table (sample → project → view → URL path) and writes samples.json beside this file.
//
// Idempotent: every step checks what's there by name and only makes what's missing, so a re-run
// changes nothing, and a run that stopped half way finishes. It touches only "Pharos samples" and
// the sample projects it starts from packs ("Car (sample)", …): every write is checked against
// those projects before it's sent (lib.mjs guarded), and a name two projects share stops it.
//
// Exit: 0 done · 2 waiting for the owner (folder request) · 1 a step failed · 3 a pack page's
// totals or dates don't match its records · 64 usage.
import { realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT,
  SAMPLES_PROJECT,
  StepError,
  connect,
  guarded,
  localBase,
  projectNamed,
  viewPath,
} from './lib.mjs';
import * as r712 from './steps/r7-12-business-registration.mjs';
import * as r713 from './steps/r7-13-gallery.mjs';
import * as b1 from './steps/b1-look-and-motion.mjs';
import * as a1 from './steps/a1-r8-packs.mjs';
import * as a2 from './steps/a2-decision-block.mjs';
import * as b2 from './steps/b2-visual-system.mjs';
import * as a3 from './steps/a3-r9-packs.mjs';
import * as b3 from './steps/b3-empty-and-loading.mjs';
import * as a4 from './steps/a4-r10-actions.mjs';
import * as a5 from './steps/a5-r11.mjs';
import * as a6 from './steps/a6-file-viewer.mjs';
import * as r13 from './steps/r13-report-page.mjs';

const STEPS = [r712, r713, b1, a1, a2, b2, a3, b3, a4, a5, a6, r13];
const HERE = dirname(fileURLToPath(import.meta.url));

/** Every project the installer may change: "Pharos samples" and the pack samples. */
const SAMPLE_NAMES = [
  SAMPLES_PROJECT,
  ...a1.SAMPLES.map((s) => s.name),
  ...Object.values(a3.NAMES),
];

function usage(message) {
  if (message) console.error(message);
  console.error(
    'Usage: node install-samples.mjs --url http://127.0.0.1:<port> [--repo <pharos repo>]',
  );
  process.exit(64);
}

const args = process.argv.slice(2);
const value = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
let base;
try {
  base = localBase(value('--url'));
} catch (error) {
  usage(error.message);
}
const repo = value('--repo') ?? join(HERE, '..', '..');
let sampleFolder;
try {
  sampleFolder = realpathSync(join(repo, 'samples', 'files'));
} catch {
  usage(`No samples/files folder in ${repo}. Pass the Pharos repo with --repo.`);
}

const rows = [];
function table() {
  const lines = rows.map((r) => [
    r.sample + (r.minor ? ' (tab)' : ''),
    r.project,
    r.view,
    r.path,
    r.made ? 'made now' : 'there',
  ]);
  const head = ['Sample', 'Project', 'View', 'URL path', ''];
  const width = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
  const fmt = (l) =>
    l
      .map((c, i) => c.padEnd(width[i]))
      .join('  ')
      .trimEnd();
  console.log(['', fmt(head), fmt(width.map((n) => '-'.repeat(n))), ...lines.map(fmt)].join('\n'));
  writeFileSync(
    join(HERE, 'samples.json'),
    `${JSON.stringify({ server: base, at: new Date().toISOString(), samples: rows }, null, 2)}\n`,
  );
  console.log(`\nOpen any of them at ${base}<URL path>. Written to ${join(HERE, 'samples.json')}.`);
}

try {
  const raw = await connect(base, AGENT);
  const tools = (await raw.tools()).map((t) => t.name);
  for (const tool of ['folder_request', 'files_unadded', 'pack_apply', 'view_preview'])
    if (!tools.includes(tool))
      throw new StepError(
        `This Pharos has no ${tool} tool: it is older than v0.2. Nothing changed.`,
      );

  // ---------------------------------------------------------------- 0. the project and the folder
  const scope = { ids: new Set(), names: new Set(SAMPLE_NAMES) };
  const call = guarded(raw, scope);
  let samples = await projectNamed(call, SAMPLES_PROJECT);
  if (samples) {
    scope.ids.add(samples.id);
    console.log(`0. Using the project "${SAMPLES_PROJECT}" (${samples.id}).`);
  } else {
    const res = await call('apply', {
      message:
        'Create a project for Pharos samples: made-up data that shows new features (v0.2 samples)',
      operations: [
        {
          op: 'create',
          type: 'project',
          ref: 'p',
          data: {
            name: SAMPLES_PROJECT,
            summary:
              'Made-up data that shows Pharos features. Every name, document and picture here is fictional.',
          },
        },
      ],
    });
    samples = { id: res.created.p, name: SAMPLES_PROJECT };
    scope.ids.add(samples.id);
    console.log(`0. Created the project "${SAMPLES_PROJECT}" (${samples.id}).`);
  }
  samples = { id: samples.id, name: SAMPLES_PROJECT };

  const request = await call('folder_request', {
    path: sampleFolder,
    level: 'details',
    reason:
      'To show the made-up sample files (Example Co papers, car and bank papers, UI wireframes, sample mixes) in the Pharos samples and pack sample projects',
    projectId: samples.id,
  });
  if (request.status === 'declined')
    throw new StepError(
      `The owner declined the folder ${request.path}. Not asking again; nothing else changed.`,
      2,
    );
  if (request.status === 'pending') {
    console.error(
      [
        `0. Asked for one folder (request ${request.id}). Waiting for the owner:`,
        `   Open ${base} and, in the notice at the top of the page (or Settings → Folders), click`,
        `   "Approve" on "${AGENT} asks to use the folder files"`,
        `   (${request.path}, level Details: agents see titles and dates, never contents).`,
        '   Then run this script again. Nothing else changed.',
      ].join('\n'),
    );
    process.exit(2);
  }
  const folderId = request.folderId;
  console.log(`0. The folder ${request.path} is approved (${folderId}).`);

  // ---------------------------------------------------------------- 1. the samples, in order
  const ctx = {
    call,
    base,
    repo,
    sampleFolder,
    folderId,
    samples,
    adopt: (id) => scope.ids.add(id),
  };
  for (const step of STEPS) {
    const lines = [];
    const log = (line) => lines.push(line);
    const result = await step.run({ ...ctx, log });
    const stepRows = Array.isArray(result) ? result : result.rows;
    const made = stepRows.some((r) => r.made) || lines.length > 0;
    console.log(
      `${step.key} · ${step.title}: ${result.skipped ? 'skipped' : made ? 'done now' : 'already there'}`,
    );
    for (const line of lines) console.log(`   ${line}`);
    for (const r of stepRows)
      rows.push({
        sample: step.key,
        feature: step.title,
        ...r,
        path: viewPath(r.projectId, r.viewId),
      });
  }
  table();
} catch (error) {
  if (rows.length) table();
  if (error instanceof StepError) {
    console.error(`\nStopped: ${error.message}`);
    process.exit(error.code);
  }
  console.error(`\nStopped: ${error?.stack ?? error}`);
  process.exit(1);
}
