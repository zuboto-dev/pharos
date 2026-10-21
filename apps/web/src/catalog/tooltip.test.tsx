import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVER_DELAY, InfoTip, LONG_PRESS, Tooltip, placeTip } from './tooltip';

// The one tooltip (docs/design/principles.md): words move here from the screen, never deleted.

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tip = () => document.querySelector('[data-tip]');
const wrapper = (el: HTMLElement) => el.parentElement!;

function renderButton(props: Partial<Parameters<typeof Tooltip>[0]> = {}) {
  render(
    <Tooltip label="Hide sidebar" shortcut="⌘\" {...props}>
      <button type="button" aria-label="Hide sidebar">
        x
      </button>
    </Tooltip>,
  );
  return screen.getByRole('button', { name: 'Hide sidebar' });
}

describe('Tooltip', () => {
  it('shows on hover after a short wait, and hides when the pointer leaves', () => {
    const button = renderButton();
    fireEvent.pointerEnter(wrapper(button), { pointerType: 'mouse' });
    expect(tip()).toBeNull();
    act(() => vi.advanceTimersByTime(HOVER_DELAY));
    expect(tip()!.textContent).toBe('Hide sidebar⌘\\');
    fireEvent.pointerLeave(wrapper(button), { pointerType: 'mouse' });
    expect(tip()).toBeNull();
  });

  it('shows at once on keyboard focus and hides on blur or Escape', () => {
    const button = renderButton();
    act(() => button.focus());
    expect(tip()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(tip()).toBeNull();
    act(() => button.blur());
    act(() => button.focus());
    expect(tip()).not.toBeNull();
    act(() => button.blur());
    expect(tip()).toBeNull();
  });

  it('shows on a long press on a touch screen, and that press is not a tap', () => {
    const onClick = vi.fn();
    render(
      <Tooltip label="Pin">
        <button type="button" aria-label="Pin" onClick={onClick}>
          x
        </button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'Pin' });
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(LONG_PRESS));
    expect(tip()!.textContent).toBe('Pin');
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    // A quick tap still presses it.
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    fireEvent.pointerUp(button, { pointerType: 'touch' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is never read twice: the floating copy is aria-hidden, the control keeps its name', () => {
    const button = renderButton();
    act(() => button.focus());
    expect(tip()!.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-describedby')).toBeNull();
  });

  it('gives extra words to screen readers as the control’s description', () => {
    render(
      <Tooltip label="home-lab" detail="~/code/home-lab">
        <button type="button">home-lab</button>
      </Tooltip>,
    );
    const button = screen.getByRole('button', { name: 'home-lab' });
    const id = button.getAttribute('aria-describedby')!;
    expect(document.getElementById(id)!.textContent).toBe('~/code/home-lab');
  });
});

describe('InfoTip', () => {
  it('keeps the words in the page and opens them on a tap', () => {
    render(<InfoTip label="About folders" detail="Files stay where they are." />);
    const button = screen.getByRole('button', { name: 'About folders' });
    expect(document.getElementById(button.getAttribute('aria-describedby')!)!.textContent).toBe(
      'Files stay where they are.',
    );
    fireEvent.click(button);
    expect(tip()!.textContent).toBe('Files stay where they are.');
    fireEvent.click(button);
    expect(tip()).toBeNull();
  });
});

describe('placeTip', () => {
  const vp = { width: 390, height: 844 };
  const size = { width: 120, height: 24 };
  it('goes below, centred, inside an 8px inset', () => {
    expect(placeTip({ top: 100, bottom: 120, left: 0, right: 20 }, size, vp)).toEqual({
      left: 8,
      top: 126,
      side: 'bottom',
    });
  });
  it('flips above when there is no room below', () => {
    const p = placeTip({ top: 810, bottom: 830, left: 300, right: 340 }, size, vp);
    expect(p).toEqual({ left: 260, top: 780, side: 'top' });
  });
  it('falls back from the right side to below near the screen’s edge', () => {
    const p = placeTip({ top: 100, bottom: 120, left: 340, right: 380 }, size, vp, 'right');
    expect(p.side).toBe('bottom');
  });
});
