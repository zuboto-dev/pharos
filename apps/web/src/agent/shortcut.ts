const isMac = () =>
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The panel's shortcut as this computer writes it. */
export const panelShortcut = () => (isMac() ? '⌘J' : 'Ctrl+J');

/**
 * ⌘J on a Mac; Ctrl+J elsewhere, except inside the terminal, where Ctrl+J is the agent's own
 * (a new line in Claude Code's input).
 */
export function isPanelShortcut(e: KeyboardEvent): boolean {
  if (e.altKey || e.shiftKey || e.key.toLowerCase() !== 'j') return false;
  if (isMac()) return e.metaKey && !e.ctrlKey;
  return (
    e.ctrlKey &&
    !e.metaKey &&
    !(e.target instanceof Element && e.target.closest('[data-agent-panel]'))
  );
}
