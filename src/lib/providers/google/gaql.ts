/**
 * GAQL string literals are single-quoted. User- or API-supplied values must
 * never be interpolated raw, or a quote can change the query.
 */
export function gaqlStringLiteral(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('Invalid GAQL literal');
  }
  if (/[\n\r\u0000]/.test(value)) {
    throw new Error('Invalid GAQL literal');
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Customer / manager ids in GAQL must be digits only — never interpolated raw. */
export function gaqlIntLiteral(value: string): string {
  const clean = value.replace(/-/g, '');
  if (!/^\d{1,20}$/.test(clean)) {
    throw new Error('Invalid GAQL integer');
  }
  return clean;
}
