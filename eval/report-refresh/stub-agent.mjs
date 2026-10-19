#!/usr/bin/env node
// A stand-in answering agent for the report-page refresh loop (eval/report-refresh/run.mjs).
//
// Pharos runs it as PHAROS_AGENT_COMMAND for new questions, with PHAROS_URL and
// PHAROS_REQUEST_IDS in the environment. It does what the brief asks of a refresh of a report
// page, with no model: over MCP it calls report_guide, reads the page with view_get, reads each
// named read's rows with list, works the numbers out again, and saves the same page with
// view_update (new HTML and summary, the same page.data, the requestId and expectedRevision).
// Its assets are left alone. Requests that aren't a report-page refresh are left open.
import { connect } from '../../samples/install/lib.mjs';

const NAME = 'Refresh stub';
const base = (process.env.PHAROS_URL ?? '').replace(/\/$/, '');
const ids = (process.env.PHAROS_REQUEST_IDS ?? '').split(',').filter(Boolean);
if (!base || !ids.length) {
  console.error('stub-agent: needs PHAROS_URL and PHAROS_REQUEST_IDS (Pharos sets both)');
  process.exit(64);
}
const host = new URL(base).hostname;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || new URL(base).port === '4300') {
  console.error(`stub-agent: refusing ${base}: test servers only (never port 4300)`);
  process.exit(64);
}

const euros = (cents) => `€${(cents / 100).toFixed(2)}`;

/** Rows of a named read, as the page would get them: list with its type and equality filter. */
async function rowsOf(call, projectId, read) {
  const where = read.filter?.where ?? {};
  const scalar = Object.fromEntries(
    Object.entries(where).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)),
  );
  return call('list', { type: read.type, projectId, where: scalar });
}

/** Totals by month and category of money records (fields.date, fields.amount, fields.category). */
function monthTotals(rows) {
  const months = {};
  for (const r of rows) {
    const f = r.fields ?? {};
    if (!f.date || !f.amount) continue;
    const m = String(f.date).slice(0, 7);
    const cat = f.category ?? 'Other';
    months[m] ??= {};
    months[m][cat] = (months[m][cat] ?? 0) + f.amount.amount;
  }
  return months;
}

const call = await connect(base, NAME);
let refreshed = 0;
for (const requestId of ids) {
  const request = await call('get', { id: requestId });
  if (request.data?.mode !== 'refresh' || request.data.status !== 'open') continue;
  const viewId = request.data.viewId;
  const view = await call('view_get', { viewId });
  if (!view.page) continue;
  await call('report_guide', {});
  if (view.page.htmlTruncated) throw new Error(`stub-agent: ${viewId} is too long to rewrite`);
  const reads = view.page.data ?? {};
  const lines = [];
  let total = 0;
  for (const [name, read] of Object.entries(reads)) {
    const rows = await rowsOf(call, view.projectId, read);
    const months = monthTotals(rows);
    const sum = Object.values(months).reduce(
      (n, cats) => n + Object.values(cats).reduce((a, b) => a + b, 0),
      0,
    );
    total += sum;
    const groceries = Object.keys(months)
      .sort()
      .map((m) => `${m} ${euros(months[m].Groceries ?? 0)}`);
    lines.push(
      `${name}: ${rows.length} rows, ${euros(sum)} in all; groceries ${groceries.join(', ')}`,
    );
  }
  const at = new Date().toISOString();
  const note = `<!-- pharos-refresh ${at} by ${NAME}: ${lines.join(' | ')} -->`;
  const html = view.page.html.replace(/<!-- pharos-refresh [^>]*-->\n?/g, '');
  const summary = `Refreshed ${at.slice(0, 10)} from the data now: ${euros(total)} spent across the quarter; ${lines.join('; ')}. Made-up data.`;
  const result = await call('view_update', {
    viewId,
    expectedRevision: view.revision,
    requestId,
    page: { html: html.replace(/<\/body>/i, `${note}\n</body>`), data: reads, summary },
    reply: `Rewrote the page from the data now (${euros(total)} in all).`,
    message: `Refresh "${view.name}": its data changed since it was written`,
  });
  console.log(
    `stub-agent: refreshed ${viewId} for ${requestId} at revision ${result.revision?.id ?? result.revision}`,
  );
  refreshed += 1;
}
console.log(`stub-agent: ${refreshed} report page(s) refreshed`);
