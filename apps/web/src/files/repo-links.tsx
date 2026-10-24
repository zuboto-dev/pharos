import {
  findRepoPaths,
  parseRepoHref,
  refInSentence,
  REPO_PATHS_MAX,
  REPO_SCHEME,
  repoHref,
  repoPathInCode,
  repoPathsUrl,
  sentencesOf,
  type RepoLink,
  type RepoPathsResult,
} from '@pharos/schema';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown';
import type { JSX } from 'react';
import { useOptionalViewData } from '../catalog/context';
import { getJson } from '../lib/api';
import { useExit } from '../lib/motion';
import { RepoFileViewer } from './repo-viewer';

// Repository file links in Markdown (packages/schema/src/repo-files.ts). An agent writes
// `[FORMAL_MODEL.md](repo:docs/research/FORMAL_MODEL.md@review/formal-model)`; a click opens the
// file in the viewer, read from the project's repository. A relative path written as plain text
// or inline code is linked too, once the server says the repository has it: at the ref the same
// sentence names ("… on review/formal-model."), else in the working tree.

/** The project whose repository links resolve against, or null (no project, no repository). */
export function useRepoProject(): string | null {
  const data = useOptionalViewData();
  return data?.repository?.data.path ? data.project.id : null;
}

/** Keeps `repo:` addresses (react-markdown drops unknown schemes); the rest as by default. */
export function repoUrlTransform(url: string): string {
  return url.toLowerCase().startsWith(REPO_SCHEME) ? url : defaultUrlTransform(url);
}

// ------------------------------------------------------------------ auto-links (remark)

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: Record<string, unknown>;
};

/** Paragraph-like nodes whose sentences name a branch for the paths in them. */
const PHRASING_PARENTS = new Set(['paragraph', 'heading', 'tableCell']);
/** Never looked into. */
const SKIP = new Set(['code', 'html', 'definition', 'link', 'linkReference', 'image']);

function textOf(node: MdNode): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
  if (node.type === 'break') return '\n';
  return (node.children ?? []).map(textOf).join('');
}

const autoLink = (link: RepoLink, children: MdNode[]): MdNode => ({
  type: 'link',
  url: repoHref(link),
  children,
  data: { hProperties: { dataRepoAuto: '' } },
});

function linkPhrasing(parent: MdNode) {
  const full = textOf(parent);
  const spans = sentencesOf(full);
  const refAt = (offset: number) => {
    const span = spans.find((s) => offset >= s.start && offset < s.end);
    return span ? refInSentence(full.slice(span.start, span.end)) : undefined;
  };
  let offset = 0;
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): MdNode[] => {
      const at = offset;
      if (child.type === 'text' && child.value) {
        offset += child.value.length;
        const found = findRepoPaths(child.value);
        if (!found.length) return [child];
        const pieces: MdNode[] = [];
        let last = 0;
        for (const f of found) {
          if (f.start > last)
            pieces.push({ type: 'text', value: child.value.slice(last, f.start) });
          const ref = refAt(at + f.start);
          pieces.push(
            autoLink({ path: f.path, ...(ref ? { ref } : {}) }, [{ type: 'text', value: f.path }]),
          );
          last = f.end;
        }
        if (last < child.value.length)
          pieces.push({ type: 'text', value: child.value.slice(last) });
        return pieces;
      }
      if (child.type === 'inlineCode') {
        offset += child.value?.length ?? 0;
        const path = repoPathInCode(child.value ?? '');
        if (!path) return [child];
        const ref = refAt(at);
        return [autoLink({ path, ...(ref ? { ref } : {}) }, [child])];
      }
      if (SKIP.has(child.type)) {
        offset += textOf(child).length;
        return [child];
      }
      walk(child);
      return [child];
    });
  };
  walk(parent);
}

