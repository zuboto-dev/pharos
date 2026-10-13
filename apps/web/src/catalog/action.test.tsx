// R10 actions on pack pages: the button, the short form built from the record type, field
// errors, stale and failed results, the DueTracker row action, keyboard and the phone sheet.
import {
  CAR_PACK,
  CaseFile,
  MONEY_PACK,
  packDataset,
  type ActionResult,
  type ActionSubmission,
  type Entity,
  type Pack,
  type ProjectDataset,
  type ViewSpec,
} from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import carCases from '../../../../packages/schema/src/packs/cases/car.json';
import moneyCases from '../../../../packages/schema/src/packs/cases/money.json';
import { ViewDataProvider, type ViewActions } from './context';
import { ViewRenderer } from './renderer';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const TODAY = '2026-10-13';

function page(
  pack: Pack,
  json: unknown,
  fixture: string,
  act?: ViewActions['act'],
  data?: ProjectDataset,
) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
  const file = CaseFile.parse(json);
  const dataset = data ?? packDataset(pack, file.fixtures![fixture]!, TODAY);
  const spec: ViewSpec = { component: 'Board', widgets: pack.views[0]!.widgets };
  const result = render(
    <ViewDataProvider
      data={dataset}
      version={1}
      actions={{ apply: async () => ({ ok: false }), open: vi.fn(), act }}
    >
      <ViewRenderer view={{ id: 'view_page', name: pack.views[0]!.name }} spec={spec} />
    </ViewDataProvider>,
  );
  return { ...result, data: dataset };
}

const done = (message: string): ActionResult => ({
  v: 1,
  status: 'done',
  revision: 42,
  recordId: 'rec_new',
  created: ['rec_new'],
  updated: [],
  message,
});

