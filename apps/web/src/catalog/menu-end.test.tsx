import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MenuItem } from './menu';

afterEach(cleanup);

describe('menu item marks', () => {
  it('keeps counts and dots outside the label that truncates', () => {
    render(
      <MenuItem onClick={() => {}} end={<span data-testid="count">2</span>}>
        A very long view name that does not fit in the menu at all
      </MenuItem>,
    );
    const item = screen.getByRole('menuitem');
    const label = item.querySelector('.truncate')!;
    const count = screen.getByTestId('count');
    expect(label.contains(count)).toBe(false);
    expect(count.parentElement!.className).toContain('shrink-0');
  });
});
