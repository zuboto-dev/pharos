import {
  REPORT_ASSET_TYPES,
  REPORT_LIMITS,
  ReportAssetPath,
  checkReadQueries,
  formatFinding,
  runQuery,
  type Author,
  type Entity,
  type QueryFinding,
  type ReportPage,
} from '@pharos/schema';
import { AgentFiles } from '../store/agent-files.js';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { openBlockRequests } from './block-ask.js';
import type { WidgetPreview } from './preview.js';

/**
 * Report pages (R13): the page an agent wrote as HTML, the files it ships (report assets) and
 * the checks an agent sees before the reader does. docs/reframe/r13-report-pages.md has the
 * contract; serving is in report-routes.ts.
 */

/** A Host header Pharos answers on: 127.0.0.1, localhost or [::1], with an optional port. */
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i;
const VIEW_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The page's own files as a CSP source (R13.6): `http://<host>/api/views/<id>/page/`, a path
 * prefix, so a page loads its own assets and never another view's (which `'self'`, the whole
 * origin, allowed). Null when the Host or the id isn't one Pharos would serve: then the page
 * loads no files of its own rather than trusting a host it was given.
 */
export function pageSource(host: string | undefined, viewId: string | undefined): string | null {
  if (!host || !viewId || !LOCAL_HOST.test(host) || !VIEW_ID.test(viewId)) return null;
  return `http://${host.toLowerCase()}/api/views/${viewId}/page/`;
}

/**
 * The Content-Security-Policy of a report page and its files: no popups, no network; scripts and
 * styles from its own files (`own`, from pageSource) and three CDNs, Google Fonts; framed only by
 * Pharos itself.
 */
