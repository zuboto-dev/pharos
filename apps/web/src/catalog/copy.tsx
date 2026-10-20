import clsx from 'clsx';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

// Copy buttons in report documents (R15): on a step's command and on code blocks in Text and
// Markdown. The button says "Copied" for a moment once it has.

/** Copies text, with the old way as a fallback where the clipboard API isn't there. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand?.('copy') ?? false;
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** How long "Copied" shows before the button says "Copy" again. */
export const COPIED_MS = 2000;

/** A small "Copy" button that says "Copied" for a moment once it has. */
export function CopyButton({
  text,
  label = 'Copy',
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      data-copy=""
      aria-label={copied ? 'Copied' : label}
      onClick={() => {
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), COPIED_MS);
        });
      }}
      className={clsx('doc-copy', className)}
    >
      {copied ? (
        <Check aria-hidden className="size-3.5" />
      ) : (
        <Copy aria-hidden className="size-3.5" />
      )}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

type HastLike = { type?: string; value?: string; children?: HastLike[] };

/** The text of a Markdown syntax node (the code inside a code block). */
export function hastText(node: HastLike | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/** A code block in a document's Markdown, with its copy button (R15). */
export function CopyablePre({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div data-doc-code="" className="doc-code">
      {children}
      <CopyButton text={text} label="Copy code" />
    </div>
  );
}