/** A remark plugin: candidate repository paths become `repo:` links marked `data-repo-auto`. */
export function remarkRepoPaths() {
  return (tree: MdNode) => {
    const visit = (node: MdNode) => {
      if (SKIP.has(node.type)) return;
      if (PHRASING_PARENTS.has(node.type)) return linkPhrasing(node);
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

// ------------------------------------------------------------------ does the repository have it?

type Found = { ref: string | null } | null;
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; result: Promise<Found> }>();
const queues = new Map<
  string,
  { projectId: string; ref?: string; waiting: Map<string, (found: Found) => void> }
>();

function flush(key: string) {
  const queue = queues.get(key);
  queues.delete(key);
  if (!queue) return;
  const paths = [...queue.waiting.keys()];
  for (let i = 0; i < paths.length; i += REPO_PATHS_MAX) {
    const chunk = paths.slice(i, i + REPO_PATHS_MAX);
    getJson<RepoPathsResult>(repoPathsUrl(queue.projectId, chunk, queue.ref)).then(
      (result) => chunk.forEach((p) => queue.waiting.get(p)!(result?.found?.[p] ?? null)),
      () =>
        chunk.forEach((p) => {
          // Not known: try again next time it is shown.
          cache.delete(`${key}\0${p}`);
          queue.waiting.get(p)!(null);
        }),
    );
  }
}

/** Whether the project's repository has `path` (one request for all the links shown at once). */
export function checkRepoPath(projectId: string, path: string, ref?: string): Promise<Found> {
  const key = `${projectId}\0${ref ?? ''}`;
  const cached = cache.get(`${key}\0${path}`);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.result;
  let queue = queues.get(key);
  if (!queue) {
    queue = { projectId, ref, waiting: new Map() };
    queues.set(key, queue);
    setTimeout(() => flush(key), 0);
  }
  const q = queue;
  const result = new Promise<Found>((resolve) => q.waiting.set(path, resolve));
  cache.set(`${key}\0${path}`, { at: Date.now(), result });
  return result;
}

/** For tests: forget what was checked. */
export function clearRepoPathCache() {
  cache.clear();
}

function useRepoPathCheck(projectId: string | null, path: string, ref?: string) {
  const key = `${projectId}\0${ref ?? ''}\0${path}`;
  const [state, setState] = useState<{ key: string; found: Found } | null>(null);
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void checkRepoPath(projectId, path, ref).then((found) => live && setState({ key, found }));
    return () => {
      live = false;
    };
  }, [projectId, path, ref, key]);
  return state?.key === key ? state.found : undefined;
}

// ------------------------------------------------------------------ the link

const LINK =
  'inline cursor-pointer p-0 text-left [font:inherit] text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid focus-visible:outline-2 focus-visible:outline-sky-400';

/** A repository file link: opens the file in the viewer. */
export function RepoFileLink({
  projectId,
  link,
  children,
}: {
  projectId: string | null;
  link: RepoLink;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<RepoLink | null>(null);
  const shown = useExit(open);
  const opener = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(null);
    requestAnimationFrame(() => opener.current?.isConnected && opener.current.focus());
  }, []);
  const where = `${link.path}${link.ref ? ` on ${link.ref}` : ''}`;
  if (!projectId)
    return (
      <span title={`${where} (this project has no repository folder)`} className="text-ink-soft">
        {children}
      </span>
    );
  return (
    <>
      <button
        ref={opener}
        type="button"
        data-repo-link=""
        title={`Open ${where}`}
        onClick={() => setOpen(link)}
        className={LINK}
      >
        {children}
      </button>
      {shown.shown && (
        <RepoFileViewer
          projectId={projectId}
          link={shown.shown}
          onClose={close}
          leaving={shown.leaving}
        />
      )}
    </>
  );
}

/**
 * The ref paths are looked up at when their sentence names none: inside a repository file shown
 * at a branch, that branch.
 */
export const RepoDefaultRef = createContext<string | undefined>(undefined);

/** An auto-link: a link once the repository has the path, else just what was written. */
function AutoRepoLink({
  projectId,
  link,
  children,
}: {
  projectId: string | null;
  link: RepoLink;
  children: ReactNode;
}) {
  const fallback = useContext(RepoDefaultRef);
  const found = useRepoPathCheck(projectId, link.path, link.ref ?? fallback);
  if (!found) return <>{children}</>;
  return (
    <RepoFileLink
      projectId={projectId}
      link={{ path: link.path, ...(found.ref ? { ref: found.ref } : {}) }}
    >
      {children}
    </RepoFileLink>
  );
}

/**
 * The Markdown `a` renderer: `repo:` links open the viewer; anything else goes to `inner` (the
 * caller's own `a`) or a plain link.
 */
export function repoAnchor(projectId: string | null, inner?: Components['a']): Components['a'] {
  type AnchorProps = JSX.IntrinsicElements['a'] & ExtraProps;
  const Inner =
    typeof inner === 'string' ? undefined : (inner as ComponentType<AnchorProps> | undefined);
  return function Anchor(props) {
    // `node` is the Markdown tree, not an attribute.
    const { href, children, node, ...rest } = props;
    void node;
    const link = parseRepoHref(href);
    if (link) {
      if ('data-repo-auto' in rest)
        return (
          <AutoRepoLink projectId={projectId} link={link}>
            {children}
          </AutoRepoLink>
        );
      return (
        <RepoFileLink projectId={projectId} link={link}>
          {children}
        </RepoFileLink>
      );
    }
    if (Inner) return <Inner {...props} />;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  };
}
