/**
 * Repository file links: a file of the project's code repository named in any Markdown Pharos
 * renders (task and decision descriptions, Text blocks, notes), opened in a viewer on click.
 *
 *   [FORMAL_MODEL.md](repo:docs/research/FORMAL_MODEL.md@review/formal-model#L10-L40)
 *
 * `repo:<path>[@<ref>][#L<from>[-L<to>]]`. The path is relative to the repository of the item's
 * project (project.repositoryId → repository.path); the ref is a branch, tag or commit (none: the
 * working tree). The web app also links, conservatively, a relative path written as plain text or
 * inline code when it exists in that repository (`findRepoPaths`, then a check with the server).
 *
 * Owner only: the routes refuse agents (an agent reads the code in its own checkout); they carry
 * a path relative to the repository and are checked by the server (no "..", no dotfiles or
 * secrets, no link leaving the repository).
 */

export const REPO_SCHEME = 'repo:';

/** At most this much of a text file is sent; the viewer says the rest was left out. */
export const REPO_FILE_MAX_BYTES = 400 * 1024;
/** Pictures up to this size are sent whole (as data for an <img>); bigger ones aren't shown. */
export const REPO_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/**
 * Videos and sounds up to this size are served (as bytes, with byte ranges so the player can
 * seek); bigger ones aren't shown.
 */
export const REPO_MEDIA_MAX_BYTES = 200 * 1024 * 1024;
/** Paths checked in one `repoPaths` request. */
export const REPO_PATHS_MAX = 50;

/** `FILE_ROUTES.repoFile` for one file (owner only). */
export function repoFileUrl(projectId: string, path: string, ref?: string): string {
  const q = [
    `path=${encodeURIComponent(path)}`,
    ...(ref ? [`ref=${encodeURIComponent(ref)}`] : []),
  ];
  return `/api/projects/${encodeURIComponent(projectId)}/repo-file?${q.join('&')}`;
}

/**
 * A picture, video or sound of the repository as its bytes (`GET /api/projects/:id/repo-media`,
 * owner only), for an `<img>`, `<video>` or `<audio>`; answers byte ranges.
 */
export function repoMediaUrl(projectId: string, path: string, ref?: string): string {
  const q = [
    `path=${encodeURIComponent(path)}`,
    ...(ref ? [`ref=${encodeURIComponent(ref)}`] : []),
  ];
  return `/api/projects/${encodeURIComponent(projectId)}/repo-media?${q.join('&')}`;
}

export type RepoMediaKind = 'image' | 'video' | 'audio';

/** The pictures, videos and sounds the repository viewer shows, by extension. */
export const REPO_MEDIA_TYPES: Readonly<Record<string, { kind: RepoMediaKind; mime: string }>> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  avif: { kind: 'image', mime: 'image/avif' },
  svg: { kind: 'image', mime: 'image/svg+xml' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  m4v: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  mov: { kind: 'video', mime: 'video/quicktime' },
  mp3: { kind: 'audio', mime: 'audio/mpeg' },
  m4a: { kind: 'audio', mime: 'audio/mp4' },
  wav: { kind: 'audio', mime: 'audio/wav' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
  flac: { kind: 'audio', mime: 'audio/flac' },
};

/** Whether a path names a picture, video or sound (by its extension), or null. */
export function repoMediaKind(path: string): RepoMediaKind | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return REPO_MEDIA_TYPES[name.slice(dot + 1).toLowerCase()]?.kind ?? null;
}

/** `FILE_ROUTES.repoPaths` for a list of paths (owner only). */
export function repoPathsUrl(projectId: string, paths: readonly string[], ref?: string): string {
  const q = paths.map((p) => `path=${encodeURIComponent(p)}`);
  if (ref) q.push(`ref=${encodeURIComponent(ref)}`);
  return `/api/projects/${encodeURIComponent(projectId)}/repo-paths?${q.join('&')}`;
}

export type RepoLines = { from: number; to: number };
export type RepoLink = { path: string; ref?: string; lines?: RepoLines };

export type RepoFileKind = 'markdown' | 'code' | 'text' | 'image' | 'video' | 'audio' | 'binary';

/** `GET /api/projects/:id/repo-file`. */
export type RepoFile = {
  path: string;
  /** The ref asked for, or null for the working tree. */
  ref: string | null;
  /** The commit the ref named when read (git refs only). */
  commit?: string;
  size: number;
  kind: RepoFileKind;
  /** Highlighting hint for code, e.g. "typescript". */
  language?: string;
  /**
   * Text (at most REPO_FILE_MAX_BYTES), or a data: URL for a picture; none for binary files,
   * videos and sounds (their bytes are at `repoMediaUrl`).
   */
  content?: string;
  /** Pictures, videos and sounds: true when too big to show (REPO_IMAGE/MEDIA_MAX_BYTES). */
  truncated: boolean;
  /** The media type of a picture, video or sound. */
  mime?: string;
  /** The project file with this path, when the owner already added it (opens "in folder"). */
  fileId?: string;
};

/** `GET /api/projects/:id/repo-paths`: each found path and where (a ref, or null: working tree). */
export type RepoPathsResult = { found: Record<string, { ref: string | null }> };

const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c === '\u007f');

/** Why a repository path can't be asked for, or null: relative, "/"-separated, no "." or "..". */
export function repoPathProblem(path: string): string | null {
  if (!path || path.length > 1024) return 'A path of 1 to 1024 characters';
  if (hasControl(path)) return 'No control characters';
  if (path.includes('\\')) return 'Use "/" between parts';
  if (path.startsWith('/') || /^[a-z]:/i.test(path)) return 'A path inside the repository';
  if (path.split('/').some((p) => p === '' || p === '.' || p === '..'))
    return 'No empty, "." or ".." parts';
  return null;
}

