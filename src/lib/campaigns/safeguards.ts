export const MAX_DAILY_SPEND = 50000; // 50,000 INR
export const MAX_CAMPAIGN_SPEND = 500000; // 5,00,000 INR

export function calculateSafetyLimits(budgetType: string, amount: number, duration: number) {
  let daily = 0;
  let total = 0;

  if (budgetType.toLowerCase() === 'daily') {
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