describe('Mark paid (Money)', () => {
  it('opens a short form from the button, fills the amount from the bill and sends one submission', async () => {
    const act = vi.fn(async () => done('Mark paid: Rent'));
    const { data } = page(MONEY_PACK, moneyCases, 'october', act);
    const button = screen.getByRole('button', { name: 'Mark paid' });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Mark paid' });
    // The first field (the bill) has focus; the form asks only for bill, date and amount.
    const bill = within(dialog).getByLabelText('Bill') as HTMLSelectElement;
    expect(document.activeElement).toBe(bill);
    expect(
      within(dialog)
        .getAllByRole('combobox')
        .concat(within(dialog).getAllByRole('textbox'))
        .map((el) => (el as HTMLInputElement).name)
        .sort(),
    ).toEqual(['amount', 'recordId']);
    fireEvent.change(bill, { target: { value: 'rec_b_rent' } });
    const amount = within(dialog).getByLabelText(/Amount/) as HTMLInputElement;
    await waitFor(() => expect(amount.value).toBe('950.00'));
    expect((within(dialog).getByLabelText('Date') as HTMLInputElement).value).toBe(TODAY);
    fireEvent.change(amount, { target: { value: '960,00' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const rent = data.records!.find((r) => r.id === 'rec_b_rent')!;
    const sent = (act.mock.calls[0] as unknown as [ActionSubmission])[0];
    expect(sent).toMatchObject({
      v: 1,
      projectId: data.project.id,
      viewId: 'view_page',
      widgetId: 'mark-paid',
      recordId: 'rec_b_rent',
      values: { date: TODAY, amount: { amount: 96000, currency: 'EUR' } },
      expectedRevision: rent.updatedRev,
    });
    expect(sent.idempotencyKey).toMatch(/^form-/);
  });

  it('puts the button on every due bill, with that bill picked', () => {
    page(MONEY_PACK, moneyCases, 'october', vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid: Rent' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark paid' });
    expect((within(dialog).getByLabelText('Bill') as HTMLSelectElement).value).toBe('rec_b_rent');
  });

  it('a stale bill says so, keeps the form and sends again with the new revision and the same key', async () => {
    const act = vi
      .fn<(s: ActionSubmission) => Promise<ActionResult>>()
      .mockResolvedValueOnce({
        v: 1,
        status: 'stale',
        message: '“Rent” changed since the form was opened; check it and send again',
        current: { recordId: 'rec_b_rent', revision: 77, title: 'Rent', lastDate: '2026-10-10' },
      })
      .mockResolvedValueOnce(done('Mark paid: Rent'));
    page(MONEY_PACK, moneyCases, 'october', act);
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid: Rent' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark paid' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toMatch(/changed since the form was opened.*last done on/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [first, second] = act.mock.calls.map((c) => c[0]);
    expect(second!.expectedRevision).toBe(77);
    expect(second!.idempotencyKey).toBe(first!.idempotencyKey);
  });

  it('a failure keeps what was typed and says nothing was saved', async () => {
    const act = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    page(MONEY_PACK, moneyCases, 'october', act);
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid: Phone' }));
    const dialog = screen.getByRole('dialog', { name: 'Mark paid' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(
      /Nothing was saved; try again/,
    );
    expect((within(dialog).getByLabelText('Bill') as HTMLSelectElement).value).toBe('rec_b_phone');
  });
});

describe('Log a service (Car)', () => {
  it('checks the fields before sending: an empty date is named, focused and nothing is sent', async () => {
    const act = vi.fn();
    page(CAR_PACK, carCases, 'one-car', act);
    fireEvent.click(screen.getByRole('button', { name: 'Log a service' }));
    const dialog = screen.getByRole('dialog', { name: 'Log a service' });
    // The only car is picked already; the date starts today.
    expect((within(dialog).getByLabelText('Vehicle') as HTMLSelectElement).value).toBe('rec_car');
    const date = within(dialog).getByLabelText('Date');
    fireEvent.change(date, { target: { value: '' } });
    fireEvent.change(within(dialog).getByLabelText(/Odometer/), { target: { value: 'lots' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(act).not.toHaveBeenCalled();
    expect(within(dialog).getByText('Date is required')).toBeTruthy();
    expect(within(dialog).getByText('Odometer must be a number')).toBeTruthy();
    expect(date.getAttribute('aria-invalid')).toBe('true');
    expect(date.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(date);
  });

  it("shows the server's field errors under their fields", async () => {
    const act = vi.fn(async (): Promise<ActionResult> => ({
      v: 1,
      status: 'invalid',
      message: 'Check this field',
      fieldErrors: { cost: 'Cost: fields.cost must be EUR here' },
    }));
    page(CAR_PACK, carCases, 'one-car', act);
    fireEvent.click(screen.getByRole('button', { name: 'Log a service' }));
    const dialog = screen.getByRole('dialog', { name: 'Log a service' });
    fireEvent.change(within(dialog).getByLabelText(/Cost/), { target: { value: '149' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Cost: fields.cost must be EUR here')).toBeTruthy();
    expect(act.mock.calls[0]).toBeTruthy();
    const sent = (act.mock.calls[0] as unknown as [ActionSubmission])[0];
    expect(sent.values).toMatchObject({
      cost: { amount: 14900, currency: 'EUR' },
      vehicle: 'rec_car',
    });
  });

  it('works by keyboard: Tab stays in the form, Escape closes it and focus goes back', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => {
      fn(0);
      return 0;
    });
    page(CAR_PACK, carCases, 'one-car', vi.fn());
    const button = screen.getByRole('button', { name: 'Log a service' });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Log a service' });
    const save = within(dialog).getByRole('button', { name: 'Save' });
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {});
    expect(document.activeElement).toBe(button);
    vi.restoreAllMocks();
  });

  it('is a bottom sheet on a phone and a dialog from sm up', () => {
    page(CAR_PACK, carCases, 'one-car', vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Log a service' }));
    const sheet = screen.getByRole('dialog', { name: 'Log a service' });
    expect(sheet.className).toMatch(/rounded-t-block/);
    expect(sheet.className).toMatch(/sm:max-w-md/);
    expect(sheet.parentElement!.className).toMatch(/items-end/);
  });

  it('is shown but not usable outside a live page, and explains an action the project lacks', () => {
    page(CAR_PACK, carCases, 'one-car', undefined);
    expect(
      (screen.getByRole('button', { name: 'Log a service' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();
    const file = CaseFile.parse(moneyCases);
    const money = packDataset(MONEY_PACK, file.fixtures!.october!, TODAY);
    // The car's action on a money project: the record type isn't there.
    page(CAR_PACK, carCases, 'one-car', vi.fn(), money as ProjectDataset);
    expect(
      screen.getByText(/“Log a service” can’t be used here: recordType "service"/),
    ).toBeTruthy();
    expect((money.records as Entity<'record'>[]).length).toBeGreaterThan(0);
  });
});
