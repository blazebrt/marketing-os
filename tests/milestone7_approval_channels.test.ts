import './setup';
import crypto from 'crypto';
import { createM7Database, setAuthUid } from './helpers/m7Harness';

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

function approvedGoogle() {
  return {
    headlines: [
      { id: 'h1', current_value: 'Buy widgets now', owner_approved: true, rejected: false },
      { id: 'h2', current_value: 'Great widget deals', owner_approved: true, rejected: false },
      { id: 'h3', current_value: 'Widget sale today', owner_approved: true, rejected: false },
    ],
    descriptions: [
      { id: 'd1', current_value: 'Get the best widgets at unbeatable prices today.', owner_approved: true, rejected: false },
      { id: 'd2', current_value: 'Premium widgets delivered fast and free.', owner_approved: true, rejected: false },
    ],
    keywords: [{ id: 'k1', current_value: 'widgets', owner_approved: true, rejected: false, match_type: 'EXACT' }],
  };
}

async function seedPendingCampaign(
  db: any,
  ownerId: string,
  opts: {
    channels: string[];
    destination?: string;
    destinationType?: string;
    landingUrl?: string | null;
    verification?: string | null;
  }
) {
  const id = crypto.randomUUID();
  const destination = opts.destination ?? 'WEBSITE';
  const destinationType = opts.destinationType ?? 'WEBSITE';
  const landingUrl = opts.landingUrl === undefined ? 'https://example.com/' : opts.landingUrl;
  const verification = opts.verification === undefined ? 'VALID' : opts.verification;
  await db.query(
    `insert into public.unified_campaigns
      (id, owner_id, service, offer, budget_type, budget_amount, duration_days, max_daily_spend, max_campaign_spend,
       destination, destination_type, landing_url, destination_verification_status, channels, status)
     values ($1,$2,'Salon','20% Off','daily',1000,30,1000,30000,$3,$4,$5,$6,$7,'PENDING_APPROVAL')`,
    [id, ownerId, destination, destinationType, landingUrl, verification, opts.channels]
  );
  return id;
}

async function attachCreative(db: any, ownerId: string, campaignId: string, withGoogle?: ReturnType<typeof approvedGoogle> | null) {
  const creativeId = crypto.randomUUID();
  await db.query(
    `insert into public.creatives (id, owner_id, campaign_id, name, type, status)
     values ($1,$2,$3,'creative','rsa','GENERATED')`,
    [creativeId, ownerId, campaignId]
  );
  await db.query(`update public.unified_campaigns set creative_id=$1 where id=$2`, [creativeId, campaignId]);
  if (withGoogle) {
    await db.query(
      `insert into public.creatives_google (creative_id, owner_id, headlines, descriptions, keywords, generation_status)
       values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,'GENERATED')`,
      [
        creativeId,
        ownerId,
        JSON.stringify(withGoogle.headlines),
        JSON.stringify(withGoogle.descriptions),
        JSON.stringify(withGoogle.keywords),
      ]
    );
  }
  return creativeId;
}

async function approve(db: any, campaignId: string, ownerId: string) {
  return db.query('select public.rpc_approve_campaign($1,$2) as result', [campaignId, ownerId]);
}

