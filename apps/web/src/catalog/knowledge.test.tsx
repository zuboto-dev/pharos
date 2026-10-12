import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { ViewRenderer } from './renderer';
import { firstUses, termMatcher } from './terms';

afterEach(cleanup);

const base = dataset as unknown as ProjectDataset;
const P = base.project.id;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};

const artifact = (id: string, title: string, uri?: string) =>
  ({
    id,
    type: 'artifact',
    data: { projectId: P, title, kind: 'link', status: 'delivered', ...(uri ? { uri } : {}) },
    ...meta,
  }) as Entity<'artifact'>;

const claim = (id: string, data: Partial<Entity<'claim'>['data']>) =>
  ({
    id,
    type: 'claim',
    data: {
      projectId: P,
      statement: `Statement ${id}`,
      certainty: 'reading',
      checkedOn: '2026-10-11',
      sourceIds: [],
      tags: [],
      order: 0,
      ...data,
    },
    ...meta,
  }) as Entity<'claim'>;

const term = (id: string, word: string, alsoCalled: string[] = [], sourceId?: string) =>
  ({
    id,
    type: 'term',
    data: {
      projectId: P,
      word,
      explanation: `What ${word} means.`,
      alsoCalled,
      ...(sourceId ? { sourceId } : {}),
    },
    ...meta,
  }) as Entity<'term'>;

const artifacts = [
  artifact('art_report', 'The report', 'https://example.com/report'),
  artifact('art_kit', 'Kit', 'https://example.com/kit'),
  artifact('art_pharos', 'Pharos', 'https://example.com/pharos'),
  artifact('art_local', 'Notes', 'docs/notes.md'),
];

const claims = [
  claim('clm_head', {
    statement: 'Five layers, and the one you need is missing.',
    detail: 'The missing one decides what a reader sees first.',
    sourceIds: ['art_report', 'art_kit'],
  }),
  claim('clm_own', {
    statement: 'Pharos draws its own blocks.',
    certainty: 'verified',
    sourceIds: ['art_pharos'],
    aboutId: 'art_pharos',
    tags: ['layer-2'],
    order: 0,
  }),
  claim('clm_kit', {
    statement: 'Kit is a toolkit for a recipe.',
    certainty: 'verified',
    sourceIds: ['art_kit'],
    aboutId: 'art_kit',
    tags: ['layer-2'],
    order: 1,
  }),
  claim('clm_watch', {
    statement: 'Kit Cloud closes soon.',
    certainty: 'verified',
    sourceIds: ['art_kit'],
    aboutId: 'art_kit',
    tags: ['layer-2', 'watch'],
    order: 2,
  }),
  claim('clm_note', { statement: 'Nobody decides what to show.', tags: ['layer-3'] }),
  // A spectrum: same certainty, date and single source.
  ...['a', 'b', 'c'].map((k, i) =>
    claim(`clm_step_${k}`, {
      statement: `Step ${k}`,
      certainty: 'verified',
      checkedOn: '2026-06-10',
      sourceIds: ['art_report'],
      tags: [`step-${k}`],
      order: i,
    }),
  ),
];

const terms = [term('term_recipe', 'recipe', ['recipes'], 'art_report'), term('term_mcp', 'MCP')];

const data: ProjectDataset = { ...base, artifacts, claims, terms };