/**
 * Why a ref can't be asked for, or null. Stricter than git: a branch, tag or commit made of
 * letters, digits and `._/-`, not starting with "-" (never an option) and without "..", "//",
 * "@{" or a trailing "." or "/".
 */
export function repoRefProblem(ref: string): string | null {
  if (!ref || ref.length > 200) return 'A ref of 1 to 200 characters';
  if (!/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(ref)) return 'A branch, tag or commit name';
  if (ref.includes('..') || ref.includes('//') || /[./]$/.test(ref) || ref.endsWith('.lock'))
    return 'A branch, tag or commit name';
  return null;
}

/** Parses a `repo:` link, or null when it isn't one (or its path or ref is invalid). */
export function parseRepoHref(href: string | undefined | null): RepoLink | null {
  if (!href || !href.toLowerCase().startsWith(REPO_SCHEME)) return null;
  let rest = href.slice(REPO_SCHEME.length);
  let lines: RepoLines | undefined;
  const hash = rest.indexOf('#');
  if (hash >= 0) {
    const m = /^L(\d{1,7})(?:-L?(\d{1,7}))?$/i.exec(rest.slice(hash + 1));
    if (m) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      if (from >= 1) lines = { from: Math.min(from, to), to: Math.max(from, to) };
    }
    rest = rest.slice(0, hash);
  }
  try {
    rest = decodeURIComponent(rest);
  } catch {
    return null;
  }
  rest = rest.replace(/^\.\//, '');
  let path = rest;
  let ref: string | undefined;
  const at = rest.lastIndexOf('@');
  if (at > 0) {
    const candidate = rest.slice(at + 1);
    const before = rest.slice(0, at);
    if (!before.endsWith('/') && repoRefProblem(candidate) === null) {
      path = before;
      ref = candidate;
    }
  }
  if (repoPathProblem(path) !== null) return null;
  return { path, ...(ref ? { ref } : {}), ...(lines ? { lines } : {}) };
}

/** The `repo:` link for a file. */
export function repoHref(link: RepoLink): string {
  const path = link.path.split('/').map(encodeURIComponent).join('/');
  const lines = link.lines
    ? `#L${link.lines.from}${link.lines.to !== link.lines.from ? `-L${link.lines.to}` : ''}`
    : '';
  return `${REPO_SCHEME}${path}${link.ref ? `@${link.ref}` : ''}${lines}`;
}

// ------------------------------------------------------------------ auto-links

/**
 * A relative path with at least one folder and a file extension, not part of a web address or a
 * longer word: `docs/research/FORMAL_MODEL.md`, `eval/scripts/frontier_sim.py`.
 */
const PATH_IN_TEXT =
  /(?<![\w/.:@~\\-])((?:[A-Za-z0-9_][\w.-]*\/)+[\w-][\w.-]*\.[A-Za-z0-9]{1,10})(?![\w/-])/g;
/** Inline code that is a path (a folder is optional here: `README.md`). */
const PATH_IN_CODE = /^(?:\.\/)?((?:[A-Za-z0-9_][\w.-]*\/)*[\w-][\w.-]*\.[A-Za-z0-9]{1,10})$/;

export type FoundPath = { start: number; end: number; path: string };

/** Paths written in plain text, as candidates the server still has to find in the repository. */
export function findRepoPaths(text: string): FoundPath[] {
  const found: FoundPath[] = [];
  for (const m of text.matchAll(PATH_IN_TEXT)) {
    const path = m[1]!;
    if (repoPathProblem(path) !== null) continue;
    // A domain name ("example.com/a.md") isn't a path.
    if (/^[\w-]+\.(com|org|net|io|dev|ai|app|co|edu|gov)\//i.test(path)) continue;
    found.push({ start: m.index!, end: m.index! + path.length, path });
  }
  return found;
}

/** The path inline code names, or null when it isn't just a path. */
export function repoPathInCode(code: string): string | null {
  const m = PATH_IN_CODE.exec(code.trim());
  if (!m) return null;
  const path = m[1]!;
  return repoPathProblem(path) === null && !/^\d+(\.\d+)+$/.test(path) ? path : null;
}

/**
 * The branch a sentence names, as in "written today on review/formal-model" or "on branch
 * main": only after "on" or "branch", and only a name that could be a ref. The server checks it
 * exists and falls back to the working tree otherwise.
 */
export function refInSentence(sentence: string): string | undefined {
  for (const m of sentence.matchAll(
    /\b(on(?:\s+the)?(?:\s+branch)?|branch)\s+`?([A-Za-z0-9_][\w./-]*)`?/gi,
  )) {
    const ref = m[2]!.replace(/[./]+$/, '');
    // "on docs/a.md" names a file, not a branch.
    if (/\.[a-z]{1,4}$/i.test(ref) || repoRefProblem(ref) !== null) continue;
    // After a bare "on", only a name that looks like a branch ("on 1,000 seasons", "on Tuesday"
    // aren't): one with a "/" or "-", or a usual main branch name.
    const named = /branch/i.test(m[1]!);
    if (named || /[/-]/.test(ref) || /^(main|master|develop|trunk)$/.test(ref)) return ref;
  }
  return undefined;
}

/** Sentence spans of a text: ends at ".", "!" or "?" followed by a space or the end. */
export function sentencesOf(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (const m of text.matchAll(/[.!?](?=\s|$)|\n\s*\n/g)) {
    const end = m.index! + m[0].length;
    spans.push({ start, end });
    start = end;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}
