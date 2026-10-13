import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { DOT_TONES, type Tone } from './ui';

export type SelectOption = {
  value: string;
  label: string;
  /** A second line explaining the choice, like the Add widget list. */
  description?: string;
  /** Shows a coloured dot, e.g. for statuses. */
  color?: Tone;
};

/** The look shared by every dropdown panel (this and the Add widget list). */
export const MENU_PANEL =
  'animate-pop-in rounded-block border border-line-strong bg-surface p-1 shadow-popover';

const TRIGGER =
  'inline-flex w-full min-w-0 items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-left text-sm hover:border-neutral-300 focus-visible:ring-2 focus-visible:ring-sky-300 focus-visible:outline-none dark:hover:border-neutral-600 dark:focus-visible:ring-sky-800';

type Position = { left: number; width: number; top?: number; bottom?: number; maxHeight: number };

function place(trigger: HTMLElement): Position {
  const r = trigger.getBoundingClientRect();
  const width = Math.max(r.width, 224);
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const below = window.innerHeight - r.bottom - 12;
  const above = r.top - 12;
  // Open upwards only when there's clearly more room above.
  return below >= 200 || below >= above
    ? { left, width, top: r.bottom + 4, maxHeight: Math.min(320, below) }
    : { left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(320, above) };
}

/**
 * A dropdown that looks like the rest of Pharos's menus. Keyboard: Enter/Space/↓ opens, ↑↓
 * Home End move, Enter picks, Esc closes. It renders in a portal so dialogs and scroll areas
 * don't clip it.
 */
export function Select({
  value,
  options,
  onChange,
  label,
  placeholder = 'Choose…',
  className,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Accessible name (shown to screen readers; pair with a visible label nearby). */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<Position | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value);

  const show = () => {
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setPosition(place(trigger.current!));
    setOpen(true);
  };
  const hide = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (option: SelectOption) => {
    hide();
    if (option.value !== value) onChange(option.value);
  };

  useLayoutEffect(() => {
    if (open) list.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    // The panel is positioned once; close it rather than let it drift when the page moves.
    const close = (e: Event) => {
      if (e.type === 'scroll' && list.current?.contains(e.target as Node)) return;
      hide(false);
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const onListKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((i) => Math.min(options.length - 1, i + 1)),
      ArrowUp: () => setActive((i) => Math.max(0, i - 1)),
      Home: () => setActive(0),
      End: () => setActive(options.length - 1),
      Enter: () => options[active] && pick(options[active]),
      ' ': () => options[active] && pick(options[active]),
      Escape: () => hide(),
      Tab: () => hide(false),
    };
    const action = keys[e.key];
    if (!action) return;
    if (e.key !== 'Tab') e.preventDefault();
    // Keep Escape from also closing a surrounding drawer or dialog.
    e.stopPropagation();
    action();
  };

  let panel: ReactNode = null;
  if (open && position) {
    panel = createPortal(
      <>
        <div className="fixed inset-0 z-[60]" onClick={() => hide(false)} />
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
          style={position}
          className={clsx('fixed z-[61] overflow-y-auto outline-none', MENU_PANEL)}
        >
          {options.map((option, i) => (
            <div
              key={option.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={option.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(option)}
              className={clsx(
                'flex cursor-pointer items-start gap-2 rounded-tile px-3 py-2',
                i === active && 'bg-subtle',
              )}
            >
              {option.color && (
                <span
                  className={clsx('mt-1.5 size-2 shrink-0 rounded-full', DOT_TONES[option.color])}
                />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{option.label}</span>
                {option.description && (
                  <span className="block text-xs text-muted">{option.description}</span>
                )}
              </span>
              {option.value === value && <Check className="mt-0.5 size-4 shrink-0 text-accent" />}
            </div>
          ))}
        </div>
      </>,
      document.body,
    );
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={(e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            show();
          }
        }}
        className={clsx(TRIGGER, className)}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.color && (
            <span className={clsx('size-2 shrink-0 rounded-full', DOT_TONES[selected.color])} />
          )}
          <span className={clsx('truncate', !selected && 'text-faint')}>
            {selected?.label ?? placeholder}
          </span>
        </span>
        <ChevronDown
          className={clsx('size-4 shrink-0 text-faint transition', open && 'rotate-180')}
        />
      </button>
      {panel}
    </>
  );
}
