import { validateDestinationUrlSyntax } from '@/lib/urlValidator';

/** Unified campaigns store `service`/`offer`, not a Google-style `name`. */
export function campaignDisplayName(campaign: {
  service?: unknown;
  offer?: unknown;
}): string {
  if (typeof campaign.service === 'string' && campaign.service.trim()) {
    return campaign.service.trim().slice(0, 200);
  }
  if (typeof campaign.offer === 'string' && campaign.offer.trim()) {
    return campaign.offer.trim().slice(0, 200);
  }
  return 'Campaign';
}

/**
 * Ads need an https URL. `destination` on the campaign row is a type
 * (WEBSITE / WHATSAPP / PHONE); the URL lives in `landing_url`. Older rows
 * and tests may still store a URL in `destination`.
 */
export function campaignLandingUrl(campaign: {
  landing_url?: unknown;
  destination?: unknown;
}): string | null {
  if (typeof campaign.landing_url === 'string' && campaign.landing_url.trim()) {
    return campaign.landing_url.trim();
  }
  if (typeof campaign.destination === 'string') {
    const dest = campaign.destination.trim();
    if (/^https?:\/\//i.test(dest)) return dest;
  }
  return null;
}

export function requireCampaignLandingUrl(campaign: {
  landing_url?: unknown;
  destination?: unknown;
}): string {
  const url = campaignLandingUrl(campaign);
  if (!url) throw new Error('Destination invalid');
  const syntax = validateDestinationUrlSyntax(url);
  if (!syntax.valid) throw new Error('Destination invalid');
  return url;
}
