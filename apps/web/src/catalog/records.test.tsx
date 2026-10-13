import {
  CAR_PACK,
  MONEY_PACK,
  packDataset,
  type ProjectDataset,
  type ViewSpec,
} from '@pharos/schema';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localToday } from '../lib/format';
import { ViewDataProvider, type OpenTarget } from './context';
import { ViewRenderer } from './renderer';

afterEach(cleanup);

/** The pack's page with its made-up examples, dated from today like a fresh sample. */
function renderPack(pack: typeof CAR_PACK, open = vi.fn<(t: OpenTarget) => void>()) {
  const data: ProjectDataset = packDataset(pack, pack.examples ?? [], localToday());
  const spec: ViewSpec = { component: 'Board', widgets: pack.views[0]!.widgets };
  const result = render(
    <ViewDataProvider
      data={data}
      version={1}
      actions={{ apply: async () => ({ ok: false }), open }}
    >
      <ViewRenderer spec={spec} />
    </ViewDataProvider>,
  );
  return { ...result, data, open };
}

describe('car page', () => {
  it("shows what's due in bands, the service log with a total and cost per year", () => {
    const { container } = renderPack(CAR_PACK);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/failed to render|Unknown component/);
    // The inspection was due a year after the last one, 400 days ago; the oil is 550 km away.
    expect(text).toContain('Past due');
    expect(text).toMatch(/Oil change.*550 km left/);
    expect(text).toMatch(/Annual inspection.*\d+ days late/);
    // The ledger's total row adds the five services: €95 + €149 + €285 + €60.
    expect(
      screen.getAllByRole('row').some((r) => /^Total.*€589\.00$/.test(r.textContent ?? '')),
    ).toBe(true);
    expect(text).toMatch(/Total82.6 L€141.25/);
  });

  it('opens a record in the drawer when its row is tapped', () => {
    const { open, data } = renderPack(CAR_PACK);
    fireEvent.click(screen.getByText('Oil change'));
    const oil = data.records!.find((r) => r.data.title === 'Oil change')!;
    expect(open).toHaveBeenCalledWith({ entity: oil.id });
  });
});

describe('money page', () => {
  it('shows planned against spent, bills, savings and money in its own currency', () => {
    const { container } = renderPack(MONEY_PACK);
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/failed to render|Unknown component/);
    // Groceries: three shops this month against a €400 plan.
    expect(text).toContain('€237.75 of €400.00');
    // A game paid in dollars is never converted.
    expect(text).toContain('$25.00 of €100.00');
    expect(text).toContain('€3,200.00');
    expect(text).toMatch(/of €5,000\.00 · 64%/);
    expect(text).toMatch(/Streaming.*Past due|Past due.*Streaming/);
  });
});
