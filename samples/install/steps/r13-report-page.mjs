// v0.2 R13: a report page, "Spending story", in "Pharos samples".
//
// A page an agent writes whole as HTML: its own look (receipt paper, ink and a marker), a claim
// with four live numbers from pharos.data, a what-if slider, a stacked bar chart drawn in SVG
// from the rows, a source and honesty note, and one uploaded asset (the receipt's torn edge, an
// SVG referred to relatively). Its data: made-up household spending for July–September 2026,
// kept as records of a "Household spending (made-up)" record type in the samples project (the
// money pack's records live in another project, and a page reads only its own project).
//
// Idempotent: the record type, the records, the page and its asset are each made only when
// missing; a page that is there is left as it is (the owner may have changed it).
import { StepError, viewNamed, warningsOf } from '../lib.mjs';

export const key = 'R13';
export const title = 'Report pages: a story written as HTML, with live numbers';

const VIEW = 'Spending story';
export const TYPE = 'household_spending';
export const VIEWS = [VIEW];

const RECORD_TYPE = {
  key: TYPE,
  name: 'Household spending (made-up)',
  plural: 'Household spending (made-up)',
  fields: [
    { key: 'date', label: 'Date', kind: 'date', required: true },
    { key: 'amount', label: 'Amount', kind: 'money', currency: 'EUR', required: true },
    { key: 'category', label: 'Category', kind: 'text' },
    { key: 'payee', label: 'Paid to', kind: 'text' },
  ],
};

// [date, category, cents, payee]: made-up, July to September 2026.
const SPENDING = [
  ['2026-07-01', 'Rent', 95000, 'Elm Street Lettings'],
  ['2026-07-01', 'Transport', 4900, 'City transit pass'],
  ['2026-07-04', 'Groceries', 6230, 'Corner Market'],
  ['2026-07-09', 'Eating out', 3200, 'Noodle Bar'],
  ['2026-07-12', 'Groceries', 5480, 'Corner Market'],
  ['2026-07-15', 'Utilities', 8800, 'Bright Power Co'],
  ['2026-07-19', 'Groceries', 7110, 'FreshWay'],
  ['2026-07-22', 'Eating out', 4550, 'Harbour Grill'],
  ['2026-07-27', 'Groceries', 4890, 'Corner Market'],
  ['2026-08-01', 'Rent', 95000, 'Elm Street Lettings'],
  ['2026-08-01', 'Transport', 4900, 'City transit pass'],
  ['2026-08-03', 'Groceries', 7020, 'FreshWay'],
  ['2026-08-08', 'Eating out', 2800, 'Noodle Bar'],
  ['2026-08-10', 'Groceries', 6640, 'Corner Market'],
  ['2026-08-15', 'Utilities', 9150, 'Bright Power Co'],
  ['2026-08-17', 'Groceries', 8150, 'FreshWay'],
  ['2026-08-23', 'Eating out', 3900, 'Harbour Grill'],
  ['2026-08-24', 'Groceries', 5930, 'Corner Market'],
  ['2026-08-30', 'Groceries', 4210, 'Night Shop'],
  ['2026-09-01', 'Rent', 95000, 'Elm Street Lettings'],
  ['2026-09-01', 'Transport', 4900, 'City transit pass'],
  ['2026-09-05', 'Groceries', 8340, 'FreshWay'],
  ['2026-09-11', 'Groceries', 7760, 'Corner Market'],
  ['2026-09-15', 'Utilities', 8400, 'Bright Power Co'],
  ['2026-09-18', 'Groceries', 9020, 'FreshWay'],
  ['2026-09-20', 'Eating out', 2600, 'Noodle Bar'],
  ['2026-09-25', 'Groceries', 6480, 'Corner Market'],
  ['2026-09-29', 'Groceries', 7110, 'FreshWay'],
];