async function run() {
  console.log('--- M7 APPROVAL CHANNEL SCOPING ---\n');

  const db = await createM7Database();
  const ownerA = crypto.randomUUID();
  const ownerB = crypto.randomUUID();
  await db.query(
    `insert into public.integrations (owner_id, provider, status) values
      ($1, 'google', 'connected'),
      ($1, 'meta', 'connected')`,
    [ownerA]
  );

  const googleItems = approvedGoogle();

  // 1. Google campaign + valid Google creative → PASS
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['google'] });
    await attachCreative(db, ownerA, id, googleItems);
    await setAuthUid(db, ownerA);
    const res = await approve(db, id, ownerA);
    assert(res.rows[0].result.success === true, 'Google campaign + valid Google creative approval PASS');
    const { rows } = await db.query(
      `select status, target_state from public.channel_deployments where campaign_id=$1 and provider='google'`,
      [id]
    ) as any;
    assert(
      rows[0]?.status === 'READY_TO_DEPLOY' &&
        rows[0].target_state.headlines.every((h: any) => h.owner_approved === true && h.rejected !== true),
      'Approved Google campaign target_state contains only approved Google creative'
    );
  }

  // 2. Google campaign + missing Google creative → FAIL
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['google'] });
    await attachCreative(db, ownerA, id, null);
    await setAuthUid(db, ownerA);
    try {
      await approve(db, id, ownerA);
      assert(false, 'Google campaign + missing Google creative approval FAIL');
    } catch (e: any) {
      assert(String(e.message).includes('Google creative content missing'), 'Google campaign + missing Google creative approval FAIL');
    }
  }

  // 3–5. insufficient items
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['google'] });
    const cid = await attachCreative(db, ownerA, id, googleItems);
    await setAuthUid(db, ownerA);
    await db.query(`update public.creatives_google set headlines=$1::jsonb where creative_id=$2`, [
      JSON.stringify(googleItems.headlines.slice(0, 2)),
      cid,
    ]);
    try {
      await approve(db, id, ownerA);
      assert(false, 'Google campaign + insufficient approved headlines approval FAIL');
    } catch (e: any) {
      assert(String(e.message).toLowerCase().includes('headline'), 'Google campaign + insufficient approved headlines approval FAIL');
    }

    await db.query(
      `update public.creatives_google set headlines=$1::jsonb, descriptions=$2::jsonb where creative_id=$3`,
      [JSON.stringify(googleItems.headlines), JSON.stringify(googleItems.descriptions.slice(0, 1)), cid]
    );
    try {
      await approve(db, id, ownerA);
      assert(false, 'Google campaign + insufficient descriptions approval FAIL');
    } catch (e: any) {
      assert(String(e.message).toLowerCase().includes('description'), 'Google campaign + insufficient descriptions approval FAIL');
    }

    await db.query(
      `update public.creatives_google set descriptions=$1::jsonb, keywords='[]'::jsonb where creative_id=$2`,
      [JSON.stringify(googleItems.descriptions), cid]
    );
    try {
      await approve(db, id, ownerA);
      assert(false, 'Google campaign + insufficient keywords approval FAIL');
    } catch (e: any) {
      assert(String(e.message).toLowerCase().includes('keyword'), 'Google campaign + insufficient keywords approval FAIL');
    }
  }

  // 6. Google campaign + invalid destination → FAIL
  {
    const id = await seedPendingCampaign(db, ownerA, {
      channels: ['google'],
      landingUrl: 'http://example.com/',
      verification: 'VALID',
    });
    await attachCreative(db, ownerA, id, googleItems);
    await setAuthUid(db, ownerA);
    try {
      await approve(db, id, ownerA);
      assert(false, 'Google campaign + invalid destination approval FAIL');
    } catch (e: any) {
      assert(/https|destination/i.test(String(e.message)), 'Google campaign + invalid destination approval FAIL');
    }
  }

  // 7–9, 15. Non-Google: no Google creative, no Google destination, no Google target_state / deployment
  {
    const id = await seedPendingCampaign(db, ownerA, {
      channels: ['meta'],
      destination: 'whatsapp:+15551234567',
      destinationType: 'WHATSAPP',
      landingUrl: null,
      verification: null,
    });
    await attachCreative(db, ownerA, id, null);
    await setAuthUid(db, ownerA);
    const res = await approve(db, id, ownerA);
    assert(res.rows[0].result.success === true, 'Non-Google campaign + no Google creative approval PASS');
    const { rows: camp } = await db.query(`select status from public.unified_campaigns where id=$1`, [id]) as any;
    assert(camp[0].status === 'READY_TO_DEPLOY', 'Non-Google campaign + no Google destination approval PASS');
    const { rows: googleDep } = await db.query(
      `select * from public.channel_deployments where campaign_id=$1 and provider='google'`,
      [id]
    ) as any;
    assert(googleDep.length === 0, 'Non-Google campaign no Google target_state created');
    assert(googleDep.length === 0, 'Non-Google campaign Google deployment remains unavailable');
    const { rows: metaDep } = await db.query(
      `select provider, status, target_state from public.channel_deployments where campaign_id=$1`,
      [id]
    ) as any;
    assert(
      metaDep.length === 1 && metaDep[0].provider === 'meta' && metaDep[0].status === 'PENDING',
      'Non-Google campaign preserves non-Google PENDING deployment lifecycle'
    );
  }

  // 10. Mixed Google + non-Google → Google requirements MUST apply
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['google', 'meta'] });
    await attachCreative(db, ownerA, id, null);
    await setAuthUid(db, ownerA);
    try {
      await approve(db, id, ownerA);
      assert(false, 'Mixed Google + non-Google campaign without Google creative FAIL');
    } catch (e: any) {
      assert(String(e.message).includes('Google creative content missing'), 'Mixed Google + non-Google campaign Google requirements MUST apply');
    }

    const idOk = await seedPendingCampaign(db, ownerA, { channels: ['meta', 'google'] });
    await attachCreative(db, ownerA, idOk, googleItems);
    const ok = await approve(db, idOk, ownerA);
    assert(ok.rows[0].result.success === true, 'Mixed Google + non-Google campaign with valid Google creative PASS');
    const { rows: mixed } = await db.query(
      `select provider, status, target_state from public.channel_deployments where campaign_id=$1 order by provider`,
      [idOk]
    ) as any;
    const g = mixed.find((r: any) => r.provider === 'google');
    const m = mixed.find((r: any) => r.provider === 'meta');
    assert(
      g?.status === 'READY_TO_DEPLOY' && Array.isArray(g.target_state?.headlines) && g.target_state.headlines.length >= 3,
      'Mixed campaign creates Google READY_TO_DEPLOY target_state'
    );
    assert(m?.status === 'PENDING', 'Mixed campaign keeps non-Google deployment PENDING');
  }

  // 11. Client cannot remove Google from the approval request
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['google'] });
    await attachCreative(db, ownerA, id, null);
    await setAuthUid(db, ownerA);
    let extraArgRejected = false;
    try {
      await db.query('select public.rpc_approve_campaign($1,$2,$3)', [id, ownerA, ['meta']]);
    } catch (e: any) {
      extraArgRejected = /function public\.rpc_approve_campaign/i.test(String(e.message)) || /does not exist/i.test(String(e.message));
    }
    assert(extraArgRejected, 'Client cannot pass a substitute channel list into approval RPC');

    try {
      await approve(db, id, ownerA);
      assert(false, 'Authoritative Google channel still required when client omits channels');
    } catch (e: any) {
      assert(
        String(e.message).includes('Google creative content missing'),
        'Authoritative Google channel still required when client omits channels'
      );
    }
  }

  // 12. Cross-owner approval → FAIL
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['meta'], destinationType: 'WHATSAPP', landingUrl: null, verification: null, destination: 'wa' });
    await attachCreative(db, ownerA, id, null);
    await setAuthUid(db, ownerB);
    try {
      await approve(db, id, ownerB);
      assert(false, 'Cross-owner approval FAIL');
    } catch (e: any) {
      assert(/unauthorized|not found/i.test(String(e.message)), 'Cross-owner approval FAIL');
    }
  }

  // 13. Unauthorized campaign approval → FAIL
  {
    const id = await seedPendingCampaign(db, ownerA, { channels: ['meta'], destinationType: 'PHONE', landingUrl: null, verification: null, destination: '+1555' });
    await attachCreative(db, ownerA, id, null);
    await setAuthUid(db, null);
    try {
      await approve(db, id, ownerA);
      assert(false, 'Unauthorized campaign approval FAIL');
    } catch (e: any) {
      assert(/unauthorized/i.test(String(e.message)), 'Unauthorized campaign approval FAIL');
    }
  }

  console.log(`\n--- M7 APPROVAL CHANNEL SUMMARY: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
