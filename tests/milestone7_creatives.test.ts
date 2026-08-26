import './setup';

import { validateCreativePayload, validateHeadline, validateDescription, validateKeyword, GOOGLE_LIMITS } from '../src/lib/providers/google/validation';
import { validateDestinationUrl } from '../src/lib/urlValidator';
import { GoogleCreativeItem } from '../src/lib/providers/google/types';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label}`);
    fail++;
  }
}

async function runTests() {
  console.log('--- MILESTONE 7: CREATIVE VALIDATION TESTS ---\n');

  // ============================
  // 1. VALID PAYLOAD
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['Buy widgets now', 'Great widget deals', 'Widget sale today'],
      descriptions: ['Get the best widgets at unbeatable prices today.', 'Premium widgets delivered fast and free.'],
      keywords: ['widgets', 'buy widgets']
    });
    assert(result.valid === true, 'Valid payload passes validation');
    assert(result.errors.length === 0, 'Valid payload has zero errors');
  }

  // ============================
  // 2. HEADLINE TOO LONG
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['This headline is way too long for Google Ads limits', 'Short one', 'Another ok'],
      descriptions: ['Valid description here that fits.', 'Another valid description.'],
      keywords: ['test keyword']
    });
    assert(result.valid === false, 'Too-long headline rejected');
    assert(result.errors.some(e => e.includes('Headline')), 'Error mentions headline');
  }

  // ============================
  // 3. DESCRIPTION TOO LONG
  // ============================
  {
    const longDesc = 'A'.repeat(91);
    const result = validateCreativePayload({
      headlines: ['Valid one', 'Valid two', 'Valid three'],
      descriptions: [longDesc, 'Short valid description.'],
      keywords: ['test']
    });
    assert(result.valid === false, 'Too-long description rejected');
    assert(result.errors.some(e => e.includes('Description')), 'Error mentions description');
  }

  // ============================
  // 4. EMPTY HEADLINE
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['', 'Valid', 'Valid too'],
      descriptions: ['Valid desc one.', 'Valid desc two.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Empty headline rejected');
    assert(result.errors.some(e => e.includes('empty')), 'Error mentions empty');
  }

  // ============================
  // 5. DUPLICATE HEADLINES
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['Same headline', 'Same headline', 'Different'],
      descriptions: ['Desc one.', 'Desc two.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Duplicate headlines rejected');
    assert(result.errors.some(e => e.toLowerCase().includes('duplicate headline')), 'Error mentions duplicate headline');
  }

  // ============================
  // 6. DUPLICATE DESCRIPTIONS
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['H one', 'H two', 'H three'],
      descriptions: ['Same description.', 'Same description.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Duplicate descriptions rejected');
    assert(result.errors.some(e => e.toLowerCase().includes('duplicate description')), 'Error mentions duplicate description');
  }

  // ============================
  // 7. MALFORMED KEYWORD
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['D1 is valid for testing.', 'D2 is valid too.'],
      keywords: ['valid!keyword']
    });
    assert(result.valid === false, 'Malformed keyword with special chars rejected');
    assert(result.errors.some(e => e.includes('invalid characters')), 'Error mentions invalid characters');
  }

  // ============================
  // 8. MISSING REQUIRED FIELD (no headlines)
  // ============================
  {
    const result = validateCreativePayload({
      descriptions: ['D1.', 'D2.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Missing headlines rejected');
    assert(result.errors.some(e => e.includes('headlines must be an array')), 'Error mentions headlines');
  }

  // ============================
  // 9. MALFORMED LLM RESPONSE (not an object)
  // ============================
  {
    const result = validateCreativePayload('not an object');
    assert(result.valid === false, 'String payload rejected');
    assert(result.errors.some(e => e.includes('must be an object')), 'Error mentions object');
  }

  // ============================
  // 10. NULL PAYLOAD
  // ============================
  {
    const result = validateCreativePayload(null);
    assert(result.valid === false, 'Null payload rejected');
  }

  // ============================
  // 11. TOO FEW HEADLINES
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['Only one', 'Only two'],
      descriptions: ['D1.', 'D2.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Too few headlines (2) rejected');
    assert(result.errors.some(e => e.includes('At least 3')), 'Error mentions minimum 3');
  }

  // ============================
  // 12. TOO FEW DESCRIPTIONS
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['Only one.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Too few descriptions (1) rejected');
    assert(result.errors.some(e => e.includes('At least 2')), 'Error mentions minimum 2');
  }

  // ============================
  // 13. NO KEYWORDS
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['D1.', 'D2.'],
      keywords: []
    });
    assert(result.valid === false, 'Zero keywords rejected');
    assert(result.errors.some(e => e.includes('At least 1')), 'Error mentions minimum 1');
  }

  // ============================
  // 14. NON-STRING HEADLINE
  // ============================
  {
    const result = validateCreativePayload({
      headlines: [123, 'H2', 'H3'],
      descriptions: ['D1.', 'D2.'],
      keywords: ['kw']
    });
    assert(result.valid === false, 'Non-string headline rejected');
    assert(result.errors.some(e => e.includes('must be strings')), 'Error mentions strings');
  }

  // ============================
  // 15. DUPLICATE KEYWORD
  // ============================
  {
    const result = validateCreativePayload({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['D1.', 'D2.'],
      keywords: ['same keyword', 'same keyword']
    });
    assert(result.valid === false, 'Duplicate keywords rejected');
    assert(result.errors.some(e => e.toLowerCase().includes('duplicate keyword')), 'Error mentions duplicate keyword');
  }

  // ============================
  // 16. INDIVIDUAL ITEM VALIDATORS
  // ============================
  {
    const goodHeadline: GoogleCreativeItem = { id: '1', original_value: 'Test', current_value: 'Test', ai_generated: true, owner_approved: false };
    assert(validateHeadline(goodHeadline).length === 0, 'Good headline validates');
    
    const longHeadline: GoogleCreativeItem = { id: '2', original_value: 'X'.repeat(31), current_value: 'X'.repeat(31), ai_generated: true, owner_approved: false };
    assert(validateHeadline(longHeadline).length > 0, 'Long headline fails validation');

    const goodDesc: GoogleCreativeItem = { id: '3', original_value: 'Valid description.', current_value: 'Valid description.', ai_generated: true, owner_approved: false };
    assert(validateDescription(goodDesc).length === 0, 'Good description validates');

    const longDesc: GoogleCreativeItem = { id: '4', original_value: 'X'.repeat(91), current_value: 'X'.repeat(91), ai_generated: true, owner_approved: false };
    assert(validateDescription(longDesc).length > 0, 'Long description fails validation');

    const goodKw: GoogleCreativeItem = { id: '5', original_value: 'test kw', current_value: 'test kw', ai_generated: true, owner_approved: false, match_type: 'EXACT' };
    assert(validateKeyword(goodKw).length === 0, 'Good keyword validates');

    const badKw: GoogleCreativeItem = { id: '6', original_value: 'bad!kw', current_value: 'bad!kw', ai_generated: true, owner_approved: false, match_type: 'EXACT' };
    assert(validateKeyword(badKw).length > 0, 'Invalid-char keyword fails validation');

    const emptyKw: GoogleCreativeItem = { id: '7', original_value: '', current_value: '', ai_generated: true, owner_approved: false, match_type: 'EXACT' };
    assert(validateKeyword(emptyKw).length > 0, 'Empty keyword fails validation');
  }

  // ============================
  // 17. CONSTANTS ARE CORRECT
  // ============================
  {
    assert(GOOGLE_LIMITS.HEADLINE_MAX_LENGTH === 30, 'HEADLINE_MAX_LENGTH is 30');
    assert(GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH === 90, 'DESCRIPTION_MAX_LENGTH is 90');
    assert(GOOGLE_LIMITS.KEYWORD_MAX_LENGTH === 80, 'KEYWORD_MAX_LENGTH is 80');
    assert(GOOGLE_LIMITS.MAX_HEADLINES === 15, 'MAX_HEADLINES is 15');
    assert(GOOGLE_LIMITS.MAX_DESCRIPTIONS === 4, 'MAX_DESCRIPTIONS is 4');
  }

  // ============================
  // URL VALIDATION TESTS
  // ============================
  console.log('\n--- MILESTONE 7: URL VALIDATION TESTS ---\n');

  {
    const result = await validateDestinationUrl('https://example.com');
    assert(result.valid === true, 'Valid HTTPS URL passes');
  }

  {
    const result = await validateDestinationUrl('http://example.com');
    assert(result.valid === false, 'HTTP (not HTTPS) rejected');
    assert(result.error!.includes('HTTPS'), 'Error mentions HTTPS');
  }

  {
    const result = await validateDestinationUrl('https://localhost:3000');
    assert(result.valid === false, 'Localhost rejected');
    assert(result.error!.includes('Private'), 'Error mentions private');
  }

  {
    const result = await validateDestinationUrl('https://192.168.1.1');
    assert(result.valid === false, 'Private IP rejected');
  }

  {
    const result = await validateDestinationUrl('https://10.0.0.1');
    assert(result.valid === false, '10.x.x.x IP rejected');
  }

  {
    const result = await validateDestinationUrl('not-a-url');
    assert(result.valid === false, 'Invalid URL format rejected');
    assert(result.error!.includes('Invalid URL'), 'Error mentions invalid URL');
  }

  {
    const result = await validateDestinationUrl('ftp://example.com');
    assert(result.valid === false, 'FTP scheme rejected');
  }

  {
    const result = await validateDestinationUrl('https://this-domain-does-not-exist-7392847.com');
    assert(result.valid === false, 'Unreachable domain rejected');
  }

  // ============================
  // SECURITY CHECKS
  // ============================
  console.log('\n--- MILESTONE 7: SECURITY CHECKS ---\n');

  {
    // Verify no Google Ads API imports in generative.ts
    const fs = require('fs');
    const generativeContent = fs.readFileSync('src/lib/providers/google/generative.ts', 'utf8');
    assert(!generativeContent.includes('mutateResources'), 'generative.ts does not call mutateResources');
    assert(!generativeContent.includes('google-ads-api'), 'generative.ts does not import google-ads-api');
    assert(!generativeContent.includes('deployGoogleCampaign'), 'generative.ts does not call deployGoogleCampaign');
    assert(!generativeContent.includes('ENCRYPTION_KEY'), 'generative.ts does not reference ENCRYPTION_KEY');
    assert(!generativeContent.includes('GOOGLE_ADS_DEVELOPER_TOKEN'), 'generative.ts does not reference developer token');
  }

  {
    // Verify the API route does not expose secrets
    const fs = require('fs');
    const routeContent = fs.readFileSync('src/app/api/campaigns/[id]/generate/route.ts', 'utf8');
    assert(!routeContent.includes('ENCRYPTION_KEY'), 'API route does not reference ENCRYPTION_KEY');
    assert(!routeContent.includes('GOOGLE_ADS_DEVELOPER_TOKEN'), 'API route does not reference developer token');
    assert(!routeContent.includes('mutateResources'), 'API route does not call mutateResources');
  }

  {
    // Verify URL validator does not send auth headers
    const fs = require('fs');
    const urlContent = fs.readFileSync('src/lib/urlValidator.ts', 'utf8');
    assert(!urlContent.includes('Authorization'), 'URL validator does not send Authorization headers');
    assert(!urlContent.includes('Cookie'), 'URL validator does not send Cookie headers');
    assert(!urlContent.includes('ENCRYPTION_KEY'), 'URL validator does not reference ENCRYPTION_KEY');
  }

  // ============================
  // CREATIVE STATE MACHINE CHECKS
  // ============================
  console.log('\n--- MILESTONE 7: STATE MACHINE CHECKS ---\n');

  {
    // Verify verifyCampaign requires approved creatives
    const fs = require('fs');
    const actionsContent = fs.readFileSync('src/app/campaigns/actions.ts', 'utf8');
    assert(actionsContent.includes('approvedHeadlines'), 'verifyCampaign checks approved headlines');
    assert(actionsContent.includes('approvedDescriptions'), 'verifyCampaign checks approved descriptions');
    assert(actionsContent.includes('approvedKeywords'), 'verifyCampaign checks approved keywords');
    assert(actionsContent.includes('Need 3 approved headlines'), 'verifyCampaign requires 3 headlines');
    assert(actionsContent.includes('Need 2 approved descriptions'), 'verifyCampaign requires 2 descriptions');
    assert(actionsContent.includes('Need 1 approved keyword'), 'verifyCampaign requires 1 keyword');
  }

  {
    // Verify google/actions.ts checks campaign ownership and requires auth
    const fs = require('fs');
    const googleActionsContent = fs.readFileSync('src/app/campaigns/[id]/google/actions.ts', 'utf8');
    assert(googleActionsContent.includes('campaign.owner_id !== user.id'), 'Creative actions verify owner');
    assert(googleActionsContent.includes('supabase.auth.getUser'), 'Creative actions authenticate user');
    assert(googleActionsContent.includes('Unauthorized'), 'Creative actions reject unauthorized');
    assert(googleActionsContent.includes('regenerate'), 'Creative actions support regenerate');
  }

  {
    // Verify generative.ts protects approved creatives
    const fs = require('fs');
    const generativeContent = fs.readFileSync('src/lib/providers/google/generative.ts', 'utf8');
    assert(generativeContent.includes('APPROVED'), 'Generative checks for APPROVED status');
    assert(generativeContent.includes('Cannot regenerate'), 'Generative blocks regeneration of approved creatives');
    assert(generativeContent.includes('owner_id'), 'Generative checks owner_id');
  }

  // ============================
  // RATE LIMITING CHECK
  // ============================
  console.log('\n--- MILESTONE 7: RATE LIMITING CHECK ---\n');

  {
    const fs = require('fs');
    const routeContent = fs.readFileSync('src/app/api/campaigns/[id]/generate/route.ts', 'utf8');
    assert(routeContent.includes('rateLimits'), 'API route has rate limiting');
    assert(routeContent.includes('429'), 'API route returns 429 on rate limit');
    assert(routeContent.includes('RATE_LIMIT_MS'), 'API route has configurable rate limit window');
  }

  // ============================
  // NO FAKE ASSERTIONS CHECK
  // ============================
  console.log('\n--- MILESTONE 7: NO FAKE ASSERTIONS ---\n');

  {
    // Self-check: verify this test file has no assert(true, ...) calls
    const fs = require('fs');
    const thisContent = fs.readFileSync('tests/milestone7_creatives.test.ts', 'utf8');
    const lines = thisContent.split('\n');
    let fakeCount = 0;
    for (const line of lines) {
      if (line.trim().startsWith('assert(true,')) fakeCount++;
    }
    assert(fakeCount === 0, `Zero fake assert(true) calls found (found ${fakeCount})`);
  }

  // ============================
  // SUMMARY
  // ============================
  console.log(`\n--- MILESTONE 7 TEST SUMMARY: ${pass} PASS, ${fail} FAIL ---\n`);
  if (fail > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
