import { describe, expect, it } from 'vitest';
import { PLAN_PRICES, formatUsd, monthlyLabel, yearlyLabel } from '../src/ui/pricing';

describe('AmbiRadio USD pricing', () => {
  it('formats cents as dollars', () => {
    expect(formatUsd(299)).toBe('$2.99');
    expect(formatUsd(2990)).toBe('$29.90');
  });

  it('shows the agreed monthly and yearly labels', () => {
    expect(monthlyLabel(PLAN_PRICES.plus.monthlyCents)).toBe('$2.99 / mies.');
    expect(monthlyLabel(PLAN_PRICES.plus_ai.monthlyCents)).toBe('$6.99 / mies.');
    expect(yearlyLabel(PLAN_PRICES.plus.yearlyCents)).toBe('$29.90 / rok');
    expect(yearlyLabel(PLAN_PRICES.plus_ai.yearlyCents)).toBe('$69.90 / rok');
  });

  it('uses AmbiRadio plan names', () => {
    expect(PLAN_PRICES.plus.name).toBe('AmbiRadio Plus');
    expect(PLAN_PRICES.plus_ai.name).toBe('AmbiRadio Plus AI');
  });
});
