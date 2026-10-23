import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { folderBriefs, projectBrief } from './brief.js';
import { RunLog } from './desk.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('the project brief', () => {
  it('carries where it stands, the rules, recent answers, hand-backs and asks, for every session', () => {
    const store = new Store(openDatabase(':memory:'));
    const folder = mkdtempSync(join(tmpdir(), 'pharos-brief-'));
    dirs.push(folder);
    const agent = { kind: 'agent' as const, name: 'Claude Code' };
    const made = store.apply(agent, {
      message: 'set up',
      operations: [
        { op: 'create', type: 'repository', ref: 'r', data: { name: 'app', path: folder } },
        {
          op: 'create',
          type: 'project',
          ref: 'p',
          data: {
            name: 'Lumisyl',
            summary: 'A calm breathing timer',
            repositoryId: '$r',
            rules: ['Seamless and wordless: icons and tooltips over words'],
          },
        },
        { op: 'create', type: 'goal', ref: 'g', data: { projectId: '$p', title: 'Launch' } },
        {
          op: 'create',
          type: 'task',
          data: { projectId: '$p', title: 'Ship it', goalIds: ['$g'], status: 'done' },
        },
        {
          op: 'create',
          type: 'task',
          data: { projectId: '$p', title: 'Fix contrast', goalIds: ['$g'], status: 'in_progress' },
        },
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: {
            projectId: '$p',
            title: 'Which key?',
            options: [
              { id: 'a', label: 'B major' },
              { id: 'b', label: 'C' },
            ],
          },
        },
        {
          op: 'create',
          type: 'decision',
          data: {
            projectId: '$p',
            title: 'Lawyer?',
            options: [
              { id: 'a', label: 'Yes' },
              { id: 'b', label: 'No' },
            ],
          },
        },
      ],
    });
    const projectId = made.created.p!;
    store.apply(
      { kind: 'human', name: 'me' },
      {
        message: 'choose',
        operations: [
          {
            op: 'update',
            type: 'decision',
            id: made.created.d!,
            data: { chosenOptionId: 'a', note: 'warmer' },
          },
        ],
      },
    );
    const brief = projectBrief(store, projectId, { runs: new RunLog(store) });
    expect(brief).toContain(`# Lumisyl (${projectId})`);
    expect(brief).toContain('A calm breathing timer');
    expect(brief).toContain('- Seamless and wordless: icons and tooltips over words');
    expect(brief).toContain('Launch (');
    expect(brief).toContain('1 of 2 tasks done');
    expect(brief).toContain('Which key?: chose “B major” (note: warmer)');
    expect(brief).toContain('## Waiting on the owner (1)');
    expect(brief).toContain('- Lawyer?');
    expect(brief).toContain('## In progress');
    expect(brief).toContain('Fix contrast');
    // A session in the folder gets it by folder.
    expect(folderBriefs(store, folder, { runs: new RunLog(store) })).toEqual([brief]);
    expect(folderBriefs(store, join(folder, 'elsewhere'))).toEqual([]);
  });
});
