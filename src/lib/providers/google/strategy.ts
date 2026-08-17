import { StrategyContext, StrategyRecommendation } from './types';

export const STRATEGY_THRESHOLDS = {
  MIN_CONVERSIONS_FOR_MAX_CONVERSIONS: 15,
  MIN_ACCOUNT_AGE_DAYS_FOR_MAX_CLICKS: 14,
};

export function evaluateBiddingStrategy(context: StrategyContext): StrategyRecommendation {
  if (
    context.conversionCount >= STRATEGY_THRESHOLDS.MIN_CONVERSIONS_FOR_MAX_CONVERSIONS && 
    context.conversionTrackingReliability === 'HIGH'
  ) {
    return {
      strategy: 'MAXIMIZE_CONVERSIONS',
      confidence: 0.9,
      reasons: [
        'Strong reliable conversion history detected.',
        'Conversion tracking is marked as highly reliable.',
      ],
      safetyConstraints: [
        'Target CPA bounds must be enforced by adapter.',
        'No autonomous budget increases beyond 10% daily.',
      ]
    };
  }

  if (
    context.accountAgeDays >= STRATEGY_THRESHOLDS.MIN_ACCOUNT_AGE_DAYS_FOR_MAX_CLICKS &&
    context.conversionCount > 0
  ) {
    return {
      strategy: 'MAXIMIZE_CLICKS',
      confidence: 0.8,
      reasons: [
        'Intermediate conversion history available.',
        'Account has aged past the cold-start phase.',
      ],
      safetyConstraints: [
        'Max CPC bid limits must be enforced.',
        'Require owner approval for strategy transitions.',
      ]
    };
  }

  return {
    strategy: 'MANUAL_CPC',
    confidence: 1.0,
    reasons: [
      'Insufficient reliable conversion history.',
      'Conservative strategy selected for cold-start account.',
      'Conversion tracking does not yet provide enough evidence.',
    ],
    safetyConstraints: [
      'No autonomous strategy changes.',
      'No autonomous budget increases.',
      'Require owner approval.',
    ]
  };
}
