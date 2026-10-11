// Findings and explanation blocks · 2026-10-11 · GPT-6-Astra · commit 75c8964
import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';

afterEach(cleanup);

const base = fixture as unknown as ProjectDataset;
const projectId = base.project.id;
const meta = {
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  createdRev: 1,
  updatedRev: 1,
};

function artifact(id: string, title: string, uri?: string): Entity<'artifact'> {
  return {
    id,
    type: 'artifact',
    data: {
      projectId,
      title,
      kind: 'link',
      status: 'delivered',
      ...(uri ? { uri } : {}),
    },
    ...meta,
  } as Entity<'artifact'>;
}

function claim(id: string, fields: Partial<Entity<'claim'>['data']> = {}): Entity<'claim'> {
  return {
    id,
    type: 'claim',
    data: {
      projectId,
      statement: `Finding ${id}`,
      certainty: 'reading',
      checkedOn: '2026-10-11',
      sourceIds: [],
      tags: [],
      order: 0,
      ...fields,
    },
    ...meta,
  } as Entity<'claim'>;
}

function term(id: string, word: string): Entity<'term'> {
  return {
    id,
    type: 'term',
    data: { projectId, word, explanation: `Meaning of ${word}.`, alsoCalled: [] },
    ...meta,
  } as Entity<'term'>;
}

function dataWith({
  artifacts = [],
  claims = [],
  project = base.project,
  terms = [],
}: {
  artifacts?: Entity<'artifact'>[];
  claims?: Entity<'claim'>[];
  project?: ProjectDataset['project'];
  terms?: Entity<'term'>[];
} = {}): ProjectDataset {
  return { ...base, project, artifacts, claims, terms };
}

