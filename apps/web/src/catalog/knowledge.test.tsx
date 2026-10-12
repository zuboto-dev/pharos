import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
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

function renderSpec(spec: ViewNode, d: ProjectDataset = data) {
  return render(
    <ViewDataProvider data={d} version={1}>
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
