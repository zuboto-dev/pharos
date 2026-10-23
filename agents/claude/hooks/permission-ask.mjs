#!/usr/bin/env node
// Installed by Pharos (pnpm agents install). Claude Code's PermissionRequest hook: when an agent is
// about to ask you for permission, this tells Pharos (which explains the ask and which project it's
// from) and waits a short while for your answer there. Allow or Deny in Pharos answers Claude Code;
// with no answer in time, or when Pharos isn't running, Claude Code asks as it always does.
//
// Claude Code hooks reference (https://code.claude.com/docs/en/hooks.md, PermissionRequest):
// stdin carries session_id, transcript_path, cwd, permission_mode, hook_event_name, tool_name and
// tool_input; stdout `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":
// {"behavior":"allow"|"deny", "message"?}}}` decides; exit code 2 with no decision "leaves the
// permission flow unchanged". In sessions that can't show a prompt (headless, background
// subagents), no decision means the call is denied, as without this hook.
//
// PHAROS_URL picks the server (default http://127.0.0.1:4300; local addresses only).
// PHAROS_ASK_WAIT is how many seconds to wait for an answer (default 55; 0 only notifies).

const base = (process.env.PHAROS_URL ?? 'http://127.0.0.1:4300').replace(/\/+$/, '');
const waitSeconds = Math.max(0, Math.min(110, Number(process.env.PHAROS_ASK_WAIT ?? 55) || 0));

/** No decision: Claude Code carries on with its own prompt. */
function passThrough() {
  process.exit(2);
}

function decide(decision) {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })}\n`,
  );
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let host;
  try {
    host = new URL(base).hostname;
  } catch {
    return passThrough();
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(host)) return passThrough();
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return passThrough();
  }
  const ask = {
    session_id: input.session_id,
    transcript_path: input.transcript_path,
    cwd: input.cwd ?? process.cwd(),
    hook_event_name: input.hook_event_name,
    permission_mode: input.permission_mode,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    wait_seconds: waitSeconds,
  };
  let id;
  try {
    const res = await fetch(`${base}/api/permission-asks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ask),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return passThrough();
    ({ id } = await res.json());
  } catch {
    return passThrough();
  }
  if (!id || !waitSeconds) return passThrough();
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const ms = Math.min(25_000, deadline - Date.now());
    let answer;
    try {
      const res = await fetch(
        `${base}/api/permission-asks/${encodeURIComponent(id)}/wait?ms=${ms}`,
        { signal: AbortSignal.timeout(ms + 5000) },
      );
      if (!res.ok) return passThrough();
      answer = await res.json();
    } catch {
      return passThrough();
    }
    if (answer.behavior === 'allow') return decide({ behavior: 'allow' });
    if (answer.behavior === 'deny')
      return decide({ behavior: 'deny', message: answer.message ?? 'Denied in Pharos' });
    if (answer.status !== 'waiting') return passThrough();
  }
  return passThrough();
}

main().catch(() => passThrough());
