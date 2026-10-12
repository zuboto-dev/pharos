import type { Entity, ProjectDataset, ViewNode } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider } from './context';
import { ViewRenderer } from './renderer';
import { firstUses, termMatcher, termPieces } from './terms';

afterEach(cleanup);

const base = dataset as unknown as ProjectDataset;

const term = (id: string, word: string) =>
  ({
    id,
    type: 'term',
    data: { projectId: base.project.id, word, explanation: `What ${word} means.`, alsoCalled: [] },
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    createdRev: 1,
    updatedRev: 1,
  }) as Entity<'term'>;

const terms = [term('term_mcp', 'MCP'), term('term_recipe', 'recipe')];

function renderSpec(spec: ViewNode) {
  return render(
    <ViewDataProvider data={{ ...base, terms }} version={1}>
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
}

/** The element that keeps a marked word on one line with its punctuation. */
const glue = (name: string) => screen.getByRole('button', { name }).parentElement!;

describe('punctuation around terms', () => {
  it('keeps the punctuation that touches a term with it, and nothing else', () => {
    const text = 'Use (MCP), then a recipe; done. A recipe again';
    const [ranges] = firstUses([text], termMatcher(terms));
    expect(termPieces(text, ranges!)).toEqual([
      'Use ',
      { term: terms[0], before: '(', word: 'MCP', after: '),' },
      ' then a ',
      { term: terms[1], before: '', word: 'recipe', after: ';' },
      ' done. A recipe again',
    ]);
  });

  it('leaves a term with no punctuation as it was', () => {
    const text = 'MCP and recipe';
    const [ranges] = firstUses([text], termMatcher(terms));
    expect(termPieces(text, ranges!)).toEqual([
      { term: terms[0], before: '', word: 'MCP', after: '' },
      ' and ',
      { term: terms[1], before: '', word: 'recipe', after: '' },
    ]);
  });

  it('never wraps a comma or semicolon alone onto the next line in plain text', () => {
    renderSpec({ component: 'Text', content: 'Agents talk over MCP, and a recipe; that is all.' });
    expect(glue('MCP').className).toContain('whitespace-nowrap');
    expect(glue('MCP').textContent).toBe('MCP,');
    expect(glue('recipe').textContent).toBe('recipe;');
  });

  it('does the same in Markdown, including brackets', () => {
    renderSpec({ component: 'Markdown', content: 'Agents talk (over MCP). A **recipe**: steps.' });
    expect(glue('MCP').className).toContain('whitespace-nowrap');
    expect(glue('MCP').textContent).toBe('MCP).');
    expect(glue('MCP').closest('p')!.textContent).toBe('Agents talk (over MCP). A recipe: steps.');
  });

  it('adds no wrapper when nothing touches the term', () => {
    renderSpec({ component: 'Markdown', content: 'Agents talk over MCP here.' });
    expect(glue('MCP').tagName).toBe('P');
  });
});
