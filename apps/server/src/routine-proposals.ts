import { basename, resolve } from 'node:path';
import {
  RoutineProposal,
  agentLabel,
  daysText,
  meaningOf,
  routinesOf,
  valueFor,
  type Author,
  type Entity,
  type RoutineDef,
  type RoutineProposalView,
} from '@pharos/schema';
import { askOwner } from './desk.js';
import type { RevisionFeed } from './feed.js';
import { SaveRefused, Unreachable, type RoutinesClient } from './routines.js';
import { PharosError } from './store/errors.js';
import type { Store } from './store/store.js';

// Agents propose routines, the owner approves (2026-10-23). An agent can't change routines.json
// (the Routines routes are owner only); with MCP routine_propose it puts one decision on the
// owner's desk ("Add it" / "Not now"). The proposal itself is kept in the app setting
// `routines.proposals`, keyed by the decision's id (app state, not project data: never a
// revision). When the owner chooses "Add it" — on the desk, a page or the details panel, any way
// a decision is answered — this server adds the routine through the Routines save path as the
// owner's action and notes the outcome on the decision. "Not now" changes nothing. If Routines
// doesn't answer, the decision goes back on the desk with a note, and Pharos tries again on the
// next approval or when the Routines page loads.

export const PROPOSALS_SETTING = 'routines.proposals';
export const ADD_OPTION = 'add';
export const NOT_NOW_OPTION = 'not-now';

type Stored = {
  proposal: RoutineProposal;
  author: string;
  projectId: string;
  href: string;
  at: string;
  /** pending: waits on the owner; added / declined / failed / gone: settled. */
  state: 'pending' | 'added' | 'declined' | 'failed' | 'gone';
  /** The owner chose Add it but Routines didn't answer: try again on page load. */
  retry?: boolean;
  note?: string;
  routineId?: string;
};

const SYSTEM: Author = { kind: 'system', name: 'Pharos' };

function all(store: Store): Record<string, Stored> {
  return store.setting<Record<string, Stored>>(PROPOSALS_SETTING) ?? {};
}

function put(store: Store, id: string, next: Stored) {
  store.setSetting(PROPOSALS_SETTING, { ...all(store), [id]: next });
}

/** "Fridays 17:00" / "17:00 every day". */
function when(p: Pick<RoutineProposal, 'time' | 'days'>): string {
  return p.days
    ? `${daysText(p.days).replace(/^./, (c) => c.toUpperCase())} ${p.time}`
    : `${p.time} every day`;
}

function forWhom(p: RoutineProposal): string {
  return !p.projects || p.projects === 'enrolled' ? 'enrolled projects' : p.projects.join(', ');
}

/**
 * The Pharos project whose desk a proposal goes on: the one asked for, else the main project of
 * the first named Routines project (by folder name, then by name), else a project named
 * "Routines".
 */
function deskProject(store: Store, p: RoutineProposal): string {
  if (p.projectId) {
    if (store.get(p.projectId)?.type !== 'project')
      throw new PharosError('not_found', `Project ${p.projectId} not found`);
    return p.projectId;
  }
  const projects = store.list('project');
  const names = Array.isArray(p.projects) ? p.projects : [];
  for (const name of names) {
    const key = name.toLowerCase();
    const repo = store
      .list('repository')
      .find((r) => r.data.path && basename(resolve(r.data.path)).toLowerCase() === key);
    const own = repo ? projects.filter((x) => x.data.repositoryId === repo.id) : [];
    const main =
      own.find((x) => x.data.name.toLowerCase() === repo?.data.name.toLowerCase()) ??
      own[0] ??
      projects.find((x) => x.data.name.toLowerCase() === key);
    if (main) return main.id;
  }
  const routines = projects.find((x) => x.data.name.toLowerCase() === 'routines');
  if (routines) return routines.id;
  throw new PharosError(
    'invalid',
    'Give projectId: the Pharos project whose desk this proposal goes on (none matched the named projects)',
  );
}