function renderSpec(spec: ViewNode, d: ProjectDataset = data, actions?: ViewActions) {
  return render(
    <ViewDataProvider data={d} version={1} actions={actions}>
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
}

const stack: ViewNode = {
  component: 'Layers',
  open: '2',
  layers: [
    {
      key: '3',
      title: 'What the reader sees',
      pill: { label: 'Nobody offers it', tone: 'gap' },
      highlight: true,
      items: { where: { tags: 'layer-3' } },
    },
    {
      key: '2',
      title: 'Drawing it',
      hint: 'Code that turns a recipe into buttons',
      pill: { label: 'Pharos has its own', tone: 'own' },
      items: { where: { tags: 'layer-2' } },
    },
    { key: '1', title: 'The AI model', items: { where: { tags: 'layer-1' } } },
  ],
  highlightAbout: 'art_pharos',
};

describe('Layers', () => {
  it('opens one layer at a time with its button', () => {
    renderSpec(stack);
    const three = screen.getByRole('button', { name: /^Layer 3 What the reader sees/ });
    const two = screen.getByRole('button', { name: /^Layer 2 Drawing it/ });
    expect(two.getAttribute('aria-expanded')).toBe('true');
    expect(three.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(two.getAttribute('aria-controls')!)!.hidden).toBe(false);

    fireEvent.click(three);
    expect(three.getAttribute('aria-expanded')).toBe('true');
    expect(two.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(two.getAttribute('aria-controls')!)!.hidden).toBe(true);
    expect(screen.getByText('Nobody decides what to show.')).toBeTruthy();

    fireEvent.click(three);
    expect(three.getAttribute('aria-expanded')).toBe('false');
  });

  it('groups claims into one card per tool, with the warning inside it', () => {
    renderSpec(stack);
    const kit = screen.getByRole('heading', { name: 'Kit' }).parentElement!;
    expect(within(kit).getByText(/Kit is a toolkit/)).toBeTruthy();
    const warning = within(kit).getByRole('note');
    expect(warning.textContent).toContain('Kit Cloud closes soon.');
    expect(screen.getByRole('heading', { name: 'Pharos' }).parentElement!.className).toMatch(/sky/);
  });

  it('shows "Nothing here yet" for an empty layer', () => {
    renderSpec(stack);
    fireEvent.click(screen.getByRole('button', { name: /^Layer 1/ }));
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });

  it('shows one shared mark when every step has the same certainty, date and source', () => {
    renderSpec({
      component: 'Layers',
      orientation: 'row',
      axis: { from: 'more control', to: 'more freedom' },
      layers: ['a', 'b', 'c'].map((k) => ({
        key: k,
        title: `Step ${k} title`,
        items: { where: { tags: `step-${k}` } },
      })),
    });
    const marks = screen.getAllByRole('button', { name: /From source/ });
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toMatch(/From source, /);
    const link = screen.getByRole('link', { name: /The report/ });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getAllByText('more freedom').length).toBeGreaterThan(0);
  });

  it('keeps per-claim marks when the claims differ', () => {
    renderSpec(stack);
    // Pharos (one source) and Kit's two claims each carry their own mark.
    expect(screen.getAllByRole('button', { name: /From source/ })).toHaveLength(3);
  });

  it('opens the quote and assumption of each line inside a layer', () => {
    const quoted = {
      ...data,
      claims: [
        ...claims.filter((c) => !c.id.startsWith('clm_step_')),
        ...['a', 'b'].map((k, i) =>
          claim(`clm_step_${k}`, {
            statement: `Step ${k}`,
            certainty: 'verified',
            checkedOn: '2026-06-10',
            sourceIds: ['art_report'],
            tags: [`step-${k}`],
            order: i,
            ...(k === 'a' ? { quote: 'Step a is the first.' } : { assumption: 'B follows A.' }),
          }),
        ),
      ],
    } as ProjectDataset;
    // Stack: the line without an "about" carries its own toggle.
    renderSpec(
      {
        component: 'Layers',
        open: 'a',
        layers: [{ key: 'a', title: 'A', items: { where: { tags: 'step-a' } } }],
      },
      quoted,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    expect(screen.getByText(/Step a is the first/).tagName).toBe('BLOCKQUOTE');
    cleanup();

    // Row with one shared mark: each line still opens its own quote or assumption.
    renderSpec(
      {
        component: 'Layers',
        orientation: 'row',
        layers: ['a', 'b'].map((k) => ({
          key: k,
          title: `Step ${k} title`,
          items: { where: { tags: `step-${k}` } },
        })),
      },
      quoted,
    );
    expect(screen.getAllByRole('button', { name: /From source/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Assumption' }));
    expect(screen.getByText('Assumes:').parentElement!.textContent).toBe('Assumes: B follows A.');
    expect(screen.getByRole('button', { name: 'Quote' })).toBeTruthy();
  });

  it("shows a layer's status claim first, in a row as in a stack", () => {
    const withStatus = {
      ...data,
      claims: [
        ...claims,
        claim('clm_status', { statement: 'Two of three parts done.', tags: ['layer-3'], order: 9 }),
      ],
    } as ProjectDataset;
    const layer = {
      key: '3',
      title: 'What the reader sees',
      pill: { label: 'In progress', tone: 'watch' as const, claim: 'clm_status' },
      items: { where: { tags: 'layer-3' } },
    };
    for (const orientation of ['row', 'stack'] as const) {
      renderSpec({ component: 'Layers', orientation, open: '3', layers: [layer] }, withStatus);
      const text = document.body.textContent!;
      expect(text.indexOf('Two of three parts done.')).toBeGreaterThan(-1);
      expect(text.indexOf('Two of three parts done.')).toBeLessThan(
        text.indexOf('Nobody decides what to show.'),
      );
      // Shown once, not again among the items.
      expect(screen.getAllByText('Two of three parts done.')).toHaveLength(1);
      cleanup();
    }
  });
});

describe('ClaimCard', () => {
  it('shows the statement as a heading, the mark with its word and date, and sources', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_head', size: 'headline', kicker: 'Map' });
    expect(screen.getByRole('heading', { name: /Five layers/ })).toBeTruthy();
    expect(screen.getByText('The missing one decides what a reader sees first.')).toBeTruthy();
    const mark = screen.getByRole('button', { name: /Our reading, / });
    expect(mark.textContent).toContain('◐');
    // Two linked sources: the button opens the list instead of a single link.
    fireEvent.click(screen.getByRole('button', { name: /Sources \(2\)/ }));
    const popover = screen.getByRole('dialog');
    expect(popover.textContent).toContain('Not checked as a fact');
    for (const name of [/The report/, /Kit/]) {
      expect(within(popover).getByRole('link', { name }).getAttribute('target')).toBe('_blank');
    }
  });

  it("shows the project's own label for a certainty", () => {
    const renamed = {
      ...data,
      project: {
        ...data.project,
        data: {
          ...data.project.data,
          options: {
            'claim.certainty': [
              { value: 'reading', label: 'Our guess', meaning: 'reading' },
              { value: 'sourced', label: 'Checked', meaning: 'verified' },
              { value: 'confirmed', label: 'Yours', meaning: 'confirmed' },
            ],
          },
        },
      },
      claims: [claim('clm_x', { certainty: 'sourced', sourceIds: ['art_kit'] })],
    } as ProjectDataset;
    renderSpec({ component: 'ClaimCard', claim: 'clm_x' }, renamed);
    const mark = screen.getByRole('button', { name: /Checked, / });
    expect(mark.textContent).toContain('●');
    expect(screen.getByRole('link', { name: /Source/ }).getAttribute('href')).toBe(
      'https://example.com/kit',
    );
  });

  it('closes the mark popover on Escape and returns focus to the mark', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_own' });
    const mark = screen.getByRole('button', { name: /From source, / });
    fireEvent.click(mark);
    expect(mark.getAttribute('aria-expanded')).toBe('true');
    const popover = screen.getByRole('dialog');
    expect(popover.textContent).toContain('Read from the linked source on');
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mark.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(mark);
  });

  it('opens the quoted passage with its source and the assumption behind a reading', () => {
    const withBasis = {
      ...data,
      claims: [
        claim('clm_quoted', {
          certainty: 'verified',
          sourceIds: ['art_report', 'art_kit'],
          quote: 'Kit ships a recipe format.',
          quoteSourceId: 'art_kit',
        }),
        claim('clm_read', { sourceIds: ['art_report'], assumption: 'The report is current.' }),
        claim('clm_bare', { sourceIds: ['art_report'] }),
      ],
    } as ProjectDataset;
    renderSpec({ component: 'ClaimCard', claim: 'clm_quoted' }, withBasis);
    const toggle = screen.getByRole('button', { name: 'Quote' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Kit ships a recipe format/)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const quote = screen.getByText(/Kit ships a recipe format/);
    expect(quote.tagName).toBe('BLOCKQUOTE');
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    // The quote names the source it came from, not just the first one.
    expect(within(panel).getByRole('link', { name: /Kit/ }).getAttribute('href')).toBe(
      'https://example.com/kit',
    );
    fireEvent.click(toggle);
    expect(screen.queryByText(/Kit ships a recipe format/)).toBeNull();
    cleanup();

    renderSpec({ component: 'ClaimCard', claim: 'clm_read', size: 'headline' }, withBasis);
    fireEvent.click(screen.getByRole('button', { name: 'Assumption' }));
    expect(screen.getByText('Assumes:').parentElement!.textContent).toBe(
      'Assumes: The report is current.',
    );
    cleanup();

    // Nothing to open: no toggle.
    renderSpec({ component: 'ClaimCard', claim: 'clm_bare' }, withBasis);
    expect(screen.queryByRole('button', { name: /Quote|Assumption/ })).toBeNull();
  });

  it('opens a local source with its path and passage instead of "(no link)"', () => {
    const local = {
      ...data,
      claims: [
        claim('clm_local', {
          certainty: 'verified',
          sourceIds: ['art_local'],
          quote: 'Every answer cites its file.',
        }),
        claim('clm_mixed', { sourceIds: ['art_report', 'art_local'] }),
      ],
    } as ProjectDataset;
    const open = vi.fn();
    renderSpec({ component: 'ClaimCard', claim: 'clm_local' }, local, {
      apply: async () => ({ ok: false }),
      open,
    });
    expect(screen.queryByRole('link')).toBeNull();
    const button = screen.getByRole('button', { name: 'Source' });
    fireEvent.click(button);
    const popover = screen.getByRole('dialog');
    expect(popover.textContent).not.toContain('(no link)');
    expect(within(popover).getByText('docs/notes.md').tagName).toBe('CODE');
    expect(within(popover).getByText(/Every answer cites its file/).tagName).toBe('BLOCKQUOTE');
    fireEvent.click(within(popover).getByRole('button', { name: 'Notes' }));
    expect(open).toHaveBeenCalledWith({ entity: 'art_local' });
    expect(screen.queryByRole('dialog')).toBeNull();

    // The quote toggle names the local source too, and opens it.
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    const panel = document.getElementById(
      screen.getByRole('button', { name: 'Quote' }).getAttribute('aria-controls')!,
    )!;
    fireEvent.click(within(panel).getByRole('button', { name: 'Notes' }));
    expect(open).toHaveBeenCalledTimes(2);
    cleanup();

    // Local sources count with web ones.
    renderSpec({ component: 'ClaimCard', claim: 'clm_mixed' }, local);
    fireEvent.click(screen.getByRole('button', { name: /Sources \(2\)/ }));
    const list = screen.getByRole('dialog');
    expect(within(list).getByRole('link', { name: /The report/ })).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Notes' })).toBeTruthy();
  });

  it('says so when the claim is missing', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_gone' });
    expect(screen.getByText(/This finding was deleted or isn’t in this project/)).toBeTruthy();
  });
});

describe('terms', () => {
  it('matches whole words, any case, longest form first, first use only', () => {
    const matcher = termMatcher([
      term('t1', 'block'),
      term('t2', 'building block', ['building blocks']),
    ]);
    const ranges = firstUses(
      ['Building blocks and a block.', 'Another block; blockchain is not one.'],
      matcher,
    );
    expect(ranges[0]!.map((r) => [r.start, r.end, r.term.id])).toEqual([
      [0, 15, 't2'],
      [22, 27, 't1'],
    ]);
    expect(ranges[1]).toEqual([]);
  });

  it('marks the first use in a text block, never inside a link or code', () => {
    renderSpec({
      component: 'Markdown',
      content: 'See [the recipe](https://example.com) and `MCP`. A recipe uses MCP. Recipes too.',
    });
    const buttons = screen.getAllByRole('button', { name: /^(recipe|MCP)$/i });
    expect(buttons.map((b) => b.textContent)).toEqual(['recipe', 'MCP']);
    expect(screen.getByRole('link', { name: /the recipe/ }).querySelector('button')).toBeNull();
  });

  it('explains a term on tap and closes on Escape', () => {
    renderSpec({ component: 'Text', content: 'Agents talk over MCP.' });
    const button = screen.getByRole('button', { name: 'MCP' });
    fireEvent.click(button);
    const popover = screen.getByRole('dialog', { name: 'MCP' });
    expect(popover.textContent).toContain('What MCP means.');
    expect(popover.textContent).toContain('Our wording');
    fireEvent.keyDown(popover, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('links the source of a term and can be turned off', () => {
    renderSpec({ component: 'Callout', body: 'A recipe.' });
    fireEvent.click(screen.getByRole('button', { name: 'recipe' }));
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('link', { name: /Source/ })
        .getAttribute('href'),
    ).toBe('https://example.com/report');
    cleanup();
    renderSpec({ component: 'Callout', body: 'A recipe.', terms: false });
    expect(screen.queryByRole('button', { name: 'recipe' })).toBeNull();
  });

  it('marks a term once per widget across layer titles and claims', () => {
    renderSpec(stack);
    // "recipe" appears in layer 2's hint and in Kit's claim: only the hint is marked.
    expect(screen.getAllByRole('button', { name: 'recipe' })).toHaveLength(1);
    expect(screen.getByText(/Code that turns a/).querySelector('button')?.textContent).toBe(
      'recipe',
    );
  });
});

const task = (id: string, stageId: string, title: string, status: string, order = 0) =>
  ({
    id,
    type: 'task',
    data: { projectId: P, stageId, title, status, priority: 'medium', dependsOn: [], order },
    ...meta,
  }) as Entity<'task'>;

// Step A: 1 done, 2 open, 1 cancelled (left out) → "1 of 3". Step B: 6 tasks, all done.
const tasks = [
  task('task_a1', 'stg_a', 'W3.1 · Agree the test', 'done', 0),
  task('task_a2', 'stg_a', 'W3.8 · Measure the baseline', 'todo', 1),
  task('task_a3', 'stg_a', 'Write it up', 'in_progress', 2),
  task('task_a4', 'stg_a', 'W3.9 · Dropped idea', 'cancelled', 3),
  ...[1, 2, 3, 4, 5, 6].map((n) => task(`task_b${n}`, 'stg_b', `B ${n}`, 'done', n)),
];

const flow: ViewNode = {
  component: 'Layers',
  orientation: 'flow',
  layers: [
    { key: 'q', title: 'Your question about a recipe' },
    {
      key: 'a',
      title: 'AI arranges blocks',
      hint: 'It picks from a closed catalog',
      pill: { label: 'Pharos has its own', tone: 'own' },
      items: { where: { tags: 'layer-2' } },
      progress: { stageId: 'stg_a' },
    },
    {
      key: 'b',
      title: 'Pharos draws the screen',
      items: { where: { tags: 'layer-3' } },
      progress: { stageId: 'stg_b' },
    },
  ],
};

const withTasks: ProjectDataset = { ...data, tasks };

describe('Layers flow', () => {
  it('draws boxes joined by arrows; a label-only step holds no claims and is no button', () => {
    renderSpec(flow, withTasks);
    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]!.textContent).toBe('Your question about a recipe');
    expect(within(steps[0]!).queryByRole('button')).toBeNull();
    // Arrows sit between the boxes, hidden from assistive tech.
    expect(steps[0]!.querySelector('svg')).toBeNull();
    expect(steps[1]!.querySelector('[aria-hidden] svg')).toBeTruthy();
    // Nothing is open at first: no claims anywhere.
    expect(screen.queryByText('Pharos draws its own blocks.')).toBeNull();
    expect(screen.queryByText('Nobody decides what to show.')).toBeNull();
  });

  it('opens the tapped box below the row, one at a time', () => {
    renderSpec(flow, withTasks);
    const a = screen.getByRole('button', { name: /^AI arranges blocks/ });
    const b = screen.getByRole('button', { name: /^Pharos draws the screen/ });
    expect(a.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(a);
    expect(a.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(a.getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(false);
    expect(within(panel).getByText('Pharos draws its own blocks.')).toBeTruthy();
    expect(within(panel).getByText('It picks from a closed catalog')).toBeTruthy();
    fireEvent.click(b);
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(within(panel).getByText('Nobody decides what to show.')).toBeTruthy();
    expect(within(panel).queryByText('Pharos draws its own blocks.')).toBeNull();
    fireEvent.click(b);
    expect(panel.hidden).toBe(true);
  });

  it('moves between boxes with arrow keys, Home and End, skipping label-only steps', () => {
    renderSpec(flow, withTasks);
    const a = screen.getByRole('button', { name: /^AI arranges blocks/ });
    const b = screen.getByRole('button', { name: /^Pharos draws the screen/ });
    expect(a.tagName).toBe('BUTTON'); // Enter and Space work natively
    a.focus();
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: 'End' });
    expect(document.activeElement).toBe(b);
    fireEvent.keyDown(b, { key: 'Home' });
    expect(document.activeElement).toBe(a);
  });

  it('leaves terms off unless the view asks for them', () => {
    renderSpec(flow, withTasks);
    expect(screen.queryByRole('button', { name: 'recipe' })).toBeNull();
    cleanup();
    renderSpec({ ...flow, terms: true } as ViewNode, withTasks);
    expect(screen.getByRole('button', { name: 'recipe' })).toBeTruthy();
  });

  it('opens at the step named by `open`', () => {
    renderSpec({ ...flow, open: 'b' } as ViewNode, withTasks);
    expect(
      screen
        .getByRole('button', { name: /^Pharos draws the screen/ })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    expect(screen.getByText('Nobody decides what to show.')).toBeTruthy();
  });
});

describe('Layers progress', () => {
  it('counts done of the tasks not cancelled, on one scale for every step', () => {
    renderSpec(flow, withTasks);
    const a = screen.getByRole('button', { name: /^AI arranges blocks/ });
    expect(a.getAttribute('aria-labelledby')).toMatch(/progress/);
    const steps = screen.getAllByRole('listitem');
    expect(steps[1]!.textContent).toContain('1 of 3 tasks done');
    expect(steps[2]!.textContent).toContain('6 of 6 tasks done');
    // Step A's track is half the length of step B's (3 against 6 tasks); its fill is a third.
    const track = (step: HTMLElement) =>
      step.querySelector<HTMLElement>('[aria-hidden] > span[style]')!;
    expect(track(steps[1]!).style.width).toBe('50%');
    expect(track(steps[2]!).style.width).toBe('100%');
    expect((track(steps[1]!).firstElementChild as HTMLElement).style.width).toMatch(/^33\.3/);
  });

  it('counts by meaning, so a custom status named otherwise still counts', () => {
    const custom = {
      ...withTasks,
      project: {
        ...data.project,
        data: {
          ...data.project.data,
          options: {
            'task.status': [
              { value: 'open', label: 'Open', meaning: 'todo' },
              { value: 'shipped', label: 'Shipped', meaning: 'done' },
              { value: 'dropped', label: 'Dropped', meaning: 'cancelled' },
            ],
          },
        },
      },
      tasks: [
        task('task_x1', 'stg_a', 'X 1', 'shipped'),
        task('task_x2', 'stg_a', 'X 2', 'open'),
        task('task_x3', 'stg_a', 'X 3', 'dropped'),
      ],
    } as ProjectDataset;
    renderSpec(flow, custom);
    expect(screen.getAllByRole('listitem')[1]!.textContent).toContain('1 of 2 tasks done');
    fireEvent.click(screen.getByRole('button', { name: /^AI arranges blocks/ }));
    expect(screen.getByRole('button', { name: 'X 2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'X 3' })).toBeNull();
  });

  it("lists a step's open tasks without codes, each opening the task drawer", () => {
    const open = vi.fn();
    renderSpec(flow, withTasks, { apply: async () => ({ ok: false }), open });
    fireEvent.click(screen.getByRole('button', { name: /^AI arranges blocks/ }));
    const panel = screen.getByRole('region');
    const items = within(panel).getAllByRole('button', { name: /Measure|Write/ });
    expect(items.map((b) => b.textContent)).toEqual(['Measure the baseline', 'Write it up']);
    expect(panel.textContent).not.toContain('W3.8');
    expect(panel.textContent).not.toContain('Agree the test');
    expect(panel.textContent).not.toContain('Dropped idea');
    // The whole title wraps on a narrow screen instead of being cut off.
    const title = items[0]!.lastElementChild!;
    expect(title.className).toContain('whitespace-normal');
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
    fireEvent.click(items[0]!);
    expect(open).toHaveBeenCalledWith({ entity: 'task_a2' });
    // Every task done: says so instead of an empty list.
    fireEvent.click(screen.getByRole('button', { name: /^Pharos draws the screen/ }));
    expect(within(panel).getByText('All done')).toBeTruthy();
  });

  it('opens the open tasks from "x of y" in a row', () => {
    renderSpec({ ...flow, orientation: 'row' } as ViewNode, withTasks);
    expect(screen.queryByRole('button', { name: 'Measure the baseline' })).toBeNull();
    const count = screen.getByRole('button', { name: '1 of 3 tasks done' });
    expect(count.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(count);
    expect(count.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(count.getAttribute('aria-controls')!)!.textContent).toContain(
      'Measure the baseline',
    );
    // The label-only step shows no claims and no "Nothing here yet" for the progress steps.
    expect(screen.getAllByText('Nothing here yet')).toHaveLength(1);
  });

  it('shows progress in a stack header and the open tasks in the open layer', () => {
    renderSpec({ ...flow, orientation: 'stack', open: 'a' } as ViewNode, withTasks);
    const a = screen.getByRole('button', { name: /^Layer a AI arranges blocks/ });
    expect(a.getAttribute('aria-labelledby')).toMatch(/progress/);
    expect(screen.getByRole('button', { name: 'Measure the baseline' })).toBeTruthy();
    // A label-only layer is empty, not a list of every claim.
    fireEvent.click(screen.getByRole('button', { name: /^Layer q/ }));
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByText('Five layers, and the one you need is missing.')).toBeNull();
  });

  it('says "No tasks yet" for a step whose filter matches none', () => {
    renderSpec(
      {
        component: 'Layers',
        orientation: 'flow',
        layers: [
          { key: '1', title: 'One', progress: { stageId: 'stg_none' } },
          { key: '2', title: 'Two', progress: { stageId: 'stg_a' } },
        ],
      },
      withTasks,
    );
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('No tasks yet');
  });
});

describe('evidence in the mark', () => {
  const evidence = {
    ...data,
    claims: [
      claim('clm_none', { statement: 'Unsourced.' }),
      claim('clm_weak', {
        statement: 'Thin.',
        certainty: 'verified',
        sourceIds: ['art_report'],
        weakBecause: 'one-source',
      }),
      claim('clm_where', {
        statement: 'Located.',
        certainty: 'verified',
        sourceIds: ['art_local'],
        quote: 'Every answer cites its file.',
        locator: '§2 Metrics',
      }),
    ],
  } as ProjectDataset;

  it('says "no source yet" in grey when a claim has none', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_none' }, evidence);
    expect(screen.getByText('no source yet').className).toMatch(/neutral-400/);
    cleanup();
    renderSpec({ component: 'ClaimCard', claim: 'clm_weak' }, evidence);
    expect(screen.queryByText('no source yet')).toBeNull();
  });

  it('names why the evidence is weak after the mark', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_weak' }, evidence);
    expect(screen.getByText('one source')).toBeTruthy();
  });

  it('shows the locator with the quote, in the card and in the source list (F2)', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_where' }, evidence);
    fireEvent.click(screen.getByRole('button', { name: 'Quote' }));
    const panel = document.getElementById(
      screen.getByRole('button', { name: 'Quote' }).getAttribute('aria-controls')!,
    )!;
    expect(panel.querySelector('figcaption')!.textContent).toBe('—Notes·§2 Metrics');
    fireEvent.click(screen.getByRole('button', { name: 'Source' }));
    expect(within(screen.getByRole('dialog')).getByText('§2 Metrics')).toBeTruthy();
  });
});
