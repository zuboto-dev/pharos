import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXIT_MS, useExit } from './motion';

// v0.2 B3: calm transitions with shared tokens, and nothing but opacity under reduced motion.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The stylesheet itself (vitest doesn't load CSS into modules, and this package has no Node types).
const node = (
  globalThis as unknown as {
    process: {
      cwd(): string;
      getBuiltinModule(id: 'node:fs'): { readFileSync(path: string, encoding: 'utf8'): string };
    };
  }
).process;
const css = node.getBuiltinModule('node:fs').readFileSync(`${node.cwd()}/src/index.css`, 'utf8');

describe('motion tokens', () => {
  it('keeps every duration between 120 and 220ms, with one easing for all of them', () => {
    const durations = [...css.matchAll(/--motion-(?:quick|base|slow):\s*(\d+)ms/g)].map((m) =>
      Number(m[1]),
    );
    expect(durations).toEqual([120, 160, 220]);
    const animations = [...css.matchAll(/--animate-([a-z-]+):\s*([^;]+);/g)];
    expect(animations.length).toBeGreaterThan(5);
    for (const [, name, value] of animations) {
      if (name === 'block-changed') continue; // a colour fade, not a movement
      if (name === 'presence') continue; // a slow looping pulse (v0.2 B5), not a transition
      if (name === 'shimmer') continue; // a loading skeleton's slow sweep (v0.2 B8), still when reduced
      expect(value, name).toMatch(/var\(--motion-(quick|base|slow)\) var\(--ease-calm(-out)?\)/);
    }
  });

  it('turns every movement off under prefers-reduced-motion, leaving opacity', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const block = reduced.slice(0, reduced.indexOf('}\n}') + 3);
    for (const distance of [
      '--motion-rise: 0px',
      '--motion-drawer: 0px',
      '--motion-sheet: 0px',
      '--motion-side: 0px',
    ])
      expect(block).toContain(distance);
    expect(block).toContain('--motion-scale: 1');
    expect(block).toContain('--motion-presence-scale: 1');
    // Keyframes move only by those distances, so reduced motion leaves just the fade.
    const keyframes = [...css.matchAll(/@keyframes motion-[a-z-]+ \{[^@]*/g)].map((m) => m[0]);
    for (const k of keyframes) {
      for (const t of k.matchAll(/transform:\s*([^;]+);/g))
        expect(t[1]).toMatch(
          /^(translate[XY]\((calc\()?var\(--motion-[a-z]+\)|translateY\(calc|scale\((1|var\(--motion-presence-scale\))\)$)/,
        );
    }
  });
});

describe('useExit', () => {
  it('keeps the last value on screen while it fades out, then lets it go', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useExit(value), {
      initialProps: { value: 'drawer' as string | null },
    });
    expect(result.current).toEqual({ shown: 'drawer', leaving: false });
    rerender({ value: null });
    expect(result.current).toEqual({ shown: 'drawer', leaving: true });
    act(() => vi.advanceTimersByTime(EXIT_MS));
    expect(result.current).toEqual({ shown: null, leaving: false });
  });

  it('comes back at once when the value returns while leaving', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useExit(value), {
      initialProps: { value: 'a' as string | null },
    });
    rerender({ value: null });
    rerender({ value: 'b' });
    expect(result.current).toEqual({ shown: 'b', leaving: false });
    act(() => vi.advanceTimersByTime(EXIT_MS * 2));
    expect(result.current).toEqual({ shown: 'b', leaving: false });
  });
});
