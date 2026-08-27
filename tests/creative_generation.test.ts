import './setup';
import http from 'node:http';
import { repairAdCopy, meetsTargetCounts } from '../src/lib/providers/google/copyRepair';
import { validateCreativePayload, GOOGLE_LIMITS } from '../src/lib/providers/google/validation';
import { buildLlmCampaignContext, assertPromptIsSafe, LLM_PRIVACY } from '../src/lib/privacy/llm';
import { ERROR_CODES } from '../src/lib/errors';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('PASS: ' + msg); pass++; }
  else { console.error('FAIL: ' + msg); fail++; }
}

/** Stub Gemini endpoint. Returns whatever the current scenario dictates. */
let scenario: { status: number; body: unknown } = { status: 200, body: null };
const seenRequests: string[] = [];

function geminiReply(payload: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }], role: 'model' }, finishReason: 'STOP' }] };
}

function makeCopy(n: { h: number; d: number; k: number }, opts: { long?: boolean } = {}) {
  const pad = opts.long ? ' with an extremely long tail that will certainly exceed the permitted character allowance' : '';
  return {
    headlines: Array.from({ length: n.h }, (_, i) => `Bridal Makeup Offer ${i + 1}${pad}`),
    descriptions: Array.from({ length: n.d }, (_, i) => `Expert bridal makeup in Rajajipuram, book today number ${i + 1}${pad}`),
    keywords: Array.from({ length: n.k }, (_, i) => ({
      text: `bridal makeup lucknow ${i + 1}${pad}`,
      match_type: i % 3 === 0 ? 'EXACT' : 'PHRASE',
    })),
  };
}

