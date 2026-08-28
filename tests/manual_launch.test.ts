import './setup';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'fs';
import path from 'path';
import {
  buildLaunchSheet,
  normaliseGoogleCampaignId,
  googleKeywordSyntax,
  type LaunchCampaign,
} from '../src/lib/campaigns/launchSheet';

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('PASS: ' + msg); pass++; }
  else { console.error('FAIL: ' + msg); fail++; }
}

const item = (value: string, approved: boolean | null, rejected = false, matchType?: string) => ({
  id: `i-${value}`,
  original_value: value,
  current_value: value,
  ai_generated: true,
  owner_approved: approved,
  rejected,
  match_type: matchType,
});

const campaign: LaunchCampaign = {
  service: 'Bridal Makeup',
  offer: '20% Off',
  max_daily_spend: 1500,
  duration_days: 30,
  location: 'Rajajipuram, Lucknow',
  landing_url: 'https://lakme-rajajipuram.example.com',
  destination: 'WEBSITE',
  destination_type: 'WEBSITE',
};

async function main() {
  console.log('--- ONLY APPROVED COPY IS HANDED OVER ---');

  const creative = {
    headlines: [
      item('Bridal Makeup in Rajajipuram', true),
      item('Winter Bridal Makeup 20% Off', true),
      item('Book Bridal Makeup Today', true),
      item('This one was rejected', false, true),
      item('This one is undecided', null),
    ],
    descriptions: [
      item('Expert bridal makeup in Rajajipuram. Book online today.', true),
      item('Get 20 percent off bridal makeup this season.', true),
      item('Awaiting a decision', null),
    ],
    keywords: [
      item('bridal makeup lucknow', true, false, 'EXACT'),
      item('bridal makeup rajajipuram', true, false, 'PHRASE'),
      item('rejected keyword', false, true, 'EXACT'),
    ],
  };

  const sheet = buildLaunchSheet(campaign, creative, new Date('2026-08-28T00:00:00Z'));

  assert(sheet.headlines.length === 3, 'Only approved headlines are included');
  assert(!sheet.headlines.some((h) => h.includes('rejected')), 'Rejected headlines are excluded');
  assert(!sheet.headlines.some((h) => h.includes('undecided')), 'Undecided headlines are excluded');
  assert(sheet.descriptions.length === 2, 'Only approved descriptions are included');
  assert(sheet.keywords.length === 2, 'Only approved keywords are included');

  console.log('\n--- THE SHEET MATCHES WHAT GOOGLE ASKS FOR ---');

  assert(sheet.campaignName === 'Bridal Makeup - Google Search', 'Campaign name is derived from the service');
  assert(sheet.dailyBudget === 1500, 'Daily budget comes from the safety-checked daily figure');
  assert(sheet.durationDays === 30, 'Duration is carried across');
  assert(sheet.endDate === '2026-09-27', 'End date is today plus the duration');
  assert(sheet.location === 'Rajajipuram, Lucknow', 'Location targeting is carried across');
  assert(sheet.finalUrl === 'https://lakme-rajajipuram.example.com', 'Final URL is the approved landing page');
  assert(sheet.campaignType === 'Search', 'Campaign type is Search');
  assert(sheet.biddingStrategy.includes('Manual CPC'), 'Bidding matches the approval snapshot');

  const exact = sheet.keywords.find((k) => k.text === 'bridal makeup lucknow')!;
  const phrase = sheet.keywords.find((k) => k.text === 'bridal makeup rajajipuram')!;
  assert(exact.googleSyntax === '[bridal makeup lucknow]', 'Exact keywords use Google square-bracket notation');
  assert(phrase.googleSyntax === '"bridal makeup rajajipuram"', 'Phrase keywords use Google quote notation');
  assert(googleKeywordSyntax('x', 'EXACT') === '[x]' && googleKeywordSyntax('x', 'PHRASE') === '"x"',
    'Match-type notation is applied consistently');
  assert(sheet.missing.length === 0, 'A complete campaign reports nothing missing');

  console.log('\n--- INCOMPLETE CAMPAIGNS SAY SO ---');

  {
    const thin = buildLaunchSheet(campaign, {
      headlines: [item('Only one', true)],
      descriptions: [],
      keywords: [],
    });
    assert(thin.missing.some((m) => m.includes('headlines')), 'Too few headlines is reported');
    assert(thin.missing.some((m) => m.includes('descriptions')), 'Too few descriptions is reported');
    assert(thin.missing.some((m) => m.includes('keywords')), 'No keywords is reported');
  }
  {
    const noUrl = buildLaunchSheet({ ...campaign, landing_url: null }, creative);
    assert(noUrl.finalUrl === null, 'A missing landing URL is not invented');
    assert(noUrl.missing.some((m) => m.includes('landing page')), 'A missing landing URL is reported');
  }
  {
    const noArea = buildLaunchSheet({ ...campaign, location: '  ' }, creative);
    assert(noArea.location === null, 'A blank area is treated as unset');
    assert(noArea.missing.some((m) => m.includes('target area')), 'A missing target area is reported');
  }
  {
    const noCreative = buildLaunchSheet(campaign, null);
    assert(noCreative.headlines.length === 0 && noCreative.keywords.length === 0,
      'A campaign with no creative yields an empty sheet rather than throwing');
    assert(noCreative.missing.length >= 3, 'And every gap is listed');
  }

  console.log('\n--- THE PASTED CAMPAIGN ID IS VALIDATED ---');

  assert(normaliseGoogleCampaignId('22105538761') === '22105538761', 'A plain id is accepted');
  assert(normaliseGoogleCampaignId('  22105538761  ') === '22105538761', 'Surrounding spaces are trimmed');
  assert(normaliseGoogleCampaignId('221-055-38761') === '22105538761', 'Dashes are stripped');
  assert(normaliseGoogleCampaignId('221 055 38761') === '22105538761', 'Inner spaces are stripped');
  assert(normaliseGoogleCampaignId('') === null, 'An empty value is rejected');
  assert(normaliseGoogleCampaignId('abc') === null, 'Letters are rejected');
  assert(normaliseGoogleCampaignId('12345') === null, 'A too-short number is rejected');
  assert(normaliseGoogleCampaignId('1234567890123456') === null, 'A too-long number is rejected');
  assert(normaliseGoogleCampaignId('221055387x1') === null, 'A number with a stray letter is rejected');
  assert(
    normaliseGoogleCampaignId('customers/123/campaigns/22105538761') === null,
    'A pasted resource path is rejected rather than silently mangled'
  );

  console.log('\n--- LIVE IS A REAL CAMPAIGN STATE ---');

  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  `);
  const dir = path.join(process.cwd(), 'supabase/migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    await db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }

  const owner = '11111111-1111-1111-1111-111111111111';
  const { rows: created } = await db.query<{ id: string }>(
    `insert into unified_campaigns
       (owner_id, service, offer, budget_type, budget_amount, duration_days,
        max_daily_spend, max_campaign_spend, channels, status, landing_url, location)
     values ($1,'Bridal Makeup','20% Off','daily',1500,30,1500,45000,array['google'],
             'READY_TO_DEPLOY','https://example.com','Rajajipuram')
     returning id`, [owner]
  );
  const campaignId = created[0].id;
  await db.query(
    `insert into channel_deployments (owner_id, campaign_id, provider, status)
     values ($1,$2,'google','READY_TO_DEPLOY')`, [owner, campaignId]
  );

  // Exactly what the server action writes.
  await db.query(
    `update channel_deployments set external_campaign_id = '22105538761', status = 'ACTIVE'
       where campaign_id = $1 and owner_id = $2 and provider = 'google'`, [campaignId, owner]
  );
  await db.query(`update unified_campaigns set status = 'LIVE' where id = $1 and owner_id = $2`,
    [campaignId, owner]);

  const { rows: after } = await db.query<{ status: string }>(
    `select status::text as status from unified_campaigns where id = $1`, [campaignId]);
  assert(after[0].status === 'LIVE', 'A campaign can be marked LIVE');

  // The reporting layer finds a campaign through exactly this join.
  const { rows: joined } = await db.query<{ campaign_id: string; external_campaign_id: string }>(
    `select campaign_id, external_campaign_id from channel_deployments
      where owner_id = $1 and provider = 'google' and external_campaign_id is not null`, [owner]);
  assert(joined.length === 1 && joined[0].external_campaign_id === '22105538761',
    'The recorded id is where the measurement layer looks for it');
  assert(joined[0].campaign_id === campaignId, 'And it points back at the right campaign');

  await db.close();

  console.log(`\n--- MANUAL LAUNCH: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
