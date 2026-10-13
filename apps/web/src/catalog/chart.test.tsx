import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Bar, CHART, Legend, emphasisOf } from './chart';

afterEach(cleanup);

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('chart styles (v0.2 B7)', () => {
  it('draws a share of a faint track, clamped to the track', () => {
    const { container } = render(
      <>
        <Bar share={0.25} highlighted />
        <Bar share={1.7} tone="ok" track={false} />
        <Bar share={-1} tone="rest" />
      </>,
    );
    const [a, b, c] = [...container.children] as HTMLElement[];
    expect(a!.getAttribute('aria-hidden')).toBe('true');
    expect(a!.className).toContain(CHART.track);
    expect((a!.firstElementChild as HTMLElement).style.width).toBe('25%');
    expect(a!.firstElementChild!.className).toContain(CHART.fill.highlight);
    expect(a!.firstElementChild!.getAttribute('data-highlighted')).toBe('true');
    expect(b!.className).not.toContain(CHART.track);
    expect((b!.firstElementChild as HTMLElement).style.width).toBe('100%');
    expect(b!.firstElementChild!.className).toContain(CHART.fill.ok);
    expect((c!.firstElementChild as HTMLElement).style.width).toBe('0%');
    expect(c!.firstElementChild!.className).toContain(CHART.fill.rest);
  });

  it('says how much an item stands out', () => {
    expect(emphasisOf(true, true)).toBe('lit');
    expect(emphasisOf(false, true)).toBe('rest');
    expect(emphasisOf(false, false)).toBe('plain');
  });

  it('draws a legend for screen readers to skip (the chart says it in words)', () => {
    const { container } = render(
      <Legend items={[{ label: 'This one', swatch: CHART.fill.highlight }]} />,
    );
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector(`.${CHART.fill.highlight}`)).not.toBeNull();
  });

  it('keeps the chart palette in one place, for both themes', () => {
    const css = source('../index.css');
    const light = css.slice(css.indexOf(':root {\n  --ph-'), css.indexOf('.dark {'));
    const dark = css.slice(css.indexOf('.dark {'), css.indexOf('@theme inline'));
    for (const name of [
      'highlight',
      'rest',
      'track',
      'axis',
      'grid',
      'label',
      'ok',
      'warn',
      'bad',
    ]) {
      expect(light).toContain(`--ph-chart-${name}:`);
      expect(dark).toContain(`--ph-chart-${name}:`);
    }
  });

  it('leaves no hard-coded chart colours in the chart and picture blocks', () => {
    // Marks (bars, rings, highlight frames) take their colour from CHART; option colours a
    // project chose (DOT_TONES) are the only other source.
    const part = (file: string, from: string, to?: string) => {
      const text = source(file);
      const start = text.indexOf(from);
      return text.slice(start, to ? text.indexOf(to, start) : undefined);
    };
    const marks = /\b(bg|stroke|fill|border|ring)-(sky|emerald)-\d/;
    for (const [name, text] of Object.entries({
      FindingChart: source('components/finding-chart.tsx'),
      'MiniBar, StatCards, ProgressRing': part(
        'components/overview.tsx',
        'export function MiniBar',
        'const CALLOUTS',
      ),
      CountChart: part('components/generic.tsx', 'export function CountChart', '\n}\n'),
      Layers: source('components/layer-progress.tsx'),
      Gallery: source('components/gallery.tsx'),
      BeforeAfter: source('components/before-after.tsx'),
      ProgressBar: part('ui.tsx', 'export function ProgressBar', '\n}\n'),
    }))
      expect(text, name).not.toMatch(marks);
  });
});