async function main() {
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seenRequests.push(body);
    res.writeHead(scenario.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(scenario.body ?? { error: { message: 'stub failure' } }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`;

  const { generateAdCopy } = await import('../src/lib/llm/gemini');

  const context = {
    service: 'Bridal Makeup',
    offer: '20% Off',
    target_audience: 'Brides-to-be',
    location: 'Rajajipuram, Lucknow',
    destination_type: 'WEBSITE',
  };

  console.log('--- PRIVACY BOUNDARY ---');

  const fullRow = {
    ...context,
    owner_id: 'owner-uuid', landing_url: 'https://salon.example.com', budget_amount: 5000,
    encrypted_credentials: 'SECRET', refresh_token: 'REFRESH', creative_id: 'cid',
  };
  const safeContext = buildLlmCampaignContext(fullRow);
  assert(Object.keys(safeContext).length === LLM_PRIVACY.allowedFields.length,
    'Context contains exactly the allow-listed fields');
  assert(!JSON.stringify(safeContext).includes('SECRET') && !JSON.stringify(safeContext).includes('REFRESH'),
    'Credentials are dropped from the model context');
  assert(!JSON.stringify(safeContext).includes('salon.example.com') && !JSON.stringify(safeContext).includes('5000'),
    'Landing URL and budget are dropped from the model context');
  assert(LLM_PRIVACY.currentlyExternal === true, 'Privacy module records that calls now leave the app');

  for (const [label, bad] of [
    ['a customer email', 'Write ads. Contact asha@example.com'],
    ['a customer phone number', 'Write ads for +91 98765 43210'],
    ['a bearer token', 'Write ads. Bearer ya29.abcdefghijklmnop'],
    ['a refresh token field', 'Write ads. refresh_token: xyz'],
  ] as const) {
    let threw = false;
    try { assertPromptIsSafe(bad); } catch { threw = true; }
    assert(threw, `Prompt guard blocks ${label}`);
  }

  let threwEnv = false;
  try {
    process.env.GEMINI_API_KEY = 'super-secret-value-123';
    assertPromptIsSafe('Write ads using key super-secret-value-123');
  } catch { threwEnv = true; }
  assert(threwEnv, 'Prompt guard blocks a live API key value');
  process.env.GEMINI_API_KEY = 'stub-key';

  console.log('\n--- REPAIR AND VALIDATION ---');

  const longCopy = makeCopy({ h: 15, d: 4, k: 20 }, { long: true });
  const repairedLong = repairAdCopy(longCopy as never);
  assert(repairedLong.headlines.every((h) => h.length <= GOOGLE_LIMITS.HEADLINE_MAX_LENGTH),
    'Over-long headlines are truncated to the Google limit');
  assert(repairedLong.descriptions.every((d) => d.length <= GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH),
    'Over-long descriptions are truncated to the Google limit');
  assert(repairedLong.keywords.every((k) => k.text.length <= GOOGLE_LIMITS.KEYWORD_MAX_LENGTH),
    'Over-long keywords are truncated to the Google limit');
  assert(repairedLong.headlines.every((h) => !h.endsWith(' ') && !/[,;:.!?-]$/.test(h)),
    'Truncation cuts cleanly, leaving no trailing space or punctuation');

  const messy = {
    headlines: ['Bridal  Makeup\nOffer', 'BRIDAL MAKEUP OFFER', 'bridal makeup offer', 'Third Headline'],
    descriptions: ['Line\twith\tcontrol chars in it for the salon', 'Another description for the salon today'],
    keywords: [{ text: 'bridal, makeup! (lucknow)', match_type: 'PHRASE' }, { text: 'bridal makeup lucknow', match_type: 'EXACT' }],
  };
  const repairedMessy = repairAdCopy(messy as never);
  assert(repairedMessy.headlines.every((h) => !/[\n\t]/.test(h)), 'Control characters are stripped');
  assert(repairedMessy.headlines.length === 2, 'Case-insensitive duplicates are removed');
  assert(repairedMessy.keywords.every((k) => !/[!@#$%^&*(),.]/.test(k.text)), 'Keyword punctuation is stripped');
  assert(repairedMessy.keywords.length === 1, 'Keywords that collide after cleaning are de-duplicated');

  const good = repairAdCopy(makeCopy({ h: 15, d: 4, k: 20 }) as never);
  const v = validateCreativePayload({
    headlines: good.headlines, descriptions: good.descriptions, keywords: good.keywords.map((k) => k.text),
  });
  assert(v.valid, 'A repaired full set passes the unchanged validation in validation.ts');
  assert(meetsTargetCounts(good), 'A full set meets the 15/4/~20 target counts');
  assert(good.keywords.some((k) => k.match_type === 'PHRASE') && good.keywords.some((k) => k.match_type === 'EXACT'),
    'Keywords carry a mix of PHRASE and EXACT match types');

  console.log('\n--- MODEL CALL BEHAVIOUR ---');

  delete process.env.GEMINI_API_KEY;
  let code = '';
  try { await generateAdCopy(context); } catch (e) { code = (e as Error).message; }
  assert(code === ERROR_CODES.LLM_NOT_CONFIGURED, 'Missing API key fails with LLM_NOT_CONFIGURED, no template fallback');
  process.env.GEMINI_API_KEY = 'stub-key';

  scenario = { status: 500, body: { error: { message: 'upstream boom' } } };
  code = '';
  try { await generateAdCopy(context); } catch (e) { code = (e as Error).message; }
  assert(code === ERROR_CODES.LLM_UNAVAILABLE, 'A provider failure fails with LLM_UNAVAILABLE, no template fallback');

  scenario = { status: 200, body: geminiReply({ nonsense: true }) };
  code = '';
  try { await generateAdCopy(context); } catch (e) { code = (e as Error).message; }
  assert(code === ERROR_CODES.LLM_INVALID_OUTPUT, 'Unusable model output fails with LLM_INVALID_OUTPUT');

  seenRequests.length = 0;
  scenario = { status: 200, body: geminiReply(makeCopy({ h: 15, d: 4, k: 20 })) };
  const result = await generateAdCopy(context);
  assert(result.headlines.length === 15 && result.descriptions.length === 4 && result.keywords.length === 20,
    'A well-formed response is parsed into headlines, descriptions and keywords');

  const sent = seenRequests.join('\n');
  assert(sent.includes('Bridal Makeup') && sent.includes('Rajajipuram') && sent.includes('Brides-to-be'),
    'The prompt carries service, location and audience');
  assert(!sent.includes('owner-uuid') && !sent.includes('salon.example.com') && !sent.includes('SECRET'),
    'The prompt carries no owner id, landing URL or credential');
  assert(sent.includes('India') || sent.includes('Indian'), 'The prompt asks for Indian-market copy');

  server.close();
  console.log(`\n--- CREATIVE GENERATION: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
