export type GoogleCreativeItem = {
  id: string;
  original_value: string;
  current_value: string;
  ai_generated: boolean;
  owner_approved: boolean;
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

export type GoogleTargetState = {
  provider: 'google';
  schemaVersion: 'v1';
  generatedAt: string;
  campaign: {
    id: string;
    owner_id: string;
    budget_type: string;
    budget_amount: number;
    destination: string;
  };
  strategyRecommendation: StrategyRecommendation;
  creative: {
    headlines: GoogleCreativeItem[];
    descriptions: GoogleCreativeItem[];
    keywords: GoogleCreativeItem[];
  };
};
