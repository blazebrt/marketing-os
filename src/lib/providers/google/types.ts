export type GoogleCreativeItem = {
  id: string;
  original_value: string;
  current_value: string;
  ai_generated: boolean;
  owner_approved: boolean | null;
  rejected?: boolean;
  approved_at?: string | null;
  match_type?: 'EXACT' | 'PHRASE'; 
};

export type StrategyContext = {
  campaignType: string;
  conversionCount: number;
  conversionWindowDays: number;
  conversionTrackingReliability: 'HIGH' | 'LOW' | 'UNKNOWN';
  budgetAmount: number;
  accountAgeDays: number;
};

export type BiddingStrategy = 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';

export type StrategyRecommendation = {
  strategy: BiddingStrategy;
  confidence: number;
  reasons: string[];
  safetyConstraints: string[];
};

export interface GoogleTargetState {
  schemaVersion: 'v1';
  provider: 'google';
  campaign: {
    id: string;
    budget: number;
    duration: number;
    destination: string;
  };
  bidding: {
    strategy: 'MANUAL_CPC' | 'MAXIMIZE_CLICKS' | 'MAXIMIZE_CONVERSIONS';
    confidence: number;
    reasons: string[];
    safetyConstraints: string[];
  };
  adGroup: {
    name: string;
    type: string;
  };
  keywords: GoogleCreativeItem[];
  headlines: GoogleCreativeItem[];
  descriptions: GoogleCreativeItem[];
  destination: {
    url: string;
    tracking: string;
  };
  generatedAt: string;
};
