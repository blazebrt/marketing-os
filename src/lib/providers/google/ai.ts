/**
 * AI Keyword and Ad Copy Generation Mock for Google Ads
 */

export interface GoogleCreativePlan {
  headlines: string[];
  descriptions: string[];
  keywords: { keyword: string; match_type: string; ai_generated: boolean; owner_approved: boolean }[];
}

export async function generateSearchCreativePlan(service: string, offer: string): Promise<GoogleCreativePlan> {
  // In reality, this would call OpenAI API
  // Using a mock to safely simulate AI creative generation for the integration flow
  
  return {
    headlines: [
      `Lakme Salon - ${service}`,
      `Exclusive Offer: ${offer}`,
      `Book ${service} Today`
    ],
    descriptions: [
      `Experience the best ${service} at Lakme Salon Rajajipuram.`,
      `Claim your ${offer} now and book an appointment with our expert stylists.`
    ],
    keywords: [
      { keyword: `best ${service} near me`, match_type: 'exact', ai_generated: true, owner_approved: false },
      { keyword: `${service} rajajipuram`, match_type: 'phrase', ai_generated: true, owner_approved: false },
      { keyword: `salon ${offer}`, match_type: 'phrase', ai_generated: true, owner_approved: false }
    ]
  };
}
