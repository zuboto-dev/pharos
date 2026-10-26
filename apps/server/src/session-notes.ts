import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { z } from 'zod';
import type { Store } from './store/store.js';
import { folderProjects } from './terminal/command.js';

/**
 * Session notes (owner, 2026-10-26: "the agents from routines, the terminal view and my terminal
 * don't share context"): every Claude Code session posts its last message at the end of each turn
 * (Stop hook, agents/claude/hooks/session-note.mjs; the panel's turn hook too), and each project's
 * brief lists its most recent sessions, wherever they ran. One row per session, the latest turn.
 */

export const SESSION_NOTE = { messageChars: 1500, keepPerProject: 50 } as const;

export const SessionNoteInput = z.object({
  session_id: z.string().min(1).max(200),
  cwd: z.string().min(1).max(4096),
  /** The machine it ran on ("this Mac", "axion-01", …). */
  host: z.string().max(120).optional(),
  /** terminal (a person's), panel (Pharos's agent panel) or routine (with its name). */
  kind: z.string().max(80).default('terminal'),
  agent: z.string().max(80).optional(),
  message: z.string().max(20_000).default(''),
});
export type SessionNoteInput = z.infer<typeof SessionNoteInput>;

export type SessionNote = {
  sessionId: string;
  projectId: string | null;
  cwd: string;
  host: string | null;
  kind: string;
  agent: string | null;
  message: string;
  turns: number;
  firstAt: string;
  lastAt: string;
};

type Row = {
  session_id: string;
  project_id: string | null;
  cwd: string;
  host: string | null;
  kind: string;
  agent: string | null;
  message: string;
  turns: number;
  first_at: string;
  last_at: string;
};

const toNote = (r: Row): SessionNote => ({
  sessionId: r.session_id,
  projectId: r.project_id,
  cwd: r.cwd,
  host: r.host,
  kind: r.kind,
  agent: r.agent,
  message: r.message,
  turns: r.turns,
  firstAt: r.first_at,
  lastAt: r.last_at,
});

/** A long last message, cut at a sentence or word near the limit. */
function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'));
  return `${(stop > max * 0.6 ? cut.slice(0, stop + 1) : cut.slice(0, cut.lastIndexOf(' '))).trim()} …`;
}

export class SessionNotes {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get db() {
    return this.store.database;
  }

  /** Records a session's turn; the project is the one whose repository is its folder (or under it). */
  record(input: SessionNoteInput): SessionNote | null {
    const message = shorten(input.message, SESSION_NOTE.messageChars);
    if (!message) return null;
    const at = this.now().toISOString();
    const projectId = this.projectOf(input.cwd);
    this.db
      .prepare(
        `INSERT INTO session_notes (session_id, project_id, cwd, host, kind, agent, message, turns, first_at, last_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET project_id = excluded.project_id, cwd = excluded.cwd,
           host = excluded.host, kind = excluded.kind, agent = excluded.agent, message = excluded.message,
           turns = turns + 1, last_at = excluded.last_at`,
      )
      .run(
        input.session_id,
        projectId,
        input.cwd,
        input.host ?? null,
        input.kind,
        input.agent ?? null,
        message,
        at,
        at,
      );
    if (projectId)
      this.db
        .prepare(
          `DELETE FROM session_notes WHERE project_id = ? AND session_id NOT IN
           (SELECT session_id FROM session_notes WHERE project_id = ? ORDER BY last_at DESC LIMIT ?)`,
        )
        .run(projectId, projectId, SESSION_NOTE.keepPerProject);
    return this.get(input.session_id);
  }

  get(sessionId: string): SessionNote | null {
    const row = this.db
      .prepare('SELECT * FROM session_notes WHERE session_id = ?')
      .get(sessionId) as Row | undefined;
    return row ? toNote(row) : null;
  }

  recent(projectId: string, limit = 5): SessionNote[] {
    return (
      this.db
        .prepare('SELECT * FROM session_notes WHERE project_id = ? ORDER BY last_at DESC LIMIT ?')
        .all(projectId, limit) as Row[]
    ).map(toNote);
  }

  /** The project of a folder: its own repository, else the nearest parent folder that is one. */
  private projectOf(cwd: string): string | null {
    let dir = cwd.replace(/\/+$/, '');
    // Worktrees of a project (…/.claude/worktrees/x, …/.night/…) belong to it.
    dir = dir.replace(/\/\.(claude\/worktrees|night)\/.*$/, '');
    while (dir && dir !== '/') {
      const found = folderProjects(this.store, dir)[0];
      if (found) return found.id;
      dir = dir.slice(0, dir.lastIndexOf('/'));
    }
    return null;
  }
}

/**
 * The last thing the assistant said in a Claude Code transcript (JSONL): the text parts of the
 * newest assistant entry, from the file's last 256 KB. Empty when there is none or it can't be read.
 */
export function lastAssistantText(transcriptPath: string): string {
  try {
    const size = statSync(transcriptPath).size;
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = openSync(transcriptPath, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    const lines = buffer.toString('utf8').split('\n').reverse();
    for (const line of lines) {
      if (!line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line) as {
          type?: string;
          message?: { content?: { type?: string; text?: string }[] | string };
        };
        if (entry.type !== 'assistant') continue;
        const content = entry.message?.content;
        const text =
          typeof content === 'string'
            ? content
            : (content ?? [])
                .filter((p) => p.type === 'text' && p.text)
                .map((p) => p.text)
                .join('\n');
        if (text.trim()) return text;
      } catch {
        // a partial line at the start of the window
      }
    }
  } catch {
    // no transcript
  }
  return '';
}