/** The asset: a receipt's torn edge, tiled along the top and bottom of the paper. */
const EDGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="12" viewBox="0 0 24 12"><path d="M0 0h24v4l-6 8-6-8-6 8-6-8z" fill="#f7f1e6"/></svg>`;

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Spending story</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
  :root {
    --desk: #e9e2d4; --paper: #f7f1e6; --ink: #221d16; --ink-2: #5a5045; --rule: #d8cdb9;
    --marker: #ffe066; --marker-ink: #221d16;
    --c-groceries: #c2410c; --c-eating: #0d9488; --c-transport: #7c3aed; --c-utilities: #8a8178;
    --serif: 'Fraunces', Georgia, 'Times New Roman', serif;
    --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  [data-theme=dark] {
    --desk: #12100d; --paper: #1c1915; --ink: #f1e9dc; --ink-2: #b3a796; --rule: #3a332a;
    --marker: #8a6d00; --marker-ink: #fff7d6;
    --c-groceries: #ea580c; --c-eating: #0d9488; --c-transport: #8b5cf6; --c-utilities: #8a8178;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--desk); color: var(--ink); font: 17px/1.6 var(--serif); }
  .receipt { max-width: 760px; margin: 28px auto; padding: 0 16px; }
  .paper { background: var(--paper); padding: 36px clamp(18px, 5vw, 56px) 40px; position: relative; }
  .edge { height: 12px; background: url('img/receipt-edge.svg') repeat-x; }
  [data-theme=dark] .edge { filter: brightness(0.16) sepia(0.4); }
  .edge.bottom { transform: scaleY(-1); }
  .kicker { font: 600 12px/1 var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-2); }
  h1 { font-size: clamp(30px, 6vw, 46px); line-height: 1.08; margin: 14px 0 18px; font-weight: 700; }
  h2 { font-size: 24px; line-height: 1.2; margin: 40px 0 8px; }
  mark { background: linear-gradient(transparent 55%, var(--marker) 55%); color: inherit; padding: 0 2px; }
  .lede { color: var(--ink-2); margin: 0 0 24px; }
  .numbers { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0;
    border-top: 2px dashed var(--rule); border-bottom: 2px dashed var(--rule); margin: 8px 0 8px; }
  .number { padding: 16px 12px 14px 0; }
  .number b { display: block; font: 600 clamp(24px, 4.5vw, 30px)/1.1 var(--mono); }
  .number span { font: 13px/1.35 var(--mono); color: var(--ink-2); }
  .loading b { color: var(--ink-2); }
  figure { margin: 18px 0 0; }
  svg.chart { width: 100%; height: auto; display: block; overflow: visible; }
  .axis { font: 12px var(--mono); fill: var(--ink-2); }
  .grid { stroke: var(--rule); stroke-width: 1; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font: 13px var(--mono); color: var(--ink-2); margin: 10px 0 0; padding: 0; list-style: none; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
  figcaption { font: 13px/1.5 var(--mono); color: var(--ink-2); margin-top: 8px; }
  .whatif { border: 2px solid var(--ink); padding: 18px 18px 14px; margin-top: 14px; }
  .whatif label { font: 600 14px var(--mono); display: flex; justify-content: space-between; gap: 12px; }
  input[type=range] { width: 100%; height: 44px; accent-color: var(--c-groceries); }
  .saving { font: 600 clamp(22px, 4vw, 28px) var(--mono); }
  .honest { background: var(--marker); color: var(--marker-ink); padding: 16px 18px; margin-top: 36px; font-size: 16px; }
  .honest strong { font-family: var(--mono); font-size: 13px; letter-spacing: .1em; text-transform: uppercase; display: block; margin-bottom: 4px; }
  .source { font: 12px/1.6 var(--mono); color: var(--ink-2); margin-top: 22px; border-top: 2px dashed var(--rule); padding-top: 12px; }
  .tip { position: absolute; pointer-events: none; background: var(--ink); color: var(--paper); font: 12px/1.4 var(--mono); padding: 6px 8px; border-radius: 4px; opacity: 0; transition: opacity .1s; white-space: nowrap; }
  @media (max-width: 480px) { body { font-size: 16px; } .receipt { margin: 12px auto; } }
</style>
</head>
<body>
<div class="receipt">
  <div class="edge" aria-hidden="true"></div>
  <article class="paper">
    <div class="kicker">Household spending · July–September 2026 · made-up</div>
    <h1>Rent stayed put. <mark>Groceries climbed every month</mark>, and eating out shrank.</h1>
    <p class="lede">Three months of a made-up household's receipts, read live from the records in this project.</p>

    <section class="numbers loading" id="numbers" aria-live="polite">
      <div class="number"><b id="n-total">…</b><span>spent in the quarter</span></div>
      <div class="number"><b id="n-groc">…</b><span>groceries, July → September</span></div>
      <div class="number"><b id="n-share">…</b><span>of everything but rent went on groceries</span></div>
      <div class="number"><b id="n-count">…</b><span>receipts counted</span></div>
    </section>

    <h2>Everything but rent grew, and groceries did the growing</h2>
    <p>Rent is the same every month, so it is left out of the chart: it would flatten everything else. Each bar is one month of the rest, by category.</p>
    <figure>
      <svg class="chart" id="chart" viewBox="0 0 640 300" role="img" aria-labelledby="chart-title">
        <title id="chart-title">Spending by month and category, rent left out</title>
      </svg>
      <ul class="legend" id="legend"></ul>
      <figcaption id="caption">Hover or tap a bar segment for its amount.</figcaption>
    </figure>

    <h2>A tenth less on groceries would pay for a month of transport and then some</h2>
    <div class="whatif">
      <label for="cut"><span>What if groceries were lower by</span><span id="cut-out">10%</span></label>
      <input id="cut" type="range" min="0" max="40" step="5" value="10" aria-describedby="cut-result">
      <p id="cut-result" style="margin:6px 0 0">Over the quarter that is <span class="saving" id="saving">…</span>, <span id="saving-vs">…</span>.</p>
    </div>

    <div class="honest">
      <strong>What this doesn't say</strong>
      Card payments only: cash isn't recorded, so eating out may be undercounted. Three months is
      too short to call a trend; prices rose in the same months, so more spending need not mean
      more food. Categories are as entered on each receipt.
    </div>

    <p class="source">Source: the "Household spending (made-up)" records in the Pharos samples project, read live
      through pharos.data("spending"); every name and amount is fictional. Amounts in euros.</p>
  </article>
  <div class="edge bottom" aria-hidden="true"></div>
</div>
<div class="tip" id="tip" role="status"></div>
<script>
  const CATS = [
    { key: 'Groceries', color: 'var(--c-groceries)' },
    { key: 'Eating out', color: 'var(--c-eating)' },
    { key: 'Transport', color: 'var(--c-transport)' },
    { key: 'Utilities', color: 'var(--c-utilities)' },
  ];
  const euros = (cents, digits = 0) =>
    (cents / 100).toLocaleString('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: digits, minimumFractionDigits: digits });
  const monthName = (m) => new Date(m + '-15').toLocaleString('en', { month: 'short' });
  const $ = (id) => document.getElementById(id);
  let rows = [];

  function byMonth() {
    const months = {};
    for (const r of rows) {
      const f = r.data.fields || {};
      if (!f.date || !f.amount) continue;
      const m = String(f.date).slice(0, 7);
      const cat = f.category || 'Other';
      months[m] = months[m] || {};
      months[m][cat] = (months[m][cat] || 0) + f.amount.amount;
    }
    return Object.keys(months).sort().map((m) => ({ month: m, cats: months[m] }));
  }

  function render() {
    const months = byMonth();
    const total = rows.reduce((n, r) => n + ((r.data.fields.amount || {}).amount || 0), 0);
    const groc = (m) => (m && m.cats.Groceries) || 0;
    const first = months[0], last = months[months.length - 1];
    const change = first && groc(first) ? Math.round(((groc(last) - groc(first)) / groc(first)) * 100) : 0;
    const nonRent = rows.filter((r) => r.data.fields.category !== 'Rent');
    const nonRentTotal = nonRent.reduce((n, r) => n + r.data.fields.amount.amount, 0);
    const grocTotal = months.reduce((n, m) => n + groc(m), 0);
    $('numbers').classList.remove('loading');
    $('n-total').textContent = euros(total);
    $('n-groc').textContent = (change >= 0 ? '+' : '') + change + '%';
    $('n-share').textContent = nonRentTotal ? Math.round((grocTotal / nonRentTotal) * 100) + '%' : '–';
    $('n-count').textContent = String(rows.length);
    drawChart(months);
    whatIf(grocTotal, months);
  }

  function drawChart(months) {
    const svg = $('chart');
    const W = 640, H = 300, left = 56, bottom = 30, top = 12;
    const sums = months.map((m) => CATS.reduce((n, c) => n + (m.cats[c.key] || 0), 0));
    const max = Math.max(1, ...sums);
    const step = Math.pow(10, Math.floor(Math.log10(max / 100))) * 100;
    const nice = Math.ceil(max / (step * 2)) * step * 2;
    const y = (v) => H - bottom - (v / nice) * (H - bottom - top);
    const band = (W - left) / Math.max(1, months.length);
    const bw = Math.min(88, band * 0.5);
    const ns = 'http://www.w3.org/2000/svg';
    const el = (name, attrs, text) => {
      const e = document.createElementNS(ns, name);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      if (text !== undefined) e.textContent = text;
      return e;
    };
    svg.querySelectorAll('g').forEach((g) => g.remove());
    const g = el('g', {});
    for (let i = 0; i <= 4; i++) {
      const v = (nice / 4) * i;
      g.appendChild(el('line', { class: 'grid', x1: left, x2: W, y1: y(v), y2: y(v) }));
      g.appendChild(el('text', { class: 'axis', x: left - 8, y: y(v) + 4, 'text-anchor': 'end' }, euros(v)));
    }
    months.forEach((m, i) => {
      const x = left + band * i + (band - bw) / 2;
      let base = 0;
      const present = CATS.filter((c) => m.cats[c.key]);
      present.forEach((c, j) => {
        const v = m.cats[c.key];
        const y0 = y(base), y1 = y(base + v);
        const h = Math.max(0, y0 - y1 - 2);
        const topMost = j === present.length - 1;
        const r = el('path', {
          d: topMost
            ? 'M' + x + ',' + (y1 + h) + 'v' + -(h - 4) + 'q0,-4 4,-4h' + (bw - 8) + 'q4,0 4,4v' + (h - 4) + 'z'
            : 'M' + x + ',' + (y1 + h) + 'v' + -h + 'h' + bw + 'v' + h + 'z',
          fill: c.color,
          tabindex: 0,
          'aria-label': monthName(m.month) + ' ' + c.key + ': ' + euros(v),
        });
        r.addEventListener('pointerenter', (e) => tip(e, monthName(m.month) + ' · ' + c.key + ': ' + euros(v, 2)));
        r.addEventListener('focus', (e) => tip(e, monthName(m.month) + ' · ' + c.key + ': ' + euros(v, 2)));
        r.addEventListener('pointerleave', hideTip);
        r.addEventListener('blur', hideTip);
        g.appendChild(r);
        base += v;
      });
      g.appendChild(el('text', { class: 'axis', x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }, monthName(m.month)));
      g.appendChild(el('text', { class: 'axis', x: x + bw / 2, y: y(base) - 8, 'text-anchor': 'middle', style: 'fill: var(--ink)' }, euros(base)));
    });
    svg.appendChild(g);
    $('legend').innerHTML = CATS.map((c) => '<li><i style="background:' + c.color + '"></i>' + c.key + '</li>').join('');
  }

  function tip(e, text) {
    const t = $('tip');
    const box = e.target.getBoundingClientRect();
    t.textContent = text;
    t.style.left = Math.max(8, Math.min(window.innerWidth - 220, box.left + window.scrollX)) + 'px';
    t.style.top = box.top + window.scrollY - 34 + 'px';
    t.style.opacity = 1;
  }
  function hideTip() { $('tip').style.opacity = 0; }

  function whatIf(grocTotal, months) {
    const cut = Number($('cut').value);
    const saving = Math.round((grocTotal * cut) / 100);
    const transport = months.length
      ? months.reduce((n, m) => n + (m.cats.Transport || 0), 0) / months.length
      : 0;
    $('cut-out').textContent = cut + '%';
    $('saving').textContent = euros(saving);
    $('saving-vs').textContent = !saving
      ? 'nothing saved'
      : transport
        ? 'about ' + (saving / transport).toFixed(1) + ' months of transport passes'
        : 'saved';
  }

  $('cut').addEventListener('input', () => {
    const months = byMonth();
    whatIf(months.reduce((n, m) => n + (m.cats.Groceries || 0), 0), months);
  });

  async function load() {
    try {
      rows = await pharos.data('spending');
      render();
    } catch (error) {
      $('caption').textContent = String(error.message || error);
    }
  }
  load();
  pharos.onData(load);
  pharos.onTheme(() => render());
</script>
</body>
</html>`;

