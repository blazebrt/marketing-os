import './setup';
import crypto from 'crypto';
import { __setMockCreateClient } from '../src/lib/supabase/server';
import { createM7Database, setAuthUid, createPgLiteSupabase } from './helpers/m7Harness';
import { startStubGemini } from './helpers/stubGemini';
import { generateAndSaveGoogleCreatives } from '../src/lib/providers/google/generative';
import { updateGoogleCreativeItem } from '../src/app/campaigns/[id]/google/actions';
import { POST as generatePOST } from '../src/app/api/campaigns/[id]/generate/route';
import { NextRequest } from 'next/server';
import { validateCreativePayload, GOOGLE_LIMITS } from '../src/lib/providers/google/validation';
import { ERROR_CODES } from '../src/lib/errors';

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

function approvedItems() {
  return {
    headlines: [
      item('h1', 'Buy widgets now', true),
      item('h2', 'Great widget deals', true),
      item('h3', 'Widget sale today', true),
    ],
    descriptions: [
      item('d1', 'Get the best widgets at unbeatable prices today.', true),
      item('d2', 'Premium widgets delivered fast and free.', true),
    ],
    keywords: [kw('k1', 'widgets', true)],
  };
}

function item(id: string, value: string, approved: boolean, rejected = false) {
  return {
    id,
    original_value: value,
    current_value: value,
    ai_generated: true,
    owner_approved: approved,
    rejected,
    match_type: undefined,
  };
}
function kw(id: string, value: string, approved: boolean, rejected = false) {
  return { ...item(id, value, approved, rejected), match_type: 'EXACT' };
}

