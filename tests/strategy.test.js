// Standalone execution script for testing the Strategy Evaluator Logic
function evaluateBiddingStrategy(context) {
  const reasons = [];
  const safetyConstraints = [];

  // V1 Constraints
  safetyConstraints.push("No autonomous strategy updates post-launch in V1.");

  if (context.campaignType !== 'SEARCH') {
    reasons.push(`Campaign type '${context.campaignType}' is not fully supported for automated bidding. Defaulting to safe manual control.`);
    return { strategy: 'MANUAL_CPC', confidence: 0.9, reasons, safetyConstraints };
  }

  const isDataSufficient = context.historicalConversions30Days >= 15 && context.conversionReliabilityScore > 0.8;

  if (isDataSufficient) {
    reasons.push("Account possesses sufficient, highly reliable conversion history (>= 15 conversions in 30 days).");
    reasons.push("Safe to deploy automated bidding based on proven data integrity.");
    if (context.hasGoogleAdsRecommendations) reasons.push("Google Ads natively recommends adopting value/conversion based bidding.");
    return { strategy: 'MAXIMIZE_CONVERSIONS', confidence: 0.95, reasons, safetyConstraints };
  }

  if (context.historicalConversions30Days > 0 && context.conversionReliabilityScore > 0.5) {
    reasons.push("Some conversion history exists, but volume or reliability is insufficient for Maximize Conversions.");
    reasons.push("Deploying Maximize Clicks to safely drive traffic while building robust conversion data.");
    safetyConstraints.push("Monitor traffic quality daily; algorithm lacks explicit conversion targeting.");
    return { strategy: 'MAXIMIZE_CLICKS', confidence: 0.8, reasons, safetyConstraints };
  }

  reasons.push("Insufficient conversion history or low tracking reliability detected.");
  reasons.push("Automated bidding strategies require stable data to prevent runaway spending on low-quality traffic.");
  reasons.push("Defaulting to conservative Manual CPC to strictly constrain bid limits.");
  safetyConstraints.push("Strict daily budget caps applied alongside Manual CPC.");
  
  return { strategy: 'MANUAL_CPC', confidence: 1.0, reasons, safetyConstraints };
}

console.log('--- Running Provider Strategy Evaluator Tests ---\n');

const printRec = (name, ctx) => {
  const rec = evaluateBiddingStrategy(ctx);
  console.log(`[TEST] ${name}`);
  console.log(`Strategy: ${rec.strategy} (Confidence: ${rec.confidence})`);
  console.log(`Safety Constraints: ${rec.safetyConstraints[0]}`);
  console.log(`Reasons:`);
  rec.reasons.forEach(r => console.log(`  - ${r}`));
  console.log('');
};

printRec('Insufficient Conversion History (Cold Start)', {
  campaignType: 'SEARCH', historicalConversions30Days: 0, conversionReliabilityScore: 0.0
});

printRec('Sufficient Conversion History + Reliable Data', {
  campaignType: 'SEARCH', historicalConversions30Days: 20, conversionReliabilityScore: 0.9, hasGoogleAdsRecommendations: true
});

printRec('Intermediate Data (Some Conversions, Low Reliability)', {
  campaignType: 'SEARCH', historicalConversions30Days: 5, conversionReliabilityScore: 0.6
});

printRec('Invalid Strategy Selection (Not a Search Campaign)', {
  campaignType: 'DISPLAY', historicalConversions30Days: 100, conversionReliabilityScore: 1.0
});