/** MCP routine_propose: one decision on the owner's desk, the proposal kept beside it. */
export function proposeRoutine(store: Store, author: Author, input: unknown) {
  const parsed = RoutineProposal.safeParse(input);
  if (!parsed.success)
    throw new PharosError(
      'invalid',
      `Not proposed: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'proposal'}: ${i.message}`).join('; ')}`,
    );
  const proposal = parsed.data;
  const projectId = deskProject(store, proposal);
  const title = `Add the routine “${proposal.name}”, ${when(proposal)}, for ${forWhom(proposal)}?`;
  const ask = [
    proposal.reason,
    '',
    `**What it does:** ${proposal.instructions}`,
    '',
    `Runs ${when(proposal)} for ${forWhom(proposal)}. Proposed by ${agentLabel(author.name)}.`,
  ].join('\n');
  const asked = askOwner(store, author, {
    projectId,
    title: title.slice(0, 200),
    ask: proposal.reason.slice(0, 400),
    minutes: 1,
    options: [
      { id: ADD_OPTION, label: 'Add it', summary: `Runs ${when(proposal)}` },
      { id: NOT_NOW_OPTION, label: 'Not now', outcome: 'decline' },
    ],
    recommendedOptionId: ADD_OPTION,
  });
  // The full instructions go in the decision's body (the desk's ask is one or two lines).
  store.apply(author, {
    message: `Routine proposal: ${proposal.name}`,
    operations: [{ op: 'update', type: 'decision', id: asked.id, data: { body: ask } }],
  });
  put(store, asked.id, {
    proposal,
    author: author.name,
    projectId,
    href: asked.href,
    at: new Date().toISOString(),
    state: 'pending',
  });
  return { decisionId: asked.id, href: asked.href, title };
}

/** Proposals still waiting on the owner, for the Routines page. */
export function pendingProposals(store: Store): RoutineProposalView[] {
  return Object.entries(all(store))
    .filter(([, p]) => p.state === 'pending' && store.get(p.projectId))
    .flatMap(([decisionId, p]) => {
      const decision = store.get(decisionId);
      if (decision?.type !== 'decision') return [];
      return [
        {
          decisionId,
          href: p.href,
          proposedBy: agentLabel(p.author),
          proposal: p.proposal,
          ...(p.retry && p.note ? { waiting: p.note } : {}),
        },
      ];
    });
}

/** The routine a proposal adds, with an id routines.json doesn't use yet. */
export function routineFor(p: RoutineProposal, taken: string[]): RoutineDef {
  const stem =
    p.name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'routine';
  let id = stem;
  for (let i = 2; taken.includes(id); i++) id = `${stem}-${i}`;
  return {
    id,
    name: p.name,
    time: p.time,
    enabled: true,
    instructions: p.instructions,
    projects: p.projects ?? 'enrolled',
    ...(p.days && p.days.length < 7 ? { days: p.days } : {}),
  };
}

function noteOn(store: Store, decision: Entity<'decision'>, line: string, data: object = {}) {
  const body = [decision.data.body, line].filter(Boolean).join('\n\n');
  store.apply(SYSTEM, {
    message: `Routine proposal: ${line}`,
    operations: [{ op: 'update', type: 'decision', id: decision.id, data: { body, ...data } }],
  });
}

const stamp = () =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());

/**
 * Acts on the owner's answers: "Add it" adds the routine (once), "Not now" or a decline settles
 * it. Never throws; one run at a time (answers arrive on the feed and on page loads).
 */
export function proposalSettler(store: Store, client: RoutinesClient) {
  let running: Promise<void> | null = null;
  const settleOnce = async (retry: boolean) => {
    for (const [id, p] of Object.entries(all(store))) {
      if (p.state !== 'pending') continue;
      const found = store.get(id);
      if (found?.type !== 'decision') {
        put(store, id, { ...p, state: 'gone' });
        continue;
      }
      const decision = found as Entity<'decision'>;
      const chosen = decision.data.chosenOptionId;
      const project = store.get(decision.data.projectId) as Entity<'project'> | null;
      const rejected = meaningOf(project, 'decision.status', decision.data.status) === 'rejected';
      if (chosen === NOT_NOW_OPTION || (!chosen && (rejected || decision.data.answer))) {
        put(store, id, { ...p, state: 'declined' });
        continue;
      }
      // A yes Routines missed is tried again on page loads, not on every revision.
      if (chosen !== ADD_OPTION && !(retry && p.retry)) continue;
      try {
        const conf = await client.config();
        const routine = routineFor(
          p.proposal,
          routinesOf(conf).map((r) => r.id),
        );
        await client.save([{ field: 'routine', id: routine.id, from: null, to: routine }]);
        put(store, id, { ...p, state: 'added', retry: false, routineId: routine.id });
        noteOn(
          store,
          decision,
          `Added to Routines (${routine.id}) on ${stamp()}.`,
          chosen === ADD_OPTION
            ? {}
            : {
                chosenOptionId: ADD_OPTION,
                status: valueFor(project!, 'decision.status', 'accepted'),
              },
        );
      } catch (err) {
        if (err instanceof Unreachable) {
          // Back on the desk: the owner's yes stands, and Pharos tries again.
          const note = `Routines didn't answer on ${stamp()}; Pharos adds it when you choose Add it again or open the Routines page.`;
          put(store, id, { ...p, retry: true, note });
          if (chosen)
            noteOn(store, decision, note, {
              chosenOptionId: null,
              note: null,
              status: valueFor(project!, 'decision.status', 'proposed'),
            });
          continue;
        }
        const reason = err instanceof SaveRefused ? err.message : String(err);
        put(store, id, { ...p, state: 'failed', note: reason });
        noteOn(store, decision, `Not added: ${reason}`);
      }
    }
  };
  /** `retry`: also try a yes Routines missed (page loads). */
  const settle = async (retry = false) => {
    if (running) return running;
    running = settleOnce(retry)
      .catch((err: unknown) => console.error('[pharos] routine proposals:', err))
      .finally(() => {
        running = null;
      });
    return running;
  };
  return { settle, pending: () => pendingProposals(store) };
}

/** Settles proposals whenever a revision lands (an answer from any process). Never throws. */
export function watchProposals(
  feed: RevisionFeed,
  settler: ReturnType<typeof proposalSettler>,
): () => void {
  return feed.subscribe(() => {
    void settler.settle();
  });
}
