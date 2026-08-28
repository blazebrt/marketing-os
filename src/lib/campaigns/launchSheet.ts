import type { GoogleCreativeItem } from '@/lib/providers/google/types';

/**
 * Turns an approved campaign into the exact values an owner types into Google
 * Ads Manager. Pure data, so it can be tested without a browser.
 *
 * Only owner-approved items appear. Rejected items and items still awaiting a
 * decision are excluded, so what is copied is what was actually signed off.
 */

export type LaunchCampaign = {
  service: string;
  offer: string;
  max_daily_spend: number | string;
  duration_days: number | string;
  location: string | null;
  landing_url: string | null;
  destination: string | null;
  destination_type: string | null;
};

export type LaunchSheet = {
  campaignName: string;
  campaignType: string;
  biddingStrategy: string;
  dailyBudget: number;
  durationDays: number;
  endDate: string | null;
  location: string | null;
  finalUrl: string | null;
  headlines: string[];
  descriptions: string[];
  keywords: { text: string; matchType: 'EXACT' | 'PHRASE'; googleSyntax: string }[];
  /** Blocking reasons: an empty list means the sheet is complete. */
  missing: string[];
};

function approved(items: unknown): GoogleCreativeItem[] {
  if (!Array.isArray(items)) return [];
  return (items as GoogleCreativeItem[]).filter(
    (i) => i && i.owner_approved === true && !i.rejected && typeof i.current_value === 'string' && i.current_value.trim() !== ''
  );
}

function toNumber(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Google's own match-type notation, so the keyword block can be pasted
 * straight in: [brackets] for exact, "quotes" for phrase.
 */
export function googleKeywordSyntax(text: string, matchType: 'EXACT' | 'PHRASE'): string {
  return matchType === 'EXACT' ? `[${text}]` : `"${text}"`;
}

export function buildLaunchSheet(
  campaign: LaunchCampaign,
  creativeGoogle: { headlines?: unknown; descriptions?: unknown; keywords?: unknown } | null,
  today: Date = new Date()
): LaunchSheet {
  const headlines = approved(creativeGoogle?.headlines).map((i) => i.current_value);
  const descriptions = approved(creativeGoogle?.descriptions).map((i) => i.current_value);
  const keywords = approved(creativeGoogle?.keywords).map((i) => {
    const matchType: 'EXACT' | 'PHRASE' = i.match_type === 'PHRASE' ? 'PHRASE' : 'EXACT';
    return { text: i.current_value, matchType, googleSyntax: googleKeywordSyntax(i.current_value, matchType) };
  });

  const dailyBudget = toNumber(campaign.max_daily_spend);
  const durationDays = toNumber(campaign.duration_days);
  const finalUrl = campaign.landing_url?.trim() || null;

  let endDate: string | null = null;
  if (durationDays > 0) {
    const end = new Date(today.getTime());
    end.setUTCDate(end.getUTCDate() + durationDays);
    endDate = end.toISOString().slice(0, 10);
  }

  const missing: string[] = [];
  if (headlines.length < 3) missing.push(`Only ${headlines.length} approved headlines. Google needs at least 3.`);
  if (descriptions.length < 2) missing.push(`Only ${descriptions.length} approved descriptions. Google needs at least 2.`);
  if (keywords.length < 1) missing.push('No approved keywords.');
  if (!finalUrl) missing.push('No landing page URL on this campaign.');
  if (dailyBudget <= 0) missing.push('Daily budget is not set.');
  if (!campaign.location?.trim()) missing.push('No target area was entered, so choose one in Google yourself.');

  return {
    campaignName: `${campaign.service} - Google Search`,
    campaignType: 'Search',
    // Matches the bidding recorded in the approval snapshot.
    biddingStrategy: 'Manual CPC (no enhanced CPC)',
    dailyBudget,
    durationDays,
    endDate,
    location: campaign.location?.trim() || null,
    finalUrl,
    headlines,
    descriptions,
    keywords,
    missing,
  };
}

/** Google campaign ids are int64. Owners paste them with stray spaces or dashes. */
export function normaliseGoogleCampaignId(raw: string): string | null {
  const cleaned = (raw || '').replace(/[\s-]/g, '');
  if (!/^\d{6,15}$/.test(cleaned)) return null;
  return cleaned;
}
