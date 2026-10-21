/**
 * What the picker points at (R17): the innermost record row, document block or board block under
 * the pointer, and the words it puts in the agent's input line so the agent can find it over MCP
 * (`view_get`, `get`).
 */

/** Things on a page the picker can point at, innermost first wins (`closest`). */
export const PICK_SELECTOR = '[data-entity], [data-doc-block], [data-widget]';

/** Where the agent panel and other chrome live: never a target. */
export const NOT_PICKABLE = '[data-agent-panel], [role="dialog"], [data-pick-ignore]';

/** "KanbanBoard" → "Kanban board", "decision" → "Decision". */
export function kindLabel(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll(/[_-]/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One line, at most `words` words and `chars` characters, with … when cut. */
export function firstWords(text: string, words = 8, chars = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  let cut = flat.split(' ').slice(0, words).join(' ');
  if (cut.length > chars) cut = cut.slice(0, chars).trimEnd();
  return cut.length < flat.length ? `${cut}…` : cut;
}

function textOf(el: Element): string {
  return ((el as HTMLElement).innerText ?? el.textContent ?? '').trim();
}

/** A target's title: its own `data-pick-title`, its first heading, or its first words. */
function titleOf(el: Element): string {
  const own = el.getAttribute('data-pick-title');
  if (own) return firstWords(own);
  const heading = el.querySelector('h1, h2, h3, h4, h5, h6, summary, figcaption, th');
  const text = heading ? textOf(heading) : '';
  return firstWords(text || textOf(el));
}

export type PickTarget = {
  /** Words for the kind: "Task", "Kanban board", "Sheet". */
  kind: string;
  title: string;
  /** The board block or document block it is in. */
  blockId?: string;
  /** A record it shows (a task row, a decision). */
  entity?: { type: string; id: string };
};

/** What a page element is, for the reference. */
export function describeTarget(el: Element): PickTarget {
  const block = el.closest('[data-doc-block], [data-widget]');
  const blockId = block?.getAttribute('data-doc-block') ?? block?.getAttribute('data-widget');
  if (el.hasAttribute('data-entity')) {
    const type = el.getAttribute('data-entity-type') ?? 'item';
    return {
      kind: kindLabel(type),
      title: titleOf(el),
      ...(blockId ? { blockId } : {}),
      entity: { type, id: el.getAttribute('data-entity')! },
    };
  }
  const kind = el.getAttribute('data-doc-kind') ?? el.getAttribute('data-component') ?? 'block';
  return { kind: kindLabel(kind), title: titleOf(el), ...(blockId ? { blockId } : {}) };
}

/**
 * The words the picker inserts, e.g.
 * `[Pharos: “Overview” › Task “Buy seeds” (view v1, block w3, task t9)] `, ending with a space
 * so the owner types the question after it. Quoted text from a selection follows the reference.
 */
export function referenceText(
  view: { id: string; name: string } | undefined,
  target: PickTarget | undefined,
  quote?: string,
): string {
  const ids = [
    view ? `view ${view.id}` : '',
    target?.blockId ? `block ${target.blockId}` : '',
    target?.entity ? `${target.entity.type} ${target.entity.id}` : '',
  ].filter(Boolean);
  const where = [
    view ? `“${view.name}”` : 'this project',
    target ? `${target.kind}${target.title ? ` “${target.title}”` : ''}` : '',
  ].filter(Boolean);
  const quoted = quote ? ` “${quote.replace(/\s+/g, ' ').trim()}”` : '';
  return `[Pharos: ${where.join(' › ')}${ids.length ? ` (${ids.join(', ')})` : ''}]${quoted} `;
}

/** The target under an element (the innermost pickable thing), unless it is chrome. */
export function targetAt(node: Node | null): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  if (!el || el.closest(NOT_PICKABLE)) return null;
  return el.closest(PICK_SELECTOR);
}
