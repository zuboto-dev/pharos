import { fireEvent, screen, within } from '@testing-library/react';

/** Opens the dropdown named `label` and picks the option whose label starts with `option`. */
export function choose(label: string, option: string, container: HTMLElement = document.body) {
  fireEvent.click(within(container).getByRole('button', { name: label }));
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${escaped}`) }));
}
