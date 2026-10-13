import { readFileSync } from 'node:fs';

// A text-contrast check for rendered blocks (v0.2 B6), without a browser: happy-dom doesn't apply
// Tailwind, so the colours come from each element's classes, resolved against Tailwind's palette
// (tailwindcss/theme.css) and the visual-system tokens in index.css, for light or dark mode. Text
// must reach WCAG AA: 4.5:1, or 3:1 for large text.

type Mode = 'light' | 'dark';
type RGBA = [number, number, number, number];

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

function varsIn(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars.set(m[1]!, m[2]!.trim());
  return vars;
}

/** The body of the first rule whose header matches (`:root {`, `.dark {`, `@theme inline {`). */
function block(css: string, header: RegExp): string {
  const start = css.search(header);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  return '';
}

const palette = varsIn(read('../../node_modules/tailwindcss/theme.css'));
const indexCss = read('../index.css');
const tokens = {
  light: varsIn(block(indexCss, /^:root\s*\{\s*\n\s*--ph-/m)),
  dark: varsIn(block(indexCss, /^\.dark\s*\{/m)),
};
const themed = varsIn(block(indexCss, /^@theme inline\s*\{/m));

function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => {
    const x = Math.min(1, Math.max(0, v));
    return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  }) as [number, number, number];
}

/** A CSS colour value (as Tailwind and index.css write them) as sRGB 0–1 with alpha. */
function parseColor(value: string, mode: Mode, depth = 0): RGBA | null {
  const v = value.trim();
  if (depth > 6) return null;
  const ref = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (ref) {
    const name = ref[1]!;
    const next = name.startsWith('--ph-')
      ? (tokens[mode].get(name) ?? tokens.light.get(name))
      : (themed.get(name) ?? palette.get(name));
    return next ? parseColor(next, mode, depth + 1) : null;
  }
  if (v === 'transparent') return [0, 0, 0, 0];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((x) => x + x).join('') : hex[1]!;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).concat(1) as RGBA;
  }
  const ok = /^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+|none)(?:\s*\/\s*([\d.]+%?))?\)$/.exec(v);
  if (ok) {
    const rgb = oklchToRgb(
      Number(ok[1]) / 100,
      Number(ok[2]),
      ok[3] === 'none' ? 0 : Number(ok[3]),
    );
    const alpha = ok[4] ? (ok[4].endsWith('%') ? parseFloat(ok[4]) / 100 : Number(ok[4])) : 1;
    return [...rgb, alpha];
  }
  return null;
}

/** `text-sky-600/80`, `bg-surface` → the colour, or null when the class isn't a colour. */
function classColor(kind: string, cls: string, mode: Mode): RGBA | null {
  const m = new RegExp(`^${kind}-([a-z]+(?:-[a-z]+)*(?:-\\d+)?)(?:/(\\d+))?$`).exec(cls);
  if (!m) return null;
  const color = parseColor(`var(--color-${m[1]})`, mode);
  if (!color) return null;
  if (m[2]) color[3] *= Number(m[2]) / 100;
  return color;
}

/** The colour an element's own classes give for `kind` (text, bg, fill) in `mode`. */
function ownColor(el: Element, kind: string, mode: Mode): RGBA | null {
  const classes = [...el.classList];
  if (mode === 'dark')
    for (const c of classes)
      if (c.startsWith('dark:')) {
        const color = classColor(kind, c.slice(5), mode);
        if (color) return color;
      }
  for (const c of classes) {
    if (c.includes(':')) continue;
    const color = classColor(kind, c, mode);
    if (color) return color;
  }
  const style = (el as HTMLElement).style;
  const inline = kind === 'bg' ? style?.backgroundColor : kind === 'text' ? style?.color : '';
  if (inline) return parseColor(inline, mode);
  if (kind === 'fill') {
    const fill = el.getAttribute('fill');
    if (fill && fill !== 'currentColor' && fill !== 'none') return parseColor(fill, mode);
  }
  return null;
}

function over(top: RGBA, under: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const LARGE = /^(text-(xl|2xl|3xl|4xl|5xl|figure))$/;
const BOLD = /^font-(semibold|bold|extrabold|black)$/;

function isLarge(el: Element): boolean {
  let bold = false;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const classes = [...e.classList].filter((c) => !c.includes(':'));
    if (classes.some((c) => BOLD.test(c))) bold = true;
    if (classes.some((c) => LARGE.test(c))) return true;
    if (classes.includes('text-lg') && bold) return true;
    if (classes.some((c) => /^text-(xs|sm|base|caption|body|title|heading|axis)$/.test(c)))
      return false;
  }
  return false;
}

function hidden(el: Element): boolean {
  for (let e: Element | null = el; e; e = e.parentElement) {
    if (e.classList.contains('sr-only') || e.classList.contains('hidden')) return true;
    if (e.getAttribute('aria-hidden') === 'true' || e.hasAttribute('hidden')) return true;
    if (e.hasAttribute('disabled')) return true;
  }
  return false;
}

export type ContrastIssue = {
  text: string;
  ratio: number;
  needs: number;
  classes: string;
};

/**
 * Every visible text in `root` whose colour on its background is below WCAG AA in `mode`.
 * `base` is what the block sits on (default: the block surface).
 */
export function contrastIssues(
  root: Element,
  mode: Mode,
  base = 'var(--color-surface)',
): ContrastIssue[] {
  const page = parseColor(base, mode)!;
  const issues: ContrastIssue[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent?.trim();
    const el = node.parentElement;
    if (!text || !el || hidden(el)) continue;
    const svg = el.closest('svg');
    if (svg && el.tagName.toLowerCase() !== 'text' && !el.closest('text')) continue;
    // The text colour: the nearest fill (SVG text) or text colour, inherited down.
    let fg: RGBA | null = null;
    let opacity = 1;
    const chain: Element[] = [];
    for (let e: Element | null = el; e; e = e.parentElement) chain.push(e);
    for (const e of chain) {
      fg = (svg ? ownColor(e, 'fill', mode) : null) ?? ownColor(e, 'text', mode);
      if (fg) break;
    }
    for (const e of chain) {
      const o = [...e.classList].find((c) => /^opacity-\d+$/.test(c));
      if (o) opacity *= Number(o.slice(8)) / 100;
    }
    fg ??= parseColor('var(--color-ink)', mode)!;
    // The background: the base, then every ancestor's background over it, outermost first.
    let bg = page;
    for (const e of [...chain].reverse()) {
      const layer = ownColor(e, 'bg', mode);
      if (layer) bg = over(layer, bg);
    }
    const color = over([fg[0], fg[1], fg[2], fg[3] * opacity], bg);
    const ratio = contrast(color, bg);
    const needs = isLarge(el) ? 3 : 4.5;
    if (ratio + 0.005 < needs)
      issues.push({
        text: text.slice(0, 60),
        ratio: Math.round(ratio * 100) / 100,
        needs,
        classes: chain.find((e) => e.className)?.getAttribute('class') ?? '',
      });
  }
  return issues;
}