const SUMMARY =
  'Rent stayed the same each month while groceries rose every month from July to September, and eating out fell; a slider shows what a smaller grocery bill would save. Made-up data.';

/**
 * The record type and the made-up records, each only when missing (R13 and R14 read them).
 */
export async function ensureSpending({ call, projectId, log }) {
  const project = await call('get', { id: projectId });
  const types = project.data.recordTypes ?? [];
  if (!types.some((t) => t.key === TYPE)) {
    await call('apply', {
      message:
        'R13 sample: a record type for made-up household spending (the report page reads it)',
      operations: [
        {
          op: 'update',
          type: 'project',
          id: projectId,
          data: { recordTypes: [...types, RECORD_TYPE] },
        },
      ],
    });
    log(`Added the record type "${RECORD_TYPE.name}".`);
  }
  const existing = await call('list', { type: 'record', projectId, where: { recordType: TYPE } });
  if (!existing.length) {
    await call('apply', {
      message:
        'R13 sample: three months of made-up household spending for the "Spending story" report page',
      operations: SPENDING.map(([date, category, amount, payee]) => ({
        op: 'create',
        type: 'record',
        data: {
          projectId,
          recordType: TYPE,
          title: `${payee} (${category.toLowerCase()})`,
          fields: { date, amount: { amount, currency: 'EUR' }, category, payee },
        },
      })),
    });
    log(`Added ${SPENDING.length} made-up spending records.`);
  }
}

