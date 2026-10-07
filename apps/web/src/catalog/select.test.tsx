import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from './select';

afterEach(cleanup);

const options = [
  { value: 'todo', label: 'Todo', color: 'neutral' as const },
  { value: 'doing', label: 'Doing', description: 'Counts as in progress', color: 'blue' as const },
  { value: 'done', label: 'Done', color: 'green' as const },
];

function renderSelect(value = 'todo') {
  const onChange = vi.fn();
  const onOuterKey = vi.fn();
  render(
    <div onKeyDown={(e) => e.key === 'Escape' && onOuterKey()}>
      <Select label="Status" value={value} options={options} onChange={onChange} />
    </div>,
  );
  return { onChange, onOuterKey, trigger: screen.getByRole('button', { name: 'Status' }) };
}

describe('Select', () => {
  it('shows the current choice and picks another with the mouse', () => {
    const { onChange, trigger } = renderSelect();
    expect(trigger.textContent).toBe('Todo');
    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Status' });
    expect(screen.getByRole('option', { name: 'Todo' }).getAttribute('aria-selected')).toBe('true');
    expect(listbox.textContent).toContain('Counts as in progress');
    fireEvent.click(screen.getByRole('option', { name: /^Doing/ }));
    expect(onChange).toHaveBeenCalledWith('doing');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('works from the keyboard', () => {
    const { onChange, trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toMatch(/-2$/);
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('done');
  });

  it('closes on Escape without closing what surrounds it, and ignores picking the same value', () => {
    const { onChange, onOuterKey, trigger } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onOuterKey).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: 'Todo' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