export function reportCsp(own: string | null): string {
  const self = own ? `${own} ` : '';
  return [
    'sandbox allow-scripts allow-modals',
    "default-src 'none'",
    `script-src ${self}'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com`,
    `style-src ${self}'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${self}data: https://fonts.gstatic.com`,
    `img-src ${self}data: blob:`,
    `media-src ${self}data: blob:`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** External hosts the page may load from, by what loads them. */
const ALLOWED_HOSTS: Record<'script' | 'style' | 'font', string[]> = {
  script: ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'unpkg.com'],
  style: ['fonts.googleapis.com'],
  font: ['fonts.gstatic.com'],
};

export type AssetInfo = { path: string; mime: string; size: number; updatedAt: string };

/** The page of a view, or null for a board. */
export function pageOf(view: Entity<'view'>): ReportPage | null {
  return view.data.page ?? null;
}

/** An asset path checked against the contract: relative, no "..", a known file type. */
export function assetPath(path: string): string {
  const parsed = ReportAssetPath.safeParse(path);
  if (!parsed.success)
    throw new PharosError(
      'invalid',
      `Asset path "${path.slice(0, 200)}" isn't allowed: use a relative path such as "images/chart.png" (letters, digits, . _ - /, no "..") ending in ${Object.keys(REPORT_ASSET_TYPES).join(', ')}`,
    );
  return parsed.data;
}

export function assetMime(path: string): string {
  return REPORT_ASSET_TYPES[(path.split('.').pop() ?? '').toLowerCase()]!;
}

const megabytes = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

/** How long a deleted view's assets are kept, so undoing the delete restores the whole page. */
export const REPORT_ASSETS_KEEP_DAYS = 30;

/**
 * Purges long-gone views' assets now and then once a day (the HTTP server calls it at start).
 * Errors are logged, never thrown: background work must not stop the server. Returns a stop.
 */
export function scheduleAssetPurge(store: Store, everyMs = 24 * 60 * 60 * 1000): () => void {
  const assets = new ReportAssets(store);
  const run = () => {
    try {
      const removed = assets.purgeGone();
      if (removed)
        console.log(`[pharos] Removed ${removed} asset(s) of report pages deleted 30+ days ago`);
    } catch (error) {
      console.error('[pharos] Report asset purge failed:', error);
    }
  };
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

/** Report assets: a view's page files, kept beside revisions (never project data). */
export class ReportAssets {
  constructor(private readonly store: Store) {}

  list(viewId: string): AssetInfo[] {
    return (
      this.store.database
        .prepare(
          'SELECT path, mime, size, updated_at FROM report_assets WHERE view_id = ? ORDER BY path',
        )
        .all(viewId) as { path: string; mime: string; size: number; updated_at: string }[]
    ).map((r) => ({ path: r.path, mime: r.mime, size: r.size, updatedAt: r.updated_at }));
  }

  get(viewId: string, path: string): { mime: string; bytes: Uint8Array } | null {
    const row = this.store.database
      .prepare('SELECT mime, bytes FROM report_assets WHERE view_id = ? AND path = ?')
      .get(viewId, path) as { mime: string; bytes: Uint8Array } | undefined;
    return row ?? null;
  }

  delete(viewId: string, path: string): boolean {
    return (
      Number(
        this.store.database
          .prepare('DELETE FROM report_assets WHERE view_id = ? AND path = ?')
          .run(viewId, path).changes,
      ) > 0
    );
  }

  /**
   * Removes the assets of views that have been gone (deleted, or their project deleted) for
   * `keepDays` or more, by the time of the last revision that touched the view. Assets outlive a
   * delete so that undoing it brings the whole page back. Returns how many assets went.
   */
  purgeGone(now: number = Date.now(), keepDays = REPORT_ASSETS_KEEP_DAYS): number {
    const cutoff = new Date(now - keepDays * 24 * 60 * 60 * 1000).toISOString();
    return Number(
      this.store.database
        .prepare(
          `DELETE FROM report_assets WHERE view_id IN (
             SELECT a.view_id FROM (SELECT DISTINCT view_id FROM report_assets) a
             WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = a.view_id)
               AND COALESCE((SELECT MAX(r.created_at) FROM changes c
                   JOIN revisions r ON r.id = c.revision_id WHERE c.entity_id = a.view_id), '') < ?
           )`,
        )
        .run(cutoff).changes,
    );
  }

  /**
   * Saves (or replaces) one asset of a report page. Who may: anyone who may change the view, and
   * only on a view that is a report page.
   */
  put(author: Author, viewId: string, rawPath: string, bytes: Uint8Array): AssetInfo {
    const view = reportView(this.store, viewId, author);
    const path = assetPath(rawPath);
    if (!bytes.byteLength) throw new PharosError('invalid', `Asset "${path}" is empty`);
    if (bytes.byteLength > REPORT_LIMITS.assetBytes)
      throw new PharosError(
        'invalid',
        `Asset "${path}" is ${megabytes(bytes.byteLength)}; one asset may be at most ${megabytes(REPORT_LIMITS.assetBytes)}`,
      );
    const db = this.store.database;
    const { total } = db
      .prepare(
        'SELECT COALESCE(SUM(size), 0) AS total FROM report_assets WHERE view_id = ? AND path <> ?',
      )
      .get(view.id, path) as { total: number };
    if (total + bytes.byteLength > REPORT_LIMITS.viewAssetBytes)
      throw new PharosError(
        'invalid',
        `The page's assets would come to ${megabytes(total + bytes.byteLength)}; a page may ship at most ${megabytes(REPORT_LIMITS.viewAssetBytes)}`,
      );
    const mime = assetMime(path);
    const updatedAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO report_assets (view_id, path, mime, bytes, size, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (view_id, path) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes,
         size = excluded.size, updated_at = excluded.updated_at`,
    ).run(view.id, path, mime, bytes, bytes.byteLength, updatedAt);
    return { path, mime, size: bytes.byteLength, updatedAt };
  }
}

/**
 * The view an asset is for: it must be a report page in an existing project. An agent follows
 * the view tools' rules: while a person waits for a change to one block of it, nothing else
 * changes (pages have no blocks, so that only holds for a view that was a board).
 */
export function reportView(store: Store, viewId: string, author?: Author): Entity<'view'> {
  const found = store.get(viewId);
  if (found?.type !== 'view') throw new PharosError('not_found', `view ${viewId} not found`);
  const view = found as Entity<'view'>;
  if (!pageOf(view))
    throw new PharosError(
      'invalid',
      `View "${view.data.name}" is a board, not a report page: assets belong to report pages (view_create or view_update with page)`,
    );
  store.getOfType('project', view.data.projectId);
  if (author?.kind === 'agent' && openBlockRequests(store, view).length)
    throw new PharosError(
      'invalid',
      `View "${view.data.name}" has an open request to change one block; answer or dismiss it first`,
    );
  return view;
}

/** Strict base64 (a data: URL prefix and white space are fine), as bytes. */
export function decodeBase64(text: string): Uint8Array {
  const body = text.replace(/^data:[^,]*;base64,/i, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body) || body.length % 4 === 1)
    throw new PharosError('invalid', 'base64 is not valid base64');
  return new Uint8Array(Buffer.from(body, 'base64'));
}

// ---------------------------------------------------------------- what the HTML refers to

type Tag = { name: string; attrs: Map<string, string> };

/**
 * The page's markup as the browser would load from it: start tags with their attributes, inline
 * styles and <style> blocks. Script text, comments and plain text are skipped, so a string in a
 * script (`{"src":"x"}`, `s.replace(/url(/)`) is never taken for a file the page loads.
 */
export function pageMarkup(html: string): { tags: Tag[]; css: string[] } {
  const tags: Tag[] = [];
  const css: string[] = [];
  const re =
    /<!--[\s\S]*?(?:-->|$)|<(script|style|textarea|title)\b((?:"[^"]*"|'[^']*'|[^'">])*)>([\s\S]*?)(?:<\/\1\s*>|$)|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const m of html.matchAll(re)) {
    if (m[1]) {
      const name = m[1].toLowerCase();
      tags.push({ name, attrs: attributes(m[2] ?? '') });
      if (name === 'style') css.push(m[3] ?? '');
    } else if (m[4]) tags.push({ name: m[4].toLowerCase(), attrs: attributes(m[5] ?? '') });
  }
  for (const tag of tags) {
    const style = tag.attrs.get('style');
    if (style) css.push(style);
  }
  return { tags, css };
}

function attributes(text: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of text.matchAll(
    /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const name = m[1]!.toLowerCase();
    if (!attrs.has(name)) attrs.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|quot|apos|#39|lt|gt);/g, (_, e: string) =>
    e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'lt' ? '<' : e === 'gt' ? '>' : "'",
  );
}

/** URLs a stylesheet loads: url(…) and @import "…". */
function cssUrls(css: string): string[] {
  const urls: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi))
    urls.push(m[1] ?? m[2] ?? m[3] ?? '');
  for (const m of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi))
    urls.push(m[1] ?? m[2] ?? '');
  return urls;
}

/** <link rel> values that make the browser load the href. */
const LOADING_LINKS = /\b(?:stylesheet|icon|preload|modulepreload|apple-touch-icon|manifest)\b/i;

/**
 * Every URL the page's markup loads, with what loads it: src (any element), data (<object>),
 * poster, srcset (img and source), href of a <link> that loads (stylesheet, icon, preload; never
 * <a>), and url()/@import in <style> blocks and style attributes.
 */
function loadedUrls(html: string): { url: string; tag: Tag | null }[] {
  const { tags, css } = pageMarkup(html);
  const out: { url: string; tag: Tag | null }[] = [];
  for (const tag of tags) {
    const add = (url: string | undefined) => {
      if (url !== undefined) out.push({ url, tag });
    };
    add(tag.attrs.get('src'));
    add(tag.attrs.get('poster'));
    if (tag.name === 'object') add(tag.attrs.get('data'));
    if (tag.name === 'link' && LOADING_LINKS.test(tag.attrs.get('rel') ?? ''))
      add(tag.attrs.get('href'));
    const srcset = tag.attrs.get('srcset');
    if (srcset) for (const part of srcset.split(',')) add(part.trim().split(/\s+/)[0]);
  }
  for (const block of css) for (const url of cssUrls(block)) out.push({ url, tag: null });
  return out;
}

/** Relative URLs the page's markup loads (never text in its scripts), as asset paths. */
export function referencedPaths(html: string): string[] {
  const paths = new Set<string>();
  for (const { url: raw } of loadedUrls(html)) {
    const url = raw.trim();
    if (!url || url.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//'))
      continue;
    if (url.includes('${') || url.includes('{{')) continue; // a template, not a file
    const path = url.split(/[?#]/)[0]!.replace(/^\.\//, '');
    if (path) paths.add(decodeOrKeep(path));
  }
  return [...paths];
}

function decodeOrKeep(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** External addresses the page loads that the frame's CSP will block, one line each. */
export function blockedExternals(html: string): string[] {
  const out = new Set<string>();
  const check = (url: string, kind: keyof typeof ALLOWED_HOSTS | 'other', what: string) => {
    let host: string;
    try {
      const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
      host = parsed.hostname;
      if (kind !== 'other' && parsed.protocol === 'https:' && ALLOWED_HOSTS[kind].includes(host))
        return;
    } catch {
      return;
    }
    out.add(`${what} ${url.slice(0, 120)} (${host}) will be blocked`);
  };
  const external = /^(?:https?:)?\/\//i;
  for (const { url: raw, tag } of loadedUrls(html)) {
    const url = raw.trim();
    if (!external.test(url)) continue;
    if (!tag) {
      const font = /\.(woff2?|ttf|otf)(?:[?#]|$)/i.test(url);
      // An @import or a url() of a .css file is a stylesheet.
      if (/\.css(?:[?#]|$)/i.test(url) || /fonts\.googleapis\.com/i.test(url))
        check(url, 'style', 'Stylesheet');
      else check(url, font ? 'font' : 'other', font ? 'Font' : 'Picture');
    } else if (tag.name === 'script') check(url, 'script', 'Script');
    else if (tag.name === 'link') {
      const rel = tag.attrs.get('rel')?.toLowerCase() ?? '';
      if (rel.includes('stylesheet')) check(url, 'style', 'Stylesheet');
      else if (rel.includes('preload') && tag.attrs.get('as')?.toLowerCase() === 'font')
        check(url, 'font', 'Font');
      else if (rel.includes('preload') && tag.attrs.get('as')?.toLowerCase() === 'script')
        check(url, 'script', 'Script');
      else if (rel.includes('preload') && tag.attrs.get('as')?.toLowerCase() === 'style')
        check(url, 'style', 'Stylesheet');
      else check(url, 'other', 'Picture or media');
    } else check(url, 'other', tag.name === 'iframe' ? 'Frame' : 'Picture or media');
  }
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource\s*\(/.test(html))
    out.add(
      'The page calls fetch/XMLHttpRequest/WebSocket: the frame allows no network; use pharos.data for project data and ship files as assets',
    );
  return [...out];
}

/** The page's script text: inline <script> blocks and on… attributes (onclick="…"). */
function scriptText(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)(?:<\/script\s*>|$)/gi))
    out.push(m[1] ?? '');
  for (const tag of pageMarkup(html).tags)
    for (const [name, value] of tag.attrs) if (name.startsWith('on')) out.push(value);
  return out;
}

const SETS_LOCATION =
  /(?:^|[^\w$.])(?:(?:window|self|top|parent|document|globalThis)\s*\.\s*)?location\s*(?:\.\s*href\s*)?=(?!=)|\blocation\s*\.\s*(?:assign|replace)\s*\(/;
const OPENS_WINDOW = /\b(?:window|self|top|globalThis)\s*\.\s*open\s*\(/;

/**
 * Ways a page tries to leave its frame (R13.6): setting location, window.open, a meta refresh.
 * Pharos refuses them and stops the page; links and pharos.openLink are the way.
 */
export function navigationWarnings(html: string): string[] {
  const scripts = scriptText(html);
  const out: string[] = [];
  const instead =
    'use plain links (<a href="https://…">), which open through Pharos in a new tab, or pharos.openLink(url)';
  if (scripts.some((s) => SETS_LOCATION.test(s)))
    out.push(
      `The page sets location (location.href, assign or replace): a report page never navigates itself; Pharos refuses it and stops the page. To send the reader somewhere, ${instead}`,
    );
  if (scripts.some((s) => OPENS_WINDOW.test(s)))
    out.push(`The page calls window.open: the frame can't open windows; ${instead}`);
  const refresh = pageMarkup(html).tags.some(
    (t) =>
      t.name === 'meta' && (t.attrs.get('http-equiv') ?? '').trim().toLowerCase() === 'refresh',
  );
  if (refresh)
    out.push(
      `The page has <meta http-equiv="refresh">: a report page never reloads or leaves by itself; remove it (data updates arrive through pharos.onData)`,
    );
  return out;
}

// ---------------------------------------------------------------- preview

/** Query findings of a page's named reads, as lines naming the read. */
export function pageReadFindings(
  page: ReportPage,
  project: Entity<'project'> | null,
): QueryFinding[] {
  return checkReadQueries(page.data, project);
}

export function formatReadFinding(f: QueryFinding): string {
  return formatFinding(f).replace(`(widget "${f.widget}")`, `(read "${f.widget}")`);
}

/**
 * What an agent should check on a page before the reader sees it: its size, what each named
 * read returns now (and query findings), assets the HTML refers to that aren't there, and
 * external hosts the frame will block. Warnings only: the save already refused what can't work.
 */
export function previewPage(store: Store, projectId: string, page: ReportPage, viewId?: string) {
  const data = new AgentFiles(store).dataset(store.dataset(projectId));
  const findings = pageReadFindings(page, data.project);
  const reads = Object.entries(page.data ?? {}).map(([name, read]) => {
    const own = findings.filter((f) => f.widget === name);
    let rows: number | undefined;
    try {
      rows = runQuery(data, read.type, read.filter ?? {}).length;
    } catch {
      rows = undefined;
    }
    return {
      name,
      type: read.type,
      ...(rows !== undefined ? { rows } : {}),
      ...(rows === 0 ? { empty: true } : {}),
      warnings: own.map(formatReadFinding),
    };
  });
  const assets = viewId ? new ReportAssets(store).list(viewId) : [];
  const have = new Set(assets.map((a) => a.path));
  const missing = referencedPaths(page.html).filter((p) => !have.has(p));
  const warnings: string[] = [];
  for (const path of missing) {
    const ok = ReportAssetPath.safeParse(path).success;
    warnings.push(
      ok
        ? `The page refers to "${path}", which isn't an asset of this page yet: upload it with report_asset_put${viewId ? '' : ' after saving'}`
        : `The page refers to "${path}", which can't be an asset (relative path, no "..", file types ${Object.keys(REPORT_ASSET_TYPES).join(' ')}): it won't load`,
    );
  }
  warnings.push(...blockedExternals(page.html));
  warnings.push(...navigationWarnings(page.html));
  const used = new Set<string>();
  for (const m of page.html.matchAll(/pharos\.data\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) used.add(m[1]!);
  for (const name of used)
    if (!page.data?.[name])
      warnings.push(
        `The page asks pharos.data("${name}"), which isn't one of its named reads (page.data)`,
      );
  for (const name of Object.keys(page.data ?? {}))
    if (!used.has(name) && !page.html.includes(name))
      warnings.push(`The named read "${name}" isn't used by the page`);
  if (!/data-theme|prefers-color-scheme/.test(page.html))
    warnings.push(
      'No dark colours: define colour tokens on :root and a dark set under [data-theme=dark] (report_guide)',
    );
  const all = [
    ...(page.summary
      ? []
      : ['No summary: add one or two sentences saying what the page says (shown in lists)']),
    ...warnings,
  ];
  const bytes = assets.reduce((n, a) => n + a.size, 0);
  const empty = reads.filter((r) => r.empty).map((r) => r.name);
  const rejects = findings.filter((f) => f.level === 'reject').length;
  return {
    kind: 'report page' as const,
    /** A page has no blocks; kept so a page preview reads like a board's. */
    widgets: [] as WidgetPreview[],
    layout: [] as string[],
    warnings: all,
    findings,
    size: { htmlChars: page.html.length, limit: REPORT_LIMITS.htmlChars },
    reads,
    assets: { count: assets.length, bytes },
    summary:
      `report page, ${page.html.length.toLocaleString('en')} characters, ${reads.length} named read${reads.length === 1 ? '' : 's'}` +
      (empty.length ? ` (${empty.join(', ')} empty now)` : '') +
      `, ${assets.length} asset${assets.length === 1 ? '' : 's'}` +
      (rejects
        ? `; ${rejects} query problem${rejects === 1 ? '' : 's'} would refuse the save`
        : '') +
      (all.length || reads.some((r) => r.warnings.length) ? '; see warnings' : ''),
  };
}
