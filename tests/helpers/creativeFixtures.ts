import { randomUUID } from 'crypto';
import type { GoogleCreativeItem } from '../../src/lib/providers/google/types';

/**
 * Builds creative rows for seeding test databases.
 *
 * This replaces the old src/lib/providers/google/ai.ts mock generator, which
 * these tests used only as a fixture builder. The production generator now
 * calls a real model, so it is not usable as a fixture. The shape here matches
 * what that mock returned, so the assertions around it are unchanged.
 */
export function buildCreativeFixture(campaignContext: { service: string; offer?: string }) {
  const keywordStr = campaignContext.offer
    ? `${campaignContext.service} ${campaignContext.offer}`
    : campaignContext.service;

  const keywords: GoogleCreativeItem[] = [
    {
      id: randomUUID(),
      original_value: keywordStr.substring(0, 80),
      current_value: keywordStr.substring(0, 80),
      ai_generated: true,
      owner_approved: false,
      match_type: 'PHRASE',
    },
  ];

  const headlines: GoogleCreativeItem[] = [
    {
      id: randomUUID(),
      original_value: campaignContext.service.substring(0, 30),
      current_value: campaignContext.service.substring(0, 30),
      ai_generated: true,
      owner_approved: false,
    },
  ];

  const descriptions: GoogleCreativeItem[] = [
    {
      id: randomUUID(),
      original_value: `Book our ${campaignContext.service.substring(0, 50)} today`,
      current_value: `Book our ${campaignContext.service.substring(0, 50)} today`,
      ai_generated: true,
      owner_approved: false,
    },
  ];

  return { keywords, headlines, descriptions };
}
