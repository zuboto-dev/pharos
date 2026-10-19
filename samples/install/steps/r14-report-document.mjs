// R14: a report document, "Spending story (document)", in "Pharos samples".
//
// The same story as the R13 page, written as a document Pharos draws itself: prose with live
// numbers (Text values), a row of Stats in columns, two charts, a table of the biggest shops, an
// honesty Callout, one small drawing (every receipt as a tick on a July–September strip, an SVG
// made from pharos.data rows) and one embed of a harmless placeholder site (example.com). Its data
// is the made-up household spending the R13 step keeps (ensureSpending makes it when missing).
//
// Idempotent: the document is made only when missing; one that is there is left as it is (the
// owner may have changed it).
import { StepError, viewNamed, warningsOf } from '../lib.mjs';
import { TYPE, ensureSpending } from './r13-report-page.mjs';

export const key = 'R14';
export const title = 'Report documents: a report Pharos draws itself, with live numbers';

const VIEW = 'Spending story (document)';
export const VIEWS = [VIEW];

const spending = (where = {}) => ({ type: 'record', where: { recordType: TYPE, ...where } });
const month = (m) => ({
  'fields.date': { gte: `2026-${m}-01`, lt: `2026-${String(Number(m) + 1).padStart(2, '0')}-01` },
});
const sum = (where) => ({ sum: { query: spending(where), field: 'fields.amount' } });
const NOT_RENT = { 'fields.category': { not: 'Rent' } };

