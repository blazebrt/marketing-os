/**
 * Comprehensive Provider Strategy Selection Layer for Google Ads
 */

export type GoogleBiddingStrategy = 'MAXIMIZE_CONVERSIONS' | 'MAXIMIZE_CLICKS' | 'MANUAL_CPC';

export interface StrategyContext {
  campaignType: string;
  campaignObjective: string;
  historicalConversions30Days: number;
  conversionReliabilityScore: number; // 0.0 to 1.0 (e.g., 1.0 = verified API/Pixel events, 0.0 = broken tracking)
  accountAgeDays: number;
  hasGoogleAdsRecommendations: boolean;
}

export interface StrategyRecommendation {
  strategy: GoogleBiddingStrategy;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
  safetyConstraints: string[];
}

export function evaluateBiddingStrategy(context: StrategyContext): StrategyRecommendation {
  const reasons: string[] = [];
  const safetyConstraints: string[] = [];

  // V1 Constraints
  safetyConstraints.push("No autonomous strategy updates post-launch in V1.");

  // Base fallback check
  if (context.campaignType !== 'SEARCH') {
    reasons.push(`Campaign type '${context.campaignType}' is not fully supported for automated bidding. Defaulting to safe manual control.`);
    return {
      strategy: 'MANUAL_CPC',
      confidence: 0.9,
      reasons,
      safetyConstraints
    };
  }

  const isDataSufficient = context.historicalConversions30Days >= 15 && context.conversionReliabilityScore > 0.8;

  if (isDataSufficient) {
    reasons.push("Account possesses sufficient, highly reliable conversion history (>= 15 conversions in 30 days).");
    reasons.push("Safe to deploy automated bidding based on proven data integrity.");
    if (context.hasGoogleAdsRecommendations) {
      reasons.push("Google Ads natively recommends adopting value/conversion based bidding.");
    }
    
    return {
      strategy: 'MAXIMIZE_CONVERSIONS',
      confidence: 0.95,
      reasons,
      safetyConstraints
    };
  }

  // Intermediate state (Some data, but not enough for safe conversion algorithms)
  if (context.historicalConversions30Days > 0 && context.conversionReliabilityScore > 0.5) {
    reasons.push("Some conversion history exists, but volume or reliability is insufficient for Maximize Conversions.");
    reasons.push("Deploying Maximize Clicks to safely drive traffic while building robust conversion data.");
    safetyConstraints.push("Monitor traffic quality daily; algorithm lacks explicit conversion targeting.");
    
    return {
      strategy: 'MAXIMIZE_CLICKS',
      confidence: 0.8,
      reasons,
      safetyConstraints
    };
  }

  // Cold Start / Insufficient Data
  reasons.push("Insufficient conversion history or low tracking reliability detected.");
  reasons.push("Automated bidding strategies require stable data to prevent runaway spending on low-quality traffic.");
  reasons.push("Defaulting to conservative Manual CPC to strictly constrain bid limits.");
  safetyConstraints.push("Strict daily budget caps applied alongside Manual CPC.");
  
  return {
    strategy: 'MANUAL_CPC',
    confidence: 1.0,
    reasons,
    safetyConstraints
  };
}
