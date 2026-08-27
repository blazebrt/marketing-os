/** Shared formatting for the performance screens. */

export function formatMoney(value: number | null, currency = 'INR'): string {
  if (value === null || !Number.isFinite(value)) return 'No data yet';
  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
  return formatter.format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

/** Return on spend reads as a multiple, e.g. "3.4x". */
export function formatMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No data yet';
  return `${value.toFixed(1)}x`;
}
