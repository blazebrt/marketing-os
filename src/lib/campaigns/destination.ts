export const DESTINATION_TYPES = ['WEBSITE', 'WHATSAPP', 'PHONE'] as const;
export type DestinationType = (typeof DESTINATION_TYPES)[number];

export function parseDestinationType(value: unknown): DestinationType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if ((DESTINATION_TYPES as readonly string[]).includes(normalized)) {
    return normalized as DestinationType;
  }
  const lower = value.trim().toLowerCase();
  if (lower === 'website' || lower === 'website + whatsapp') return 'WEBSITE';
  if (lower === 'whatsapp') return 'WHATSAPP';
  if (lower === 'phone') return 'PHONE';
  return null;
}

/** Google Ads RSA deployment is only allowed for website landing URLs. */
export function isGoogleAdsDeployable(destinationType: DestinationType | null, channels: string[]): boolean {
  const hasGoogle = (channels || []).some((c) => c.toLowerCase() === 'google');
  return hasGoogle && destinationType === 'WEBSITE';
}

export function googleAdsDestinationRejection(destinationType: DestinationType | null, channels: string[]): string | null {
  const hasGoogle = (channels || []).some((c) => c.toLowerCase() === 'google');
  if (!hasGoogle) return null;
  if (destinationType !== 'WEBSITE') {
    return 'GOOGLE_DESTINATION_UNSUPPORTED';
  }
  return null;
}
