import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// v0.2 B6: the visual-system tokens become Tailwind utilities. A token named like a Tailwind
// keyword quietly changes that utility everywhere: `--spacing-block` made `.inline-block` set an
// inline size of 1rem, so every inline-block dot was drawn twice as wide.

// A variable path, so Vite leaves the URL alone (a literal one becomes an asset URL).
const file = '../index.css';
const css = readFileSync(new URL(file, import.meta.url), 'utf8');
const names = (namespace: string) =>
  [...css.matchAll(new RegExp(`--${namespace}-([a-z0-9-]+?)(?:--[a-z-]+)?:`, 'g'))].map(
    (m) => m[1]!,
  );

// Words Tailwind already uses after the prefixes each namespace feeds: spacing → inline-*,
// block-*, w-*, p-*…; colour → text-*, bg-*, border-*…; text → text-*; radius → rounded-*.
const DISPLAY = ['block', 'inline', 'flex', 'grid', 'table', 'contents', 'hidden', 'flow-root'];
const SIZES = ['auto', 'full', 'screen', 'px', 'min', 'max', 'fit', 'dvh', 'svh', 'lvh'];
const TEXT = ['left', 'right', 'center', 'justify', 'start', 'end', 'clip', 'ellipsis', 'wrap'];
const TEXT_MORE = ['nowrap', 'balance', 'pretty', 'shadow', 'opacity'];
const COLOURS = ['current', 'inherit', 'transparent', 'none'];
const KEYWORDS: Record<string, Set<string>> = {
  spacing: new Set([...DISPLAY, ...SIZES]),
  color: new Set([...TEXT, ...TEXT_MORE, ...COLOURS, 'solid', 'dashed', 'dotted', 'double']),
  text: new Set([...TEXT, ...TEXT_MORE, ...COLOURS]),
  radius: new Set(['none', 'full', 's', 'e', 't', 'r', 'b', 'l', 'ss', 'se', 'ee', 'es']),
  shadow: new Set(['none', 'inner']),
};

describe('visual-system tokens', () => {
  it('never name a token after a Tailwind keyword', () => {
    for (const ns of ['spacing', 'color', 'text', 'radius', 'shadow']) {
      const found = names(ns);
      expect(found.length, ns).toBeGreaterThan(0);
      for (const name of found) expect(KEYWORDS[ns]!.has(name), `--${ns}-${name}`).toBe(false);
    }
  });

  it('gives every keyboard-reachable control a visible focus ring (v0.2 B10)', () => {
    expect(css).toMatch(
      /:where\(a\[href\], button, summary, select, textarea, input, \[tabindex\]\):focus-visible \{\s*outline: 2px solid/,
    );
  });

  it('defines every themed colour for light and dark', () => {
    const light = css.slice(css.indexOf(':root {\n  --ph-'), css.indexOf('.dark {'));
    const dark = css.slice(css.indexOf('.dark {'), css.indexOf('@theme inline'));
    const lightNames = [...light.matchAll(/(--ph-[a-z-]+):/g)].map((m) => m[1]);
    const darkNames = [...dark.matchAll(/(--ph-[a-z-]+):/g)].map((m) => m[1]);
    expect(darkNames.sort()).toEqual(lightNames.sort());
  });
});