/** One small visual no component draws: every receipt as a tick on the quarter, by category. */
const DRAWING = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  :root { --ink: #221d16; --muted: #6b6257; --rule: #d8cdb9;
    --Groceries: #c2410c; --Eating-out: #0d9488; --Transport: #7c3aed; --Utilities: #8a8178; }
  [data-theme=dark] { --ink: #f1e9dc; --muted: #b3a796; --rule: #3a332a;
    --Groceries: #fb923c; --Eating-out: #2dd4bf; --Transport: #a78bfa; --Utilities: #a8a29e; }
  html, body { margin: 0; background: transparent; color: var(--ink);
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .axis { fill: var(--muted); }
  .base { stroke: var(--rule); stroke-width: 1; }
  .keys { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 0 0; padding: 0; list-style: none; color: var(--muted); }
  .keys i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; }
</style>
</head>
<body>
<svg id="strip" viewBox="0 0 640 150" role="img" aria-label="Every receipt from July to September as a tick; taller ticks cost more">
</svg>
<ul class="keys" id="keys"></ul>
<script>
  const NS = 'http://www.w3.org/2000/svg';
  const CATS = ['Groceries', 'Eating out', 'Transport', 'Utilities'];
  const color = (c) => 'var(--' + c.replace(' ', '-') + ')';
  const start = Date.UTC(2026, 6, 1), end = Date.UTC(2026, 9, 1);
  const el = (name, attrs, text) => {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function draw(rows) {
    const svg = document.getElementById('strip');
    svg.replaceChildren();
    const left = 8, right = 632, base = 120;
    const x = (iso) => left + ((Date.parse(iso + 'T00:00:00Z') - start) / (end - start)) * (right - left);
    const receipts = rows
      .map((r) => r.data.fields || {})
      .filter((f) => f.date && f.amount && f.category !== 'Rent');
    const max = Math.max(1, ...receipts.map((f) => f.amount.amount));
    svg.appendChild(el('line', { class: 'base', x1: left, x2: right, y1: base, y2: base }));
    for (const [m, label] of [['2026-07-01', 'Jul'], ['2026-08-01', 'Aug'], ['2026-09-01', 'Sep']]) {
      svg.appendChild(el('line', { class: 'base', x1: x(m), x2: x(m), y1: base, y2: base + 6 }));
      svg.appendChild(el('text', { class: 'axis', x: x(m) + 4, y: base + 22 }, label));
    }
    for (const f of receipts) {
      const h = 8 + (f.amount.amount / max) * 96;
      const t = el('rect', { x: x(f.date) - 2, y: base - h, width: 4, height: h, rx: 2, fill: color(f.category) });
      t.appendChild(el('title', {}, f.date + ' · ' + f.category + ' · €' + (f.amount.amount / 100).toFixed(2)));
      svg.appendChild(t);
    }
    document.getElementById('keys').innerHTML = CATS.map(
      (c) => '<li><i style="background:' + color(c) + '"></i>' + c + '</li>',
    ).join('');
  }
  const load = () => pharos.data('spending').then(draw, () => {});
  load();
  pharos.onData(load);
</script>
</body>
</html>`;

export const DOC = {
  summary:
    'Rent stayed the same each month while groceries rose every month from July to September and eating out fell. Made-up data.',
  data: { spending: { type: 'record', filter: { where: { recordType: TYPE } } } },
  blocks: [
    {
      kind: 'block',
      id: 'lead',
      node: {
        component: 'Text',
        content: [
          '# Rent stayed put. Groceries climbed every month.',
          '',
          'From July to September this made-up household paid **${total}** across ${receipts} card receipts. Rent took ${rent} of it, the same every month, so the story is in the rest: **${rest}**, and groceries were the biggest and fastest-growing part of it.',
        ].join('\n'),
        values: {
          total: sum(),
          receipts: { count: spending() },
          rent: sum({ 'fields.category': 'Rent' }),
          rest: sum(NOT_RENT),
        },
      },
    },
    {
      kind: 'columns',
      id: 'numbers',
      width: 'wide',
      columns: [
        [
          {
            kind: 'block',
            id: 'n-groceries',
            node: {
              component: 'Stat',
              label: 'Groceries',
              query: spending({ 'fields.category': 'Groceries' }),
              sum: 'fields.amount',
              caption: 'in the quarter',
            },
          },
        ],
        [
          {
            kind: 'block',
            id: 'n-eating',
            node: {
              component: 'Stat',
              label: 'Eating out',
              query: spending({ 'fields.category': 'Eating out' }),
              sum: 'fields.amount',
              caption: 'fell each month',
            },
          },
        ],
        [
          {
            kind: 'block',
            id: 'n-bills',
            node: {
              component: 'Stat',
              label: 'Bills and transport',
              query: spending({ 'fields.category': ['Utilities', 'Transport'] }),
              sum: 'fields.amount',
              caption: 'steady',
            },
          },
        ],
      ],
    },
    {
      kind: 'block',
      id: 'climb',
      node: {
        component: 'Text',
        content: [
          '## The grocery bill rose by more than half',
          '',
          'The grocery bill was ${julG} in July, ${augG} in August and ${sepG} in September. Eating out went the other way, from ${julE} to ${sepE}: some meals out became meals at home, but not enough to explain the whole rise.',
        ].join('\n'),
        values: {
          julG: sum({ 'fields.category': 'Groceries', ...month('07') }),
          augG: sum({ 'fields.category': 'Groceries', ...month('08') }),
          sepG: sum({ 'fields.category': 'Groceries', ...month('09') }),
          julE: sum({ 'fields.category': 'Eating out', ...month('07') }),
          sepE: sum({ 'fields.category': 'Eating out', ...month('09') }),
        },
      },
    },
    {
      kind: 'columns',
      id: 'charts',
      width: 'wide',
      widths: [3, 2],
      columns: [
        [
          {
            kind: 'block',
            id: 'by-month',
            node: {
              component: 'CountChart',
              title: 'Everything but rent, by month',
              query: spending(NOT_RENT),
              by: 'fields.date',
              bucket: 'month',
              sum: 'fields.amount',
            },
          },
        ],
        [
          {
            kind: 'block',
            id: 'by-category',
            node: {
              component: 'CountChart',
              title: 'By category',
              query: spending(NOT_RENT),
              by: 'fields.category',
              sort: 'count',
              sum: 'fields.amount',
            },
          },
        ],
      ],
    },
    {
      kind: 'drawing',
      id: 'receipts',
      width: 'wide',
      reads: ['spending'],
      height: 200,
      caption: 'Every receipt but rent, by day: the taller the tick, the bigger the bill.',
      html: DRAWING,
    },
    {
      kind: 'block',
      id: 'shops',
      node: {
        component: 'Text',
        content:
          '## Most big shops are at FreshWay\n\nFour of the five biggest grocery receipts are weekly shops at one supermarket:',
      },
    },
    {
      kind: 'block',
      id: 'biggest',
      node: {
        component: 'DataTable',
        query: {
          ...spending({ 'fields.category': 'Groceries' }),
          sort: [{ field: 'fields.amount', dir: 'desc' }],
          limit: 5,
        },
        columns: [
          { field: 'fields.date', label: 'Date' },
          { field: 'fields.payee', label: 'Shop' },
          { field: 'fields.amount', label: 'Amount' },
        ],
      },
    },
    {
      kind: 'block',
      id: 'honest',
      node: {
        component: 'Callout',
        tone: 'info',
        body: "**What this doesn't say.** Card payments only: cash isn't recorded, so eating out may be undercounted. Three months is too short to call a trend, and prices rose over the same months, so a bigger bill need not mean more food. Categories are as entered on each receipt.",
      },
    },
    {
      kind: 'embed',
      id: 'reference',
      url: 'https://example.com/',
      height: 240,
      caption: 'Where a price index would go: a placeholder page (example.com)',
    },
    {
      kind: 'block',
      id: 'source',
      node: {
        component: 'Markdown',
        content:
          'Source: the "Household spending (made-up)" records in this project, read live. Every name and amount is fictional; amounts in euros.',
      },
    },
  ],
};

export async function run({ call, samples, log }) {
  const projectId = samples.id;
  const create = (await call.tools()).find((t) => t.name === 'view_create');
  if (!create?.inputSchema?.properties?.doc)
    throw new StepError(
      'This Pharos has no report documents (R14): update it first. Nothing changed.',
    );
  await ensureSpending({ call, projectId, log });

  let view = await viewNamed(call, projectId, VIEW);
  let made = false;
  if (!view) {
    const draft = await call('view_preview', { projectId, doc: DOC });
    const warnings = warningsOf(draft);
    if (warnings.length || draft.findings?.length)
      throw new StepError(
        `view_preview warns for "${VIEW}", so it wasn't saved:\n- ${warnings.join('\n- ')}`,
      );
    const res = await call('view_create', {
      projectId,
      name: VIEW,
      description: 'R14 sample: a report document Pharos draws itself, with live numbers',
      doc: DOC,
      message:
        'R14 sample: the spending story as a report document: live numbers in prose, stats, charts, a drawing and an honesty note',
    });
    view = res.view;
    made = true;
    const after = warningsOf(res.preview);
    if (after.length)
      throw new StepError(`Saved "${VIEW}", but its preview warns:\n- ${after.join('\n- ')}`);
    log(`Report document made (${res.preview.summary}).`);
  }
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made }];
}
