import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askInPanel, entityTypeIn } from './AgentDock';
import { AgentPanelButton } from './AgentPanel';
import { usePicker } from './picker';
import { describeTarget, firstWords, referenceText, targetAt } from './reference';
import { isPanelShortcut } from './shortcut';

afterEach(cleanup);

/** A board block with a task row in it, a document sheet, and the agent panel. */
function page() {
  document.body.innerHTML = `
    <main>
      <div data-widget="tasks" data-component="KanbanBoard">
        <h3>Tasks</h3>
        <div data-entity="t9" data-entity-type="task" data-pick-title="Buy seeds" role="button" tabindex="0">
          <span id="row-text">Buy seeds</span>
        </div>
      </div>
      <section data-doc-block="b2" data-doc-kind="sheet"><h3>Water the beds every morning before work</h3><p>Body</p></section>
      <p id="loose">Not a block</p>
    </main>
    <aside data-agent-panel=""><div data-widget="fake"><span id="inside">x</span></div></aside>`;
}

const view = { id: 'v1', name: 'Overview' };

describe('the reference the picker inserts', () => {
  it('names the view, the kind and title, and the ids the agent looks up', () => {
    page();
    const row = document.querySelector('[data-entity]')!;
    expect(referenceText(view, describeTarget(row))).toBe(
      '[Pharos: “Overview” › Task “Buy seeds” (view v1, block tasks, task t9)] ',
    );
    const board = document.querySelector('[data-widget]')!;
    expect(referenceText(view, describeTarget(board))).toBe(
      '[Pharos: “Overview” › Kanban board “Tasks” (view v1, block tasks)] ',
    );
    const sheet = document.querySelector('[data-doc-block]')!;
    expect(describeTarget(sheet)).toMatchObject({ kind: 'Sheet', blockId: 'b2' });
  });

  it('quotes selected words on one line after the reference', () => {
    expect(referenceText(view, undefined, 'two\n  lines')).toBe(
      '[Pharos: “Overview” (view v1)] “two lines” ',
    );
  });

  it('cuts long titles to their first words', () => {
    expect(firstWords('one two three four five six seven eight nine ten')).toBe(
      'one two three four five six seven eight…',
    );
  });

  it('points at the innermost target, never at the panel', () => {
    page();
    expect(targetAt(document.getElementById('row-text'))?.getAttribute('data-entity')).toBe('t9');
    expect(targetAt(document.getElementById('loose'))).toBeNull();
    expect(targetAt(document.getElementById('inside'))).toBeNull();
  });

  it('turns a block’s Ask into a reference with the question to start from', () => {
    page();
    expect(
      askInPanel(
        { label: 'Tasks in Overview', viewId: 'v1', widgetId: 'tasks', question: 'Build: ' },
        [{ id: 'v1', data: { name: 'Overview' } }],
        () => undefined,
      ),
    ).toBe('[Pharos: “Overview” › Kanban board “Tasks” (view v1, block tasks)] Build: ');
    // From the drawer: a record, by its id.
    expect(
      askInPanel({ label: 'Pick a soil', aboutId: 'd1' }, [], (id) =>
        id === 'd1' ? 'decision' : undefined,
      ),
    ).toBe('[Pharos: this project › Decision “Pick a soil” (decision d1)] ');
    expect(
      entityTypeIn(
        { tasks: [{ id: 'x', type: 'task' }], project: { id: 'p', type: 'project' } },
        'p',
      ),
    ).toBe('project');
  });
});

function Picker({ onPick, onExit }: { onPick: (el: Element) => void; onExit: () => void }) {
  usePicker(true, onPick, onExit);
  return null;
}

describe('picker mode', () => {
  it('names a record from the details once, without repeating its kind', () => {
    const text = askInPanel(
      { label: 'Task “Build a raised bed”', aboutId: 'task_1' },
      [],
      () => 'task',
    );
    expect(text).toContain('“Build a raised bed”');
    expect(text).not.toContain('Task “Task');
  });

  it('picks what is clicked instead of opening it, and Escape leaves', () => {
    page();
    const opened = vi.fn();
    document.querySelector('[data-entity]')!.addEventListener('click', opened);
    const onPick = vi.fn();
    const onExit = vi.fn();
    const { unmount } = render(<Picker onPick={onPick} onExit={onExit} />, {
      container: document.body.appendChild(document.createElement('div')),
    });
    // Blocks become focusable while picking, so Tab and Enter can pick too.
    expect(document.querySelector('[data-doc-block]')!.getAttribute('tabindex')).toBe('0');
    fireEvent.click(document.getElementById('row-text')!);
    expect(onPick).toHaveBeenCalledWith(document.querySelector('[data-entity]'));
    expect(opened).not.toHaveBeenCalled();
    const sheet = document.querySelector<HTMLElement>('[data-doc-block]')!;
    act(() => sheet.focus());
    fireEvent.keyDown(sheet, { key: 'Enter' });
    expect(onPick).toHaveBeenLastCalledWith(sheet);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onExit).toHaveBeenCalled();
    unmount();
    // Leaving puts the page back as it was.
    expect(sheet.hasAttribute('tabindex')).toBe(false);
    expect(document.querySelector('[data-entity]')!.getAttribute('tabindex')).toBe('0');
  });
});

describe('the project bar’s terminal button', () => {
  it('says why the terminal is unavailable here, and opens it where it is', () => {
    const { rerender } = render(
      <AgentPanelButton
        status={{
          available: false,
          reason: 'hosted',
          message: 'The agent terminal works only on this computer',
          running: false,
        }}
        open={false}
        onToggle={() => {}}
      />,
    );
    const off = screen.getByRole('button', { name: 'Agent terminal: unavailable' });
    expect(off.getAttribute('aria-disabled')).toBe('true');
    const toggle = vi.fn();
    rerender(
      <AgentPanelButton
        status={{ available: true, agent: { id: 'claude', label: 'Claude Code' }, running: false }}
        open={false}
        onToggle={toggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Claude Code terminal' }));
    expect(toggle).toHaveBeenCalled();
  });

  it('leaves Ctrl+J to the agent inside the terminal', () => {
    const inside = document.createElement('div');
    inside.setAttribute('data-agent-panel', '');
    document.body.append(inside);
    const event = (target: Element, init: KeyboardEventInit) => {
      const e = new KeyboardEvent('keydown', { key: 'j', ...init });
      Object.defineProperty(e, 'target', { value: target });
      return e;
    };
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    if (mac) {
      expect(isPanelShortcut(event(document.body, { metaKey: true }))).toBe(true);
      expect(isPanelShortcut(event(inside, { ctrlKey: true }))).toBe(false);
    } else {
      expect(isPanelShortcut(event(document.body, { ctrlKey: true }))).toBe(true);
      expect(isPanelShortcut(event(inside, { ctrlKey: true }))).toBe(false);
    }
  });
});
