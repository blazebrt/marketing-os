export const MAX_DAILY_SPEND = 50000; // 50,000 INR
export const MAX_CAMPAIGN_SPEND = 500000; // 5,00,000 INR

/** Schema and UI use daily | total; some Google paths historically said lifetime. */
export function normaliseBudgetType(value: unknown): 'daily' | 'total' | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'daily') return 'daily';
  if (v === 'total' || v === 'lifetime') return 'total';
  return null;
}

export function calculateSafetyLimits(budgetType: string, amount: number, duration: number) {
  const normalised = normaliseBudgetType(budgetType);
  if (!normalised) {
    throw new Error('Invalid budget type');
  }

  let daily = 0;
  let total = 0;

  if (normalised === 'daily') {
    daily = amount;
    total = amount * duration;
  } else {
    total = amount;
    daily = amount / duration;
  }

  if (amount <= 0 || isNaN(amount) || !isFinite(amount)) {
    throw new Error('Invalid budget amount');
  }

  if (duration <= 0 || isNaN(duration) || !isFinite(duration)) {
    throw new Error('Invalid duration');
  }

  if (daily > MAX_DAILY_SPEND) {
    throw new Error(`Daily spend exceeds safety limit of ${MAX_DAILY_SPEND}`);
  }

  if (total > MAX_CAMPAIGN_SPEND) {
    throw new Error(`Total spend exceeds safety limit of ${MAX_CAMPAIGN_SPEND}`);
  }

  return { maxDaily: daily, maxTotal: total };
}