function renderSpec(spec: ViewNode, data: ProjectDataset = dataWith()) {
  return render(
    <ViewDataProvider data={data} version={1}>
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
}

describe('ClaimCard from the slice-1 contract', () => {
  it('renders the stored finding, detail, certainty word, and linked source', () => {
    const source = artifact('art_spec', 'Specification', 'https://example.test/spec');
    const finding = claim('clm_spec', {
      statement: 'The stored finding is the page heading.',
      detail: 'Its detail stays beneath the statement.',
      certainty: 'verified',
      sourceIds: [source.id],
    });
    renderSpec(
      { component: 'ClaimCard', claim: finding.id, size: 'headline', kicker: 'Map' },
      dataWith({ artifacts: [source], claims: [finding] }),
    );

    expect(screen.getByRole('heading', { name: finding.data.statement })).toBeTruthy();
    expect(screen.getByText(finding.data.detail!)).toBeTruthy();
    const mark = screen.getByRole('button', { name: /From source,/ });
    expect(mark.textContent).toContain('●');
    const link = screen.getByRole('link', { name: /^Source/ });
    expect(link.getAttribute('href')).toBe('https://example.test/spec');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows the specified empty state when the referenced finding is absent', () => {
    renderSpec({ component: 'ClaimCard', claim: 'clm_deleted' });
    expect(screen.getByText('This finding was deleted or isn’t in this project')).toBeTruthy();
  });

  it('keeps the whole allowed statement and detail visible when both are long', () => {
    const statement = 'S'.repeat(200);
    const detail = 'D'.repeat(400);
    expect(statement).toHaveLength(200);
    expect(detail).toHaveLength(400);
    const finding = claim('clm_long', { statement, detail });
    renderSpec(
      { component: 'ClaimCard', claim: finding.id, size: 'headline' },
      dataWith({ claims: [finding] }),
    );

    expect(screen.getByRole('heading', { name: statement }).textContent).toBe(statement);
    expect(screen.getByText(detail).textContent).toBe(detail);
  });

  it('does not invent a link when a source id is unknown', () => {
    const finding = claim('clm_orphan_source', { sourceIds: ['art_missing'] });
    renderSpec({ component: 'ClaimCard', claim: finding.id }, dataWith({ claims: [finding] }));

    expect(screen.getByText(finding.data.statement)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button', { name: /Sources? \(/ })).toBeNull();
  });

  it('labels a known non-http source as unlinked in the certainty details', () => {
    const source = artifact('art_local', 'Local notes', 'notes/research.md');
    const finding = claim('clm_local_source', { sourceIds: [source.id] });
    renderSpec(
      { component: 'ClaimCard', claim: finding.id },
      dataWith({ artifacts: [source], claims: [finding] }),
    );

    expect(screen.queryByRole('link')).toBeNull();
    const mark = screen.getByRole('button', { name: /Our reading,/ });
    fireEvent.click(mark);
    const popover = screen.getByRole('dialog');
    expect(within(popover).getByText(/Local notes/)).toBeTruthy();
    expect(within(popover).queryByRole('link')).toBeNull();
  });

  it('uses a renamed certainty label while keeping the glyph tied to its meaning', () => {
    const source = artifact('art_renamed', 'Reference', 'https://example.test/reference');
    const finding = claim('clm_renamed', {
      certainty: 'checked',
      sourceIds: [source.id],
    });
    const project = {
      ...base.project,
      data: {
        ...base.project.data,
        options: {
          'claim.certainty': [
            { value: 'reading', label: 'Our reading', meaning: 'reading' },
            { value: 'checked', label: 'Checked here', meaning: 'verified' },
            { value: 'confirmed', label: 'Confirmed by you', meaning: 'confirmed' },
          ],
        },
      },
    } as ProjectDataset['project'];
    renderSpec(
      { component: 'ClaimCard', claim: finding.id },
      dataWith({ project, artifacts: [source], claims: [finding] }),
    );

    const mark = screen.getByRole('button', { name: /Checked here,/ });
    expect(mark.textContent).toContain('●');
  });
});

describe('Layers from the slice-1 contract', () => {
  it('shows the empty-layer message when no claims match', () => {
    renderSpec({
      component: 'Layers',
      open: 'A',
      layers: [
        { key: 'A', title: 'First step', items: { where: { tags: 'first' } } },
        { key: 'B', title: 'Second step', items: { where: { tags: 'second' } } },
      ],
    });
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });

  it('renders a matching claim in a populated open layer', () => {
    const finding = claim('clm_layer', {
      statement: 'This line has no tool attached.',
      tags: ['first'],
    });
    renderSpec(
      {
        component: 'Layers',
        open: 'A',
        layers: [
          { key: 'A', title: 'First step', items: { where: { tags: 'first' } } },
          { key: 'B', title: 'Second step', items: { where: { tags: 'second' } } },
        ],
      },
      dataWith({ claims: [finding] }),
    );

    expect(screen.getByText(finding.data.statement)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Our reading,/ })).toBeTruthy();
  });

  it('opens one layer at a time and closes the open layer on a second tap', () => {
    renderSpec({
      component: 'Layers',
      open: 'A',
      layers: [
        { key: 'A', title: 'First step', items: { where: { tags: 'first' } } },
        { key: 'B', title: 'Second step', items: { where: { tags: 'second' } } },
      ],
    });
    const first = screen.getByRole('button', { name: /^Layer A First step/ });
    const second = screen.getByRole('button', { name: /^Layer B Second step/ });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(second.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(second);
    expect(second.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps a pill claim mark even when the layer items share one mark', () => {
    const source = artifact('art_shared', 'Shared source', 'https://example.test/shared');
    const pillFinding = claim('clm_pill', {
      statement: 'A claim attached to the layer label.',
      certainty: 'verified',
      checkedOn: '2026-06-10',
      sourceIds: [source.id],
    });
    const items = ['one', 'two'].map((key, order) =>
      claim(`clm_${key}`, {
        statement: `Item ${key}.`,
        certainty: 'verified',
        checkedOn: '2026-06-10',
        sourceIds: [source.id],
        tags: ['shared'],
        order,
      }),
    );
    renderSpec(
      {
        component: 'Layers',
        open: 'A',
        layers: [
          {
            key: 'A',
            title: 'First step',
            pill: { label: 'Here', tone: 'own', claim: pillFinding.id },
            items: { where: { tags: 'shared' } },
          },
          { key: 'B', title: 'Second step', items: { where: { tags: 'none' } } },
        ],
      },
      dataWith({ artifacts: [source], claims: [pillFinding, ...items] }),
    );

    // The shared line represents the two layer items; the pill keeps its own certainty mark.
    expect(screen.getAllByRole('button', { name: /From source,/ })).toHaveLength(2);
    expect(screen.getByText(pillFinding.data.statement)).toBeTruthy();
  });

  it.each([
    { difference: 'certainty', second: { certainty: 'reading' as const } },
    { difference: 'checked date', second: { checkedOn: '2026-06-11' } },
    { difference: 'source', second: { sourceIds: ['art_other'] } },
  ])('keeps separate marks when item claims differ in $difference', ({ second }) => {
    const firstSource = artifact('art_first', 'First source', 'https://example.test/first');
    const otherSource = artifact('art_other', 'Other source', 'https://example.test/other');
    const first = claim('clm_first', {
      certainty: 'verified',
      checkedOn: '2026-06-10',
      sourceIds: [firstSource.id],
      tags: ['first'],
    });
    const secondClaim = claim('clm_second', {
      certainty: 'verified',
      checkedOn: '2026-06-10',
      sourceIds: [firstSource.id],
      tags: ['second'],
      ...second,
    });
    renderSpec(
      {
        component: 'Layers',
        orientation: 'row',
        layers: [
          { key: 'A', title: 'First step', items: { where: { tags: 'first' } } },
          { key: 'B', title: 'Second step', items: { where: { tags: 'second' } } },
        ],
      },
      dataWith({
        artifacts: [firstSource, otherSource],
        claims: [first, secondClaim],
      }),
    );

    expect(screen.getAllByRole('button', { name: /Our reading,|From source,/ })).toHaveLength(2);
  });

  it('renders the configured warning tag inside its tool card', () => {
    const tool = artifact('art_tool', 'Tool', 'https://example.test/tool');
    const warning = claim('clm_warning', {
      statement: 'This tool needs care.',
      aboutId: tool.id,
      tags: ['watch-this'],
    });
    renderSpec(
      {
        component: 'Layers',
        open: 'A',
        warnTag: 'watch-this',
        layers: [
          { key: 'A', title: 'First step', items: { where: { tags: 'watch-this' } } },
          { key: 'B', title: 'Second step', items: { where: { tags: 'none' } } },
        ],
      },
      dataWith({ artifacts: [tool], claims: [warning] }),
    );

    expect(screen.getByRole('heading', { name: 'Tool' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toContain(warning.data.statement);
  });

  it('links the first http(s) source even when an earlier source has no web URI', () => {
    const local = artifact('art_local_first', 'Local notes', 'notes/research.md');
    const web = artifact('art_web_second', 'Web source', 'https://example.test/source');
    const finding = claim('clm_http_source', {
      sourceIds: [local.id, web.id],
    });
    renderSpec(
      { component: 'ClaimCard', claim: finding.id },
      dataWith({ artifacts: [local, web], claims: [finding] }),
    );

    const link = screen.getByRole('link', { name: /^Source/ });
    expect(link.getAttribute('href')).toBe('https://example.test/source');
  });

  it('explains a term on first use and leaves linked and code text unmarked', () => {
    const recipe = term('trm_recipe', 'recipe');
    renderSpec(
      {
        component: 'Markdown',
        content:
          'A recipe starts here. [recipe link](https://example.test/recipe), `recipe`, and recipe again.',
      },
      dataWith({ terms: [recipe] }),
    );

    const marked = screen.getAllByRole('button', { name: 'recipe' });
    expect(marked).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'recipe link' }).querySelector('button')).toBeNull();
    expect(screen.getByText('recipe', { selector: 'code' })).toBeTruthy();
  });

  it('closes a term explanation on Escape', () => {
    const recipe = term('trm_recipe', 'recipe');
    renderSpec({ component: 'Text', content: 'A recipe helps.' }, dataWith({ terms: [recipe] }));
    const button = screen.getByRole('button', { name: 'recipe' });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'recipe' });
    expect(dialog.textContent).toContain('Meaning of recipe.');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