export async function run({ call, samples, log }) {
  const projectId = samples.id;
  const tools = (await call.tools()).map((t) => t.name);
  if (!tools.includes('report_asset_put'))
    throw new StepError('This Pharos has no report pages (R13): update it first. Nothing changed.');

  await ensureSpending({ call, projectId, log });

  // The page, then its asset.
  let view = await viewNamed(call, projectId, VIEW);
  let made = false;
  const page = {
    html: PAGE,
    summary: SUMMARY,
    data: { spending: { type: 'record', filter: { where: { recordType: TYPE } } } },
  };
  if (!view) {
    const draft = await call('view_preview', { projectId, page });
    const blocking = warningsOf(draft).filter((w) => !w.includes('img/receipt-edge.svg'));
    if (blocking.length || draft.findings?.length)
      throw new StepError(
        `view_preview warns for "${VIEW}", so it wasn't saved:\n- ${blocking.join('\n- ')}`,
      );
    const res = await call('view_create', {
      projectId,
      name: VIEW,
      description: 'R13 sample: a report page written as HTML, with live numbers',
      page,
      message:
        'R13 sample: a report page that tells the spending story with live numbers, a what-if slider and a chart',
    });
    view = res.view;
    made = true;
  }
  const assets = await call('report_asset_list', { viewId: view.id });
  if (!assets.some((a) => a.path === 'img/receipt-edge.svg')) {
    await call('report_asset_put', {
      viewId: view.id,
      path: 'img/receipt-edge.svg',
      base64: Buffer.from(EDGE_SVG).toString('base64'),
    });
    log('Uploaded the asset img/receipt-edge.svg.');
  }
  const after = await call('view_preview', { viewId: view.id });
  const warnings = warningsOf(after);
  if (made && warnings.length)
    throw new StepError(`Saved "${VIEW}", but its preview warns:\n- ${warnings.join('\n- ')}`);
  const reads = (after.reads ?? []).map((r) => `${r.name}: ${r.rows} rows`).join(', ');
  if (made) log(`Report page made (${reads}).`);
  return [{ project: samples.name, projectId, view: VIEW, viewId: view.id, made }];
}