async function seedCampaign(db: any, ownerId: string, overrides: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.unified_campaigns
      (id, owner_id, service, offer, budget_type, budget_amount, duration_days, max_daily_spend, max_campaign_spend, destination, destination_type, landing_url, destination_verification_status, channels, status)
     values ($1,$2,'Salon','20% Off','daily',1000,30,1000,30000,'WEBSITE','WEBSITE','https://example.com/','VALID', ARRAY['google'], 'DRAFT')`,
    [id, ownerId]
  );
  if (Object.keys(overrides).length) {
    const sets = Object.entries(overrides)
      .map(([k, v], i) => `${k} = $${i + 2}`)
      .join(', ');
    await db.query(`update public.unified_campaigns set ${sets} where id = $1`, [id, ...Object.values(overrides)]);
  }
  return id;
}

async function run() {
  // The generator calls a real model with no fallback, so give it one to answer.
  const stubGemini = await startStubGemini();

  console.log('--- M7 INTEGRATION TESTS ---\n');

  {
    const malformed = validateCreativePayload('nope');
    assert(malformed.valid === false, 'malformed model output rejected');
    const oversized = validateCreativePayload({
      headlines: ['H1', 'H2', 'H3'],
      descriptions: ['D1 ok description.', 'D2 ok description.'],
      keywords: Array.from({ length: GOOGLE_LIMITS.MAX_KEYWORDS + 1 }, (_, i) => `kw${i}`),
    });
    assert(oversized.valid === false, 'oversized keyword list rejected');
    const dup = validateCreativePayload({
      headlines: ['Same', 'Same', 'Other'],
      descriptions: ['D1 ok description.', 'D2 ok description.'],
      keywords: ['kw'],
    });
    assert(dup.valid === false, 'duplicate content rejected');
    const ctrl = validateCreativePayload({
      headlines: ['Hello\nWorld', 'Valid two xx', 'Valid three'],
      descriptions: ['D1 ok description.', 'D2 ok description.'],
      keywords: ['kw'],
    });
    assert(ctrl.valid === false, 'newline headline rejected');
  }

  const db = await createM7Database();
  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  await db.query("insert into public.integrations (owner_id, provider, status) values ($1, 'google', 'connected')", [ownerA]);

  const campA = await seedCampaign(db, ownerA);
  const campB = await seedCampaign(db, ownerB);

  await setAuthUid(db, null);
  __setMockCreateClient(async () => createPgLiteSupabase(db, null));
  try {
    await generateAndSaveGoogleCreatives(campA);
    assert(false, 'anonymous generation rejected');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.UNAUTHORIZED, 'anonymous generation rejected');
  }

  const anonRes = await generatePOST(new NextRequest('http://localhost/api/campaigns/' + campA + '/generate', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  }), {
    params: Promise.resolve({ id: campA }),
  });
  assert(anonRes.status === 401, 'anonymous generate API rejected');

  await setAuthUid(db, ownerB);
  __setMockCreateClient(async () => createPgLiteSupabase(db, ownerB));
  try {
    await generateAndSaveGoogleCreatives(campA);
    assert(false, 'wrong owner rejected');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.UNAUTHORIZED, 'wrong owner rejected');
  }

  await setAuthUid(db, ownerA);
  __setMockCreateClient(async () => createPgLiteSupabase(db, ownerA));
  const gen = await generateAndSaveGoogleCreatives(campA);
  assert(!!gen.creativeId, 'correct owner succeeds');

  const { rows: campRows } = await db.query('select owner_id, creative_id from public.unified_campaigns where id=$1', [campA]) as any;
  assert(campRows[0].owner_id === ownerA, 'owner_id cannot be client-controlled');
  const { rows: crRows } = await db.query('select owner_id, campaign_id, status, name, type from public.creatives where id=$1', [gen.creativeId]) as any;
  assert(crRows[0].owner_id === ownerA && crRows[0].campaign_id === campA, 'creative owned by campaign owner');
  assert(crRows[0].status === 'GENERATED', 'explicit GENERATED state');
  assert(crRows[0].name && crRows[0].type, 'NOT NULL creative columns populated');

  try {
    await generateAndSaveGoogleCreatives(campA);
    assert(false, 'repeated same campaign rate limited');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.RATE_LIMITED, 'repeated same campaign rate limited');
  }

  const campA2 = await seedCampaign(db, ownerA);
  try {
    await generateAndSaveGoogleCreatives(campA2);
    assert(false, 'repeated same user / extra campaign rate limited');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.RATE_LIMITED, 'multiple campaigns still user-rate-limited');
  }

  await db.exec("delete from public.generation_rate_events");
  const campC = await seedCampaign(db, ownerA);
  const [r1, r2] = await Promise.allSettled([
    generateAndSaveGoogleCreatives(campC),
    generateAndSaveGoogleCreatives(campC),
  ]);
  const okCount = [r1, r2].filter((r) => r.status === 'fulfilled').length;
  const limited = [r1, r2].some((r) => r.status === 'rejected' && (r as any).reason?.code === ERROR_CODES.RATE_LIMITED);
  assert(okCount === 1 && limited, 'concurrent generation serialized by lock');

  const { rows: ccount } = await db.query('select count(*)::int as n from public.creatives where campaign_id=$1', [campC]) as any;
  assert(ccount[0].n === 1, 'duplicate generation does not create extra creatives');

  // IDOR item updates
  await db.exec("delete from public.generation_rate_events");
  const { rows: gA } = await db.query('select headlines, descriptions, keywords from public.creatives_google where creative_id=$1', [gen.creativeId]) as any;
  const itemId = gA[0].headlines[0].id;

  await setAuthUid(db, ownerB);
  __setMockCreateClient(async () => createPgLiteSupabase(db, ownerB));
  try {
    await updateGoogleCreativeItem(campA, gen.creativeId, 'headlines', itemId, 'approve');
    assert(false, 'campaign A cannot be modified by B');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.UNAUTHORIZED, 'campaign A cannot be modified by B');
  }

  const campB2 = await seedCampaign(db, ownerB);
  await db.query("insert into public.integrations (owner_id, provider, status) values ($1, 'google', 'connected')", [ownerB]);
  await setAuthUid(db, ownerB);
  __setMockCreateClient(async () => createPgLiteSupabase(db, ownerB));
  await db.exec("delete from public.generation_rate_events");
  const genB = await generateAndSaveGoogleCreatives(campB2);

  await setAuthUid(db, ownerA);
  __setMockCreateClient(async () => createPgLiteSupabase(db, ownerA));
  try {
    await updateGoogleCreativeItem(campA, genB.creativeId, 'headlines', itemId, 'approve');
    assert(false, 'creative A cannot modify creative B');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.UNAUTHORIZED, 'creative A cannot modify creative B');
  }

  try {
    await updateGoogleCreativeItem(campA, gen.creativeId, 'headlines', 'missing-item', 'approve');
    assert(false, 'item must belong to creative');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.VALIDATION_FAILED, 'item must belong to creative');
  }

  await updateGoogleCreativeItem(campA, gen.creativeId, 'headlines', itemId, 'approve');
  try {
    await generateAndSaveGoogleCreatives(campA);
    assert(false, 'approved item blocks full generation');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.RATE_LIMITED || e.code === ERROR_CODES.CREATIVE_LOCKED, 'approved creative protection');
  }

  try {
    await updateGoogleCreativeItem(campA, gen.creativeId, 'headlines', itemId, 'regenerate');
    assert(false, 'approved item cannot regenerate');
  } catch (e: any) {
    assert(e.code === ERROR_CODES.CREATIVE_LOCKED, 'approved item cannot regenerate');
  }

  const { rows: g2 } = await db.query('select headlines from public.creatives_google where creative_id=$1', [gen.creativeId]) as any;
  const otherHeadline = g2[0].headlines[1].id;
  await updateGoogleCreativeItem(campA, gen.creativeId, 'headlines', otherHeadline, 'reject');
  await updateGoogleCreativeItem(campA, gen.creativeId, 'headlines', otherHeadline, 'regenerate');
  const { rows: g3 } = await db.query('select headlines from public.creatives_google where creative_id=$1', [gen.creativeId]) as any;
  const regenerated = g3[0].headlines.find((h: any) => h.id === otherHeadline);
  assert(regenerated.owner_approved !== true, 'rejected item can regenerate and is unapproved');

  // Approval RPC
  const creativeId = crypto.randomUUID();
  const campApprove = await seedCampaign(db, ownerA, { status: 'PENDING_APPROVAL' });
  await db.query(
    `insert into public.creatives (id, owner_id, campaign_id, name, type, status) values ($1,$2,$3,'n','google_rsa','GENERATED')`,
    [creativeId, ownerA, campApprove]
  );
  await db.query(`update public.unified_campaigns set creative_id=$1 where id=$2`, [creativeId, campApprove]);
  const contents = approvedItems();
  await db.query(
    `insert into public.creatives_google (creative_id, owner_id, headlines, descriptions, keywords, generation_status)
     values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'GENERATED')`,
    [creativeId, ownerA, JSON.stringify(contents.headlines), JSON.stringify(contents.descriptions), JSON.stringify(contents.keywords)]
  );

  await setAuthUid(db, ownerB);
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerB]);
    assert(false, 'wrong owner approval rejected');
  } catch (e: any) {
    assert(/unauthorized/i.test(String(e.message)), 'wrong owner approval rejected');
  }

  await setAuthUid(db, ownerA);
  const insufficient = JSON.parse(JSON.stringify(contents));
  insufficient.headlines = insufficient.headlines.slice(0, 2);
  await db.query(`update public.creatives_google set headlines=$1::jsonb where creative_id=$2`, [JSON.stringify(insufficient.headlines), creativeId]);
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerA]);
    assert(false, 'insufficient headlines cannot approve');
  } catch (e: any) {
    assert(String(e.message).toLowerCase().includes('headline'), 'insufficient headlines cannot approve');
  }

  await db.query(`update public.creatives_google set headlines=$1::jsonb where creative_id=$2`, [JSON.stringify(contents.headlines), creativeId]);
  const noDesc = JSON.parse(JSON.stringify(contents));
  noDesc.descriptions = noDesc.descriptions.slice(0, 1);
  await db.query(`update public.creatives_google set descriptions=$1::jsonb where creative_id=$2`, [JSON.stringify(noDesc.descriptions), creativeId]);
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerA]);
    assert(false, 'insufficient descriptions cannot approve');
  } catch (e: any) {
    assert(String(e.message).toLowerCase().includes('description'), 'insufficient descriptions cannot approve');
  }

  await db.query(`update public.creatives_google set descriptions=$1::jsonb where creative_id=$2`, [JSON.stringify(contents.descriptions), creativeId]);
  await db.query(`update public.creatives_google set keywords='[]'::jsonb where creative_id=$1`, [creativeId]);
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerA]);
    assert(false, 'insufficient keywords cannot approve');
  } catch (e: any) {
    assert(String(e.message).toLowerCase().includes('keyword'), 'insufficient keywords cannot approve');
  }

  const rejected = JSON.parse(JSON.stringify(contents));
  rejected.headlines[0].rejected = true;
  rejected.headlines[0].owner_approved = false;
  await db.query(
    `update public.creatives_google set headlines=$1::jsonb, keywords=$2::jsonb where creative_id=$3`,
    [JSON.stringify(rejected.headlines), JSON.stringify(contents.keywords), creativeId]
  );
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerA]);
    assert(false, 'rejected item prevents approval');
  } catch (e: any) {
    assert(String(e.message).toLowerCase().includes('headline') || String(e.message).toLowerCase().includes('unapproved'), 'rejected item prevents approval');
  }

  const unapproved = JSON.parse(JSON.stringify(contents));
  unapproved.headlines[0].owner_approved = false;
  await db.query(`update public.creatives_google set headlines=$1::jsonb where creative_id=$2`, [JSON.stringify(unapproved.headlines), creativeId]);
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerA]);
    assert(false, 'unapproved item prevents approval');
  } catch (e: any) {
    assert(String(e.message).toLowerCase().includes('headline'), 'unapproved item prevents approval');
  }

  await db.query(
    `update public.creatives_google set headlines=$1::jsonb, descriptions=$2::jsonb, keywords=$3::jsonb where creative_id=$4`,
    [JSON.stringify(contents.headlines), JSON.stringify(contents.descriptions), JSON.stringify(contents.keywords), creativeId]
  );

  const phoneCamp = await seedCampaign(db, ownerA, { status: 'PENDING_APPROVAL', destination_type: 'PHONE' });
  const phoneCreative = crypto.randomUUID();
  await db.query(`insert into public.creatives (id, owner_id, campaign_id, name, type, status) values ($1,$2,$3,'n','google_rsa','GENERATED')`, [phoneCreative, ownerA, phoneCamp]);
  await db.query(`update public.unified_campaigns set creative_id=$1 where id=$2`, [phoneCreative, phoneCamp]);
  await db.query(
    `insert into public.creatives_google (creative_id, owner_id, headlines, descriptions, keywords) values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)`,
    [phoneCreative, ownerA, JSON.stringify(contents.headlines), JSON.stringify(contents.descriptions), JSON.stringify(contents.keywords)]
  );
  try {
    await db.query('select public.rpc_approve_campaign($1,$2)', [phoneCamp, ownerA]);
    assert(false, 'unsupported destination cannot approve google');
  } catch (e: any) {
    assert(String(e.message).includes('GOOGLE_DESTINATION_UNSUPPORTED'), 'unsupported destination cannot approve google');
  }

  await db.query('select public.rpc_approve_campaign($1,$2)', [campApprove, ownerA]);
  const { rows: st } = await db.query('select status from public.unified_campaigns where id=$1', [campApprove]) as any;
  assert(st[0].status === 'READY_TO_DEPLOY', 'approval sets READY_TO_DEPLOY');
  const { rows: dep } = await db.query('select status, target_state from public.channel_deployments where campaign_id=$1 and provider=$2', [campApprove, 'google']) as any;
  assert(dep[0].status === 'READY_TO_DEPLOY', 'deployment READY_TO_DEPLOY requires target_state');
  assert(Array.isArray(dep[0].target_state.headlines) && dep[0].target_state.headlines.length >= 3, 'target_state contains approved snapshot');
  assert(dep[0].target_state.campaign.budget == 1000, 'target_state has authoritative budget');
  const snapshotHead = dep[0].target_state.headlines[0].current_value;

  await db.query(`update public.creatives_google set headlines=$1::jsonb where creative_id=$2`, [
    JSON.stringify(contents.headlines.map((h: any) => ({ ...h, current_value: 'Changed after snapshot' }))),
    creativeId,
  ]);
  const { rows: dep2 } = await db.query('select target_state from public.channel_deployments where campaign_id=$1 and provider=$2', [campApprove, 'google']) as any;
  assert(dep2[0].target_state.headlines[0].current_value === snapshotHead, 'approval change after snapshot does not mutate snapshot');

  const apiOk = await generatePOST(new NextRequest('http://localhost/x', {
    method: 'POST',
    headers: { origin: 'http://localhost' },
  }), {
    params: Promise.resolve({ id: campA }),
  });
  assert(apiOk.status === 429 || apiOk.status === 409 || apiOk.status === 200, 'generate API executes with auth');

  await stubGemini.close();

  console.log(`\n--- M7 INTEGRATION SUMMARY: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
