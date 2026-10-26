#!/usr/bin/env node
// Installed by Pharos (pnpm agents install), and passed by Routines to its runs on any runner.
// Claude Code's Stop hook: when a session finishes a turn, this tells Pharos what it said last,
// so every other session (your terminal, the Pharos panel, the routines) starts from it: the
// project brief lists each project's recent sessions. It never blocks or fails the session.
//
// Claude Code hooks reference (https://code.claude.com/docs/en/hooks.md, Stop): stdin carries
// session_id, transcript_path, cwd and hook_event_name; exit 0 with no output changes nothing.
//
// PHAROS_URL picks the server (default http://127.0.0.1:4300; a runner reaches it through its
// SSH tunnel). PHAROS_SESSION_KIND says what kind of session it is (default "terminal"; Routines
// sets "routine: <name>"), PHAROS_HOST the machine (default this computer's name).
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { hostname } from 'node:os';

const base = (process.env.PHAROS_URL ?? 'http://127.0.0.1:4300').replace(/\/+$/, '');

function lastAssistantText(path) {
  try {
    const size = statSync(path).size;
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    const fd = openSync(path, 'r');
    try {
      readSync(fd, buffer, 0, length, size - length);
    } finally {
      closeSync(fd);
    }
    for (const line of buffer.toString('utf8').split('\n').reverse()) {
      if (!line.includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(line);
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

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const hook = JSON.parse(input || '{}');
  if (hook.hook_event_name && hook.hook_event_name !== 'Stop') return;
  const message = hook.transcript_path ? lastAssistantText(hook.transcript_path) : '';
  if (!message || !hook.session_id || !hook.cwd) return;
  await fetch(`${base}/api/sessions/note`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session_id: hook.session_id,
      cwd: hook.cwd,
      host: process.env.PHAROS_HOST || hostname(),
      kind: process.env.PHAROS_SESSION_KIND || 'terminal',
      agent: 'Claude Code',
      message: message.slice(0, 20_000),
    }),
    signal: AbortSignal.timeout(3000),
  });
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
