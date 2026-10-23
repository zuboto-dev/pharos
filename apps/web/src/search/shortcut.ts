const isMac = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The search shortcut as this computer writes it. */
export const searchShortcut = () => (isMac() ? '⌘K' : 'Ctrl+K');

/**
 * ⌘K on a Mac; Ctrl+K elsewhere, except inside the agent's terminal, where Ctrl+K is the agent's
 * own (it deletes to the end of the line), as with ⌘J / Ctrl+J for the panel.
 */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  if (e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return false;
  if (isMac()) return e.metaKey && !e.ctrlKey;
  return (
    e.ctrlKey &&
    !e.metaKey &&
    !(e.target instanceof Element && e.target.closest('[data-agent-panel]'))
  );
}
