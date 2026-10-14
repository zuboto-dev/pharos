// Shared by the pack steps (A1, A3, A4): start a sample project from a pack once, find its page.
import { StepError, projectNamed, viewNamed } from '../lib.mjs';

/** The pack pages by pack key, as the packs name them. */
export const PAGES = {
  car: "What's due",
  money: 'This month',
  music: 'Songs',
  study: 'Study',
  company: 'What expires soon',
};

/**
 * The sample project `name` started from `pack` (with the pack's made-up examples). Made when no
 * project has that name; reused otherwise. Returns { projectId, viewId, made }.
 */
export async function ensurePack({ call, adopt, log }, pack, name) {
  const existing = await projectNamed(call, name);
  let projectId;
  let made = false;
  if (existing) {
    projectId = existing.id;
    adopt(projectId);
  } else {
    const { packs } = await call('pack_list', {});
    if (!packs.some((p) => p.key === pack))
      throw new StepError(`This Pharos has no "${pack}" pack (it predates it). Nothing changed.`);
    const applied = await call('pack_apply', { pack, name, examples: true });
    projectId = applied.projectId;
    made = true;
    log(
      `started "${name}" from the ${pack} pack: revision ${applied.revision}, ${applied.records} made-up records`,
    );
  }
  const page = await viewNamed(call, projectId, PAGES[pack]);
  if (!page) throw new StepError(`"${name}" has no page "${PAGES[pack]}" (renamed by hand?).`);
  return { projectId, viewId: page.id, made };
}

/** Stops on any query finding on a pack page (the page's totals and dates must match the records). */
export async function checkFindings(call, name, viewId) {
  const preview = await call('view_preview', { viewId });
  const findings = preview.findings ?? [];
  if (findings.length)
    throw new StepError(`"${name}": query findings:\n${JSON.stringify(findings, null, 2)}`, 3);
  return preview;
}
