import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Runs inside shellRunner's isolated directory; capture the expanded briefing, not $PHAROS_PROMPT.
writeFileSync(
  'invocation.json',
  JSON.stringify(
    {
      prompt: process.env.PHAROS_PROMPT,
      projectIds: process.env.PHAROS_PROJECT_IDS,
      requestIds: process.env.PHAROS_REQUEST_IDS,
    },
    null,
    2,
  ),
);
const command = process.env.PHAROS_EVAL_COMMAND;
if (!command) throw new Error('Missing evaluation command');
const child = spawn(command, { shell: true, stdio: 'inherit', env: process.env });
child.on('error', () => {
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
