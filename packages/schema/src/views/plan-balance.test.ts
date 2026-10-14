// v0.2 A6: a CategoryBreakdown never counts spending in another currency against the plan.
import { describe, expect, it } from 'vitest';
import { leftText, notCountedText, planBalance, type Total } from './blocks.js';

const eur = (amount: number) => ({ amount, currency: 'EUR' });
const usd = (amount: number) => ({ amount, currency: 'USD' });
const money = (...amounts: { amount: number; currency: string }[]): Total => ({
  kind: 'money',
  amounts,
});

describe('planBalance', () => {
  it('counts only the plan’s currency and lists the rest apart', () => {
    expect(planBalance(money(eur(10000)), money(usd(2500)))).toEqual({
      planned: eur(10000),
      spent: eur(0),
      left: eur(10000),
      notCounted: [usd(2500)],
    });
    const mixed = planBalance(money(eur(10000)), money(eur(8000), usd(2500)))!;
    expect(mixed.left).toEqual(eur(2000));
    expect(mixed.notCounted).toEqual([usd(2500)]);
  });

  it('goes below zero when over, and leaves zero amounts out', () => {
    const over = planBalance(money(eur(12000)), money(eur(13480), usd(0)))!;
    expect(over.left).toEqual(eur(-1480));
    expect(over.notCounted).toEqual([]);
  });

  it('has nothing to say without a money plan in one currency', () => {
    expect(planBalance({ kind: 'number', value: 0 }, money(eur(100)))).toBeUndefined();
    expect(planBalance(money(eur(100), usd(100)), money(eur(50)))).toBeUndefined();
    expect(
      planBalance({ kind: 'number', value: 10 }, { kind: 'number', value: 4 }),
    ).toBeUndefined();
  });

  it('reads as the row shows it', () => {
    expect(leftText(eur(10000))).toBe('€100.00 left');
    expect(leftText(eur(-1480))).toBe('€14.80 over');
    expect(notCountedText([usd(2500)])).toBe('$25.00 in USD not counted');
    expect(notCountedText([usd(2500), { amount: 300000, currency: 'JPY' }])).toBe(
      '$25.00 in USD not counted · ¥300,000 in JPY not counted',
    );
    expect(notCountedText([])).toBe('');
  });
});
