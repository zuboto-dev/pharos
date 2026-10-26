import {
  DOC_WORDS,
  MAIN_PAGE_WORDS,
  decisionState,
  meaningOf,
  visibleWords,
  type Entity,
} from '@pharos/schema';
import type { Store } from './store/store.js';

/**
 * Keeping a project's pages in step with Pharos (the owner, 2026-10-26: "let the agents revise
 * their views along with the Pharos updates"). Every session's brief carries what changed in how
 * Pharos pages work, and, worked out from the project itself, which of its pages are behind: no
 * main page, a main page older than the project's latest anchor point, a document over the word
 * limit, an older HTML report page. Agents act on it as they work; nothing is stored.
 */

/** What changed in how pages work, newest first: the brief shows those of the last 30 days. */
export const PAGE_UPDATES: { date: string; what: string }[] = [
  {
    date: '2026-10-26',
    what: 'Each project opens on its main page (view_create with main: true and doc; one per project): what it is for, the problem, the anchor points, where it is heading. Revise it, never archive it',
  },
  {
    date: '2026-10-26',
    what: `Documents show at most ${DOC_WORDS} words before their details blocks (${MAIN_PAGE_WORDS} on a main page); saves over that are refused. Lead with a picture of the point`,
  },
  {
    date: '2026-10-26',
    what: 'Project-management boards (tasks, stages, goals) wait under the tab menu unless the owner pins them; agents can’t pin them. What a reader must know goes on the main page',
  },
  {
    date: '2026-10-26',
    what: 'Every page keeps its versions: revise a page in place with view_update and a message saying what changed, rather than making a new one',
  },
  {
    date: '2026-10-26',
    what: 'Drawings size themselves to their content and scale down to fit the width; a drawing’s height is only where it starts',
  },
];

const DAY = 86_400_000;

/** Anchor points since a revision: stages finished, goals reached, decisions made. */
function anchorsSince(store: Store, project: Entity<'project'>, afterRev: number): string[] {
  const out: string[] = [];
  for (const r of store.history({ projectId: project.id, after: afterRev, limit: 300 })) {
    for (const c of r.changes) {
      const status = c.fields.status?.after;
      if (c.type === 'stage' && typeof status === 'string') {
        if (meaningOf(project, 'stage.status', status) === 'done')
          out.push(`stage “${c.label ?? c.id}” finished`);
      } else if (c.type === 'goal' && typeof status === 'string') {
        if (meaningOf(project, 'goal.status', status) === 'achieved')
          out.push(`goal “${c.label ?? c.id}” reached`);
      } else if (c.type === 'decision' && 'chosenOptionId' in c.fields) {
        const d = store.get(c.id) as Entity<'decision'> | null;
        if (d && decisionState(d.data).kind === 'chosen')
          out.push(`decision “${d.data.title}” made`);
      }
    }
  }
  return [...new Set(out)];
}

/** Lines for the brief: what changed in Pharos lately, and this project's pages that are behind. */
export function pageUpkeep(
  store: Store,
  projectId: string,
  now: Date = new Date(),
): { updates: string[]; todo: string[] } {
  const project = store.get(projectId) as Entity<'project'> | null;
  if (project?.type !== 'project') return { updates: [], todo: [] };
  const since = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
  const updates = PAGE_UPDATES.filter((u) => u.date >= since).map((u) => `${u.date}: ${u.what}`);

  const views = store.list('view', { projectId }).filter((v) => !v.data.archived);
  const todo: string[] = [];
  const main = views.find((v) => v.data.kind === 'main');
  if (!main)
    todo.push(
      'No main page yet: write it before other pages (view_create with main: true and doc), pictures first',
    );
  else {
    const anchors = anchorsSince(store, project, main.updatedRev);
    if (anchors.length)
      todo.push(
        `The main page “${main.data.name}” (${main.id}) was last revised ${main.updatedAt.slice(0, 10)}; since then ${anchors.slice(0, 4).join(', ')}${anchors.length > 4 ? ` and ${anchors.length - 4} more` : ''}: revise it with view_update, saying what changed`,
      );
  }
  for (const v of views) {
    if (v.data.doc) {
      const limit = v.data.kind === 'main' ? MAIN_PAGE_WORDS : DOC_WORDS;
      const words = visibleWords(v.data.doc);
      if (words > limit)
        todo.push(
          `“${v.data.name}” (${v.id}) shows ${words} words before its details (at most ${limit}): rewrite it pictures first, folding the rest into details`,
        );
    } else if (v.data.page && v.data.kind !== 'answer')
      todo.push(
        `“${v.data.name}” (${v.id}) is an older HTML report page: when it next changes, write it as a document (doc)`,
      );
  }
  return { updates, todo };
}
