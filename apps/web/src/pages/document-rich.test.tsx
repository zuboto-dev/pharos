import { ReportDoc, type Entity, type ProjectDataset } from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { Node as CatalogNode } from '../catalog/renderer';
import { VariantProvider } from '../catalog/variant';
import { DocumentView } from './document';
import {
  assetUrl,
  deskSummary,
  figureLayout,
  formatMinutes,
  parseMinutes,
  sheetState,
  type Figure,
  type Sheet,
} from './document-rich';

// R15 (docs/reframe/r15-review-documents.md): figures, steps, details, sheets and the review
// desk in a report document, copy buttons, and answering inside a document. Made-up data only.

const base = dataset as unknown as ProjectDataset;
const [board] = base.views as Entity<'view'>[];
const meta = {
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
  createdRev: 3,
  updatedRev: 3,
};

function decision(
  id: string,
  title: string,
  extra: Partial<Entity<'decision'>['data']> = {},
): Entity<'decision'> {
  return {
    id,
    type: 'decision',
    data: {
      projectId: base.project.id,
      title,
      status: 'proposed',
      options: [
        { id: 'keep', label: 'Keep the list', summary: 'Rows as they are' },
        { id: 'cards', label: 'Use cards', summary: 'One card per item' },
      ],
      recommendedOptionId: 'cards',
      ...extra,
    },
    ...meta,
  };
}

const DECISIONS = [
  decision('dec_layout', 'Which layout should the inbox use?'),
  decision('dec_sound', 'Is the new chime calm enough?'),
];

const doc = ReportDoc.parse({
  summary: 'Three things to look at in the made-up inbox app.',
  blocks: [
    {
      kind: 'block',
      id: 'intro',
      node: { component: 'Markdown', content: '# Inbox review\n\nThree items.' },
    },
    {
      kind: 'sheet',
      id: 'layout',
      title: 'Inbox layout',
      time: '10 min',
      tags: ['review'],
      decisions: ['dec_layout'],
      blocks: [
        {
          kind: 'block',
          id: 'layout-lede',
          node: { component: 'Markdown', content: 'The list scrolled sideways on phones.' },
        },
        {
          kind: 'figure',
          id: 'shots',
          layout: 'pair',
          items: [
            { src: 'shots/before.png', alt: 'Inbox before', caption: '**Before.** Sideways.' },
            { src: 'shots/after.png', alt: 'Inbox after', caption: '**After.** One column.' },
          ],
          caption: 'Same data, two layouts.',
        },
        {
          kind: 'block',
          id: 'layout-choice',
          node: { component: 'DecisionBlock', decision: 'dec_layout' },
        },
      ],
    },
    {
      kind: 'sheet',
      id: 'check',
      title: 'Try it yourself',
      time: '1.5 hours',
      blocks: [
        {
          kind: 'steps',
          id: 'how',
          title: 'How to check',
          items: [
            { text: 'Start the **made-up** app.', command: 'npm run demo', expect: 'A list.' },
            { text: 'Open the inbox.' },
          ],
        },
        {
          kind: 'details',
          id: 'why',
          summary: 'Why one column',
          blocks: [
            {
              kind: 'block',
              id: 'why-text',
              node: { component: 'Markdown', content: 'Phones are narrow.' },
            },
          ],
        },
        {
          kind: 'details',
          id: 'raw',
          summary: 'Raw numbers',
          open: true,
          blocks: [
            {
              kind: 'block',
              id: 'raw-code',
              node: { component: 'Markdown', content: '```\nrows: 12\nwidth: 390\n```' },
            },
          ],
        },
      ],
    },
    {
      kind: 'sheet',
      id: 'sound',
      title: 'New chime',
      time: 'a while',
      tags: ['listen'],
      decisions: ['dec_sound'],
      blocks: [
        {
          kind: 'figure',
          id: 'chime',
          items: [{ src: 'sounds/chime.wav', alt: 'The new chime' }],
        },
        {
          kind: 'block',
          id: 'chime-choice',
          node: { component: 'DecisionBlock', decision: 'dec_sound' },
        },
        { kind: 'block', id: 'todo', node: { component: 'TaskChecklist', hideDone: false } },
      ],
    },
    {
      kind: 'figure',
      id: 'phones',
      layout: 'phone',
      items: [
        { src: 'shots/phone-1.png', alt: 'Phone, list' },
        { src: 'shots/phone-2.png', alt: 'Phone, item' },
        { src: 'shots/phone-3.png', alt: 'Phone, settings' },
      ],
    },
    {
      kind: 'figure',
      id: 'many',
      items: [
        { src: 'shots/a.png', alt: 'A' },
        { src: 'shots/b.png', alt: 'B' },
        { src: 'clips/walk.mp4', alt: 'A walkthrough clip' },
      ],
    },
    {
      kind: 'figure',
      id: 'slide',
      layout: 'compare',
      items: [
        { src: 'shots/before.png', alt: 'Before', caption: 'Before' },
        { src: 'shots/after.png', alt: 'After', caption: 'After' },
      ],
    },
  ],
});

