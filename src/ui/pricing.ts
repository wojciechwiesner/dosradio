/**
 * AmbiRadio plan prices (USD). The server (`/radio-api/billing/status`) is the source of truth;
 * these defaults keep the UI correct when the status call fails or comes from an older server.
 * Yearly prices are display-only until yearly checkout exists.
 */

export interface PlanPrice {
  id: 'plus' | 'plus_ai';
  name: string;
  shortName: string;
  monthlyCents: number;
  yearlyCents: number;
}

export const PLAN_PRICES: Record<PlanPrice['id'], PlanPrice> = {
  plus: { id: 'plus', name: 'AmbiRadio Plus', shortName: 'Plus', monthlyCents: 299, yearlyCents: 2990 },
  plus_ai: { id: 'plus_ai', name: 'AmbiRadio Plus AI', shortName: 'Plus AI', monthlyCents: 699, yearlyCents: 6990 },
};

/** 299 -> "$2.99", 2990 -> "$29.90". */
export function formatUsd(cents: number): string {
  return `$${(Math.round(cents) / 100).toFixed(2)}`;
}

export const monthlyLabel = (cents: number): string => `${formatUsd(cents)} / mies.`;
export const yearlyLabel = (cents: number): string => `${formatUsd(cents)} / rok`;