const docView: Entity<'view'> = {
  ...board!,
  id: 'view_r15',
  updatedAt: '2026-10-20T09:00:00.000Z',
  data: { ...board!.data, name: 'Inbox review', spec: undefined, doc },
};

const dataWith = (decisions: Entity<'decision'>[]): ProjectDataset => ({
  ...base,
  decisions: [...base.decisions, ...decisions],
  views: [docView, ...base.views],
});

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 10, created: {} }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { headers: { 'content-type': 'application/json' } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Providers({
  children,
  data = dataWith(DECISIONS),
  version = 1,
}: {
  children: ReactNode;
  data?: ProjectDataset;
  version?: number;
}) {
  return (
    <MemoryRouter>
      <ViewDataProvider data={data} version={version} actions={{ apply, open: vi.fn() }}>
        {children}
      </ViewDataProvider>
    </MemoryRouter>
  );
}

const showDoc = (data?: ProjectDataset) =>
  render(
    <Providers data={data}>
      <DocumentView view={docView} />
    </Providers>,
  );

const block = (id: string) => document.querySelector<HTMLElement>(`[data-doc-block="${id}"]`)!;
const sheets = doc.blocks.filter((b): b is Sheet => b.kind === 'sheet');

describe('review desk maths', () => {
  it('reads minutes and hours from a sheet time', () => {
    expect(parseMinutes('10 min')).toBe(10);
    expect(parseMinutes('1 h')).toBe(60);
    expect(parseMinutes('1.5 hours')).toBe(90);
    expect(parseMinutes('1,5 h')).toBe(90);
    expect(parseMinutes('1 h 30 min')).toBe(90);
    expect(parseMinutes('45m')).toBe(45);
    expect(parseMinutes('2 hrs')).toBe(120);
    expect(parseMinutes('5 minutes')).toBe(5);
    expect(parseMinutes('a while')).toBeUndefined();
    expect(parseMinutes('3 months')).toBeUndefined();
    expect(parseMinutes(undefined)).toBeUndefined();
  });

  it('writes a total as minutes, or hours and minutes', () => {
    expect(formatMinutes(25)).toBe('25 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(100)).toBe('1 h 40 min');
  });

  it('a sheet is answered once each of its decisions has a choice or an answer', () => {
    const [layout, check] = sheets;
    expect(sheetState(check!, DECISIONS)).toBe('none');
    expect(sheetState(layout!, DECISIONS)).toBe('open');
    expect(sheetState(layout!, [decision('dec_layout', 'q', { chosenOptionId: 'keep' })])).toBe(
      'answered',
    );
    expect(sheetState(layout!, [decision('dec_layout', 'q', { answer: 'Neither' })])).toBe(
      'answered',
    );
    // Deciding later isn't an answer; a decision that isn't there can't be answered.
    expect(
      sheetState(layout!, [decision('dec_layout', 'q', { deferredUntil: '2026-11-01' })]),
    ).toBe('open');
    expect(sheetState(layout!, [])).toBe('open');
    const two = { ...layout!, decisions: ['dec_layout', 'dec_sound'] };
    expect(sheetState(two, [decision('dec_layout', 'q', { chosenOptionId: 'keep' })])).toBe('open');
  });

  it('sums the times it can read and counts progress over sheets with decisions', () => {
    const desk = deskSummary(sheets, DECISIONS);
    expect(desk).toMatchObject({ items: 3, minutes: 100, asked: 2, answered: 0 });
    const after = deskSummary(sheets, [
      decision('dec_layout', 'q', { chosenOptionId: 'cards' }),
      DECISIONS[1]!,
    ]);
    expect(after).toMatchObject({ asked: 2, answered: 1 });
    const none = deskSummary(
      sheets.map((s) => ({ ...s, time: 'soon' })),
      DECISIONS,
    );
    expect(none.minutes).toBeUndefined();
  });
});

describe('review desk in a document (R15)', () => {
  it('draws the header above the first sheet: items, minutes, progress, chips', () => {
    showDoc();
    const article = document.querySelector('article')!;
    const order = [...article.children].map(
      (el) =>
        el.getAttribute('data-doc-block') ?? (el.hasAttribute('data-review-desk') ? 'desk' : ''),
    );
    expect(order.slice(0, 3)).toEqual(['intro', 'desk', 'layout']);
    const desk = article.querySelector<HTMLElement>('[data-review-desk]')!;
    expect(desk.querySelector('[data-needs-you]')?.textContent).toBe(
      'Needs you: 3 items, about 1 h 40 min',
    );
    expect(desk.querySelector('[data-progress]')?.textContent).toBe('0 of 2 answered');
    const bar = within(desk).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    const chips = [...desk.querySelectorAll<HTMLAnchorElement>('[data-chip]')];
    expect(chips.map((c) => [c.textContent, c.getAttribute('href'), c.dataset.state])).toEqual([
      ['Inbox layout, open', '#sheet-layout', 'open'],
      ['Try it yourself', '#sheet-check', 'none'],
      ['New chime, open', '#sheet-sound', 'open'],
    ]);
    // Each chip's target is the sheet's anchor.
    expect(document.getElementById('sheet-layout')).toBe(block('layout'));
  });

  it('a sheet has a frame, its title, time, tags and a state pill', () => {
    showDoc();
    const layout = block('layout');
    expect(layout.tagName).toBe('SECTION');
    expect(layout.classList.contains('doc-sheet')).toBe(true);
    expect(within(layout).getByRole('heading', { level: 2 }).textContent).toBe('Inbox layout');
    const pills = [...layout.querySelectorAll<HTMLElement>('[data-pill]')].map((p) => [
      p.dataset.pill,
      p.textContent,
    ]);
    expect(pills).toEqual([
      ['time', '10 min'],
      ['tag', 'review'],
      ['state', 'Open'],
    ]);
    // A sheet without decisions has no state pill.
    expect(block('check').querySelector('[data-pill="state"]')).toBeNull();
    expect(block('check').dataset.state).toBe('none');
  });

  it('leaves the minutes out when no time can be read, and has no header for one sheet', () => {
    const noTimes = {
      ...docView,
      data: {
        ...docView.data,
        doc: {
          ...doc,
          blocks: doc.blocks.map((b) => (b.kind === 'sheet' ? { ...b, time: 'soon' } : b)),
        },
      },
    };
    render(
      <Providers>
        <DocumentView view={noTimes} />
      </Providers>,
    );
    expect(document.querySelector('[data-needs-you]')?.textContent).toBe('Needs you: 3 items');
    cleanup();
    const one = {
      ...docView,
      data: { ...docView.data, doc: { ...doc, blocks: doc.blocks.slice(0, 2) } },
    };
    render(
      <Providers>
        <DocumentView view={one} />
      </Providers>,
    );
    expect(document.querySelector('[data-review-desk]')).toBeNull();
    expect(block('layout').querySelector('[data-pill="state"]')?.textContent).toBe('Open');
  });

  it('answers flip the sheet state and the header live (data reloaded from the feed)', () => {
    const { rerender } = showDoc();
    const answered = [decision('dec_layout', 'q', { chosenOptionId: 'cards' }), DECISIONS[1]!];
    rerender(
      <Providers data={dataWith(answered)} version={2}>
        <DocumentView view={docView} />
      </Providers>,
    );
    expect(block('layout').dataset.state).toBe('answered');
    expect(block('layout').querySelector('[data-pill="state"]')?.textContent).toBe('Answered');
    expect(document.querySelector('[data-progress]')?.textContent).toBe('1 of 2 answered');
    expect(document.querySelector<HTMLElement>('[data-chip="layout"]')?.dataset.state).toBe(
      'answered',
    );
    expect(document.querySelector<HTMLElement>('[data-chip="sound"]')?.dataset.state).toBe('open');
    rerender(
      <Providers
        data={dataWith([answered[0]!, decision('dec_sound', 'q', { answer: 'Softer, please' })])}
        version={3}
      >
        <DocumentView view={docView} />
      </Providers>,
    );
    expect(document.querySelector('[data-progress]')?.textContent).toBe('2 of 2 answered');
    expect(document.querySelector('.doc-desk-fill')?.classList.contains('is-done')).toBe(true);
  });

  it('a chip scrolls to its sheet', () => {
    showDoc();
    const target = block('sound');
    const scroll = vi.fn();
    target.scrollIntoView = scroll;
    fireEvent.click(document.querySelector('[data-chip="sound"]')!);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
  });
});

describe('answering in a document (R15)', () => {
  it('DecisionBlock: choose, write another answer, decide later', () => {
    showDoc();
    const sheet = block('layout');
    expect(within(sheet).getByRole('button', { name: 'Write another answer' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Decide later' })).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Choose Use cards' }));
    expect(apply).toHaveBeenCalledTimes(1);
    const [message, ops, options] = apply.mock.calls[0]!;
    expect(message).toContain('Use cards');
    expect(ops.at(-1)).toMatchObject({
      op: 'update',
      type: 'decision',
      id: 'dec_layout',
      data: { chosenOptionId: 'cards' },
    });
    expect(options).toEqual({ undoable: true });
  });

  it('DecisionBlock: an answer can be changed in a document', () => {
    showDoc(dataWith([decision('dec_layout', 'q', { chosenOptionId: 'keep' }), DECISIONS[1]!]));
    const change = within(block('layout')).getByRole('button', { name: 'Change' });
    fireEvent.click(change);
    expect(apply.mock.calls[0]![1].at(-1)).toMatchObject({
      id: 'dec_layout',
      data: { chosenOptionId: null, answer: null },
    });
  });

  it('TaskChecklist: a tick marks the task done; no quick add or Start', () => {
    showDoc();
    const list = block('todo');
    const tick = list.querySelector<HTMLButtonElement>('button[aria-label^="Mark “"]')!;
    expect(tick).toBeTruthy();
    fireEvent.click(tick);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![1][0]).toMatchObject({ op: 'update', type: 'task' });
    const labels = [...list.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Start');
    expect(labels.some((l) => /^Add /.test(l ?? ''))).toBe(false);
  });

  it('structure edits stay hidden in a document; a board keeps them', () => {
    const inVariant = (variant: 'board' | 'document', component: 'TaskTable' | 'KanbanBoard') => {
      const r = render(
        <Providers>
          <VariantProvider variant={variant}>
            <CatalogNode node={{ component }} />
          </VariantProvider>
        </Providers>,
      );
      const found = {
        add: [...r.container.querySelectorAll('button')].some((b) =>
          /^Add /.test(b.textContent?.trim() ?? ''),
        ),
        drag: r.container.querySelector('[draggable="true"]') !== null,
        check: r.container.querySelector('button[aria-label^="Mark “"]') !== null,
      };
      r.unmount();
      return found;
    };
    // TaskTable's done toggle isn't a checklist tick: it stays a mark in a document.
    expect(inVariant('document', 'TaskTable')).toEqual({ add: false, drag: false, check: false });
    expect(inVariant('board', 'TaskTable')).toMatchObject({ add: true, check: true });
    expect(inVariant('document', 'KanbanBoard')).toMatchObject({ add: false, drag: false });
    expect(inVariant('board', 'KanbanBoard')).toMatchObject({ add: true, drag: true });
  });
});

describe('figures (R15)', () => {
  it('picks a layout: its own, else by the number of items; compare needs two pictures', () => {
    const fig = (items: number, layout?: Figure['layout'], ext = 'png'): Figure => ({
      kind: 'figure',
      id: 'f',
      layout,
      items: Array.from({ length: items }, (_, i) => ({ src: `a${i}.${ext}`, alt: 'x' })),
    });
    expect(figureLayout(fig(1))).toBe('single');
    expect(figureLayout(fig(2))).toBe('pair');
    expect(figureLayout(fig(5))).toBe('grid');
    expect(figureLayout(fig(3, 'phone'))).toBe('phone');
    expect(figureLayout(fig(2, 'compare'))).toBe('compare');
    expect(figureLayout(fig(3, 'compare'))).toBe('pair');
    expect(figureLayout(fig(1, 'compare'))).toBe('single');
    expect(figureLayout(fig(2, 'compare', 'mp4'))).toBe('pair');
  });

  it('loads uploaded files from the assets route, pictures lazily', () => {
    expect(assetUrl('view_r15', 'shots/a b.png')).toBe(
      '/api/views/view_r15/assets/shots/a%20b.png',
    );
    expect(assetUrl('view_r15', 'a.png', 2)).toBe('/api/views/view_r15/assets/a.png?r=2');
    showDoc();
    const pair = block('shots');
    expect(pair.dataset.docFigure).toBe('pair');
    const imgs = [...pair.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual([
      '/api/views/view_r15/assets/shots/before.png',
      '/api/views/view_r15/assets/shots/after.png',
    ]);
    expect(imgs.every((i) => i.getAttribute('loading') === 'lazy')).toBe(true);
    expect(imgs.map((i) => i.alt)).toEqual(['Inbox before', 'Inbox after']);
    // Item captions and the figure's caption are markdown.
    expect(pair.querySelector('figcaption strong')?.textContent).toBe('Before.');
    expect(pair.textContent).toContain('Same data, two layouts.');
    expect(block('phones').dataset.docFigure).toBe('phone');
    expect(block('phones').querySelectorAll('img')).toHaveLength(3);
    expect(block('many').dataset.docFigure).toBe('grid');
  });

  it('video and audio get their controls and never play by themselves', () => {
    showDoc();
    const video = block('many').querySelector('video')!;
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.getAttribute('src')).toBe('/api/views/view_r15/assets/clips/walk.mp4');
    const audio = block('chime').querySelector('audio')!;
    expect(audio.hasAttribute('controls')).toBe(true);
    expect(audio.hasAttribute('autoplay')).toBe(false);
    expect(audio.getAttribute('aria-label')).toBe('The new chime');
    expect(block('chime').dataset.docFigure).toBe('single');
  });

  it('a picture opens full size in a dialog with its caption; Escape or a click closes it', () => {
    showDoc();
    const open = within(block('shots')).getByRole('button', {
      name: 'Inbox before: open full size',
    });
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'Inbox before' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe(
      '/api/views/view_r15/assets/shots/before.png',
    );
    expect(dialog.textContent).toContain('Before. Sideways.');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(
      within(block('shots')).getByRole('button', { name: 'Inbox after: open full size' }),
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('compare: two pictures with an accessible slider between them', () => {
    showDoc();
    const slide = block('slide');
    expect(slide.dataset.docFigure).toBe('compare');
    const slider = within(slide).getByRole('slider', { name: 'Compare the two pictures' });
    expect(slider.getAttribute('aria-valuetext')).toBe('50% Before, 50% After');
    fireEvent.change(slider, { target: { value: '30' } });
    expect(slide.querySelector<HTMLElement>('.doc-compare')!.style.getPropertyValue('--at')).toBe(
      '30%',
    );
    expect(slider.getAttribute('aria-valuetext')).toBe('30% Before, 70% After');
    fireEvent.click(within(slide).getByRole('button', { name: 'After: open full size' }));
    expect(screen.getByRole('dialog', { name: 'After' })).toBeTruthy();
  });
});

describe('steps, copy and details (R15)', () => {
  it('numbers the steps, with a command to copy and what the reader should see', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      showDoc();
      const how = block('how');
      expect(how.querySelector('h3')?.textContent).toBe('How to check');
      const steps = [...how.querySelectorAll<HTMLElement>('[data-step]')];
      expect(steps.map((s) => s.dataset.step)).toEqual(['1', '2']);
      expect(steps[0]!.querySelector('.doc-step-number')?.textContent).toBe('1');
      expect(steps[0]!.querySelector('strong')?.textContent).toBe('made-up');
      expect(steps[0]!.querySelector('pre')?.textContent).toBe('npm run demo');
      expect(steps[0]!.querySelector('[data-step-expect]')?.textContent).toContain('A list.');
      expect(steps[1]!.querySelector('[data-copy]')).toBeNull();
      const copy = within(steps[0]!).getByRole('button', { name: 'Copy command' });
      expect(copy.textContent).toBe('Copy');
      await act(async () => {
        fireEvent.click(copy);
      });
      expect(write).toHaveBeenCalledWith('npm run demo');
      expect(copy.textContent).toBe('Copied');
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(copy.textContent).toBe('Copy');
    } finally {
      vi.useRealTimers();
    }
  });

  it('code blocks in Markdown get a copy button in a document, not on a board', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: write } });
    showDoc();
    const raw = block('raw-code');
    const copy = within(raw).getByRole('button', { name: 'Copy code' });
    await act(async () => {
      fireEvent.click(copy);
    });
    expect(write).toHaveBeenCalledWith('rows: 12\nwidth: 390');
    cleanup();
    render(
      <Providers>
        <CatalogNode node={{ component: 'Markdown', content: '```\nx\n```' }} />
      </Providers>,
    );
    expect(document.querySelector('pre')).toBeTruthy();
    expect(document.querySelector('[data-copy]')).toBeNull();
  });

  it('details are native, closed unless open is set', () => {
    showDoc();
    const why = block('why');
    expect(why.tagName).toBe('DETAILS');
    expect(why.hasAttribute('open')).toBe(false);
    expect(why.querySelector('summary')?.textContent).toBe('Why one column');
    expect(why.textContent).toContain('Phones are narrow.');
    expect(block('raw').hasAttribute('open')).toBe(true);
  });
});
