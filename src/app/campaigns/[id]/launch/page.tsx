import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { buildLaunchSheet, type LaunchCampaign } from '@/lib/campaigns/launchSheet';
import { CopyBlock } from './CopyBlock';
import { RecordCampaignId } from './RecordCampaignId';
import { isUuid } from '@/lib/ids';

export const dynamic = 'force-dynamic';

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return redirect('/campaigns');
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return redirect('/login');

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', id)
    .eq('owner_id', user.id)
    .single();
  if (!campaign) return redirect('/campaigns');

  const isLive = campaign.status === 'LIVE';
  if (campaign.status !== 'READY_TO_DEPLOY' && !isLive) {
    return <NotReadyYet id={id} status={campaign.status} />;
  }

  const [{ data: creativeGoogle }, { data: deployment }] = await Promise.all([
    campaign.creative_id
      ? supabase
          .from('creatives_google')
          .select('headlines, descriptions, keywords')
          .eq('creative_id', campaign.creative_id)
          .eq('owner_id', user.id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from('channel_deployments')
      .select('external_campaign_id')
      .eq('campaign_id', id)
      .eq('owner_id', user.id)
      .eq('provider', 'google')
      .single(),
  ]);

  const sheet = buildLaunchSheet(campaign as LaunchCampaign, creativeGoogle);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href={`/campaigns/${id}`} className="text-sm text-muted-foreground underline">
        ← Back to campaign
      </Link>

      <h1 className="mt-3 text-3xl font-bold tracking-tight">Set this up in Google Ads</h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Everything below has been approved by you. Open Google Ads Manager in another tab, create a
        new Search campaign, and copy each block across. It takes a few minutes.
      </p>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
        This app does not create or change anything in your Google Ads account. You stay in control
        of what goes live and what it spends.
      </div>

      {sheet.missing.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-900">Some details are missing</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {sheet.missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-8 space-y-4">
        <CopyBlock
          title="Campaign name"
          hint="Google asks for this on the first screen"
          value={sheet.campaignName}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CopyBlock
            title="Daily budget"
            hint="Enter as the daily amount, in rupees"
            value={String(sheet.dailyBudget)}
          />
          <CopyBlock
            title="End date"
            hint={`Run for ${sheet.durationDays} days from today`}
            value={sheet.endDate || 'Not set'}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <CopyBlock
            title="Campaign type and bidding"
            hint="Choose these from Google's menus"
            value={`${sheet.campaignType} — ${sheet.biddingStrategy}`}
          />
          <CopyBlock
            title="Location targeting"
            hint="Set under Locations"
            value={sheet.location || 'Not specified — choose your area'}
          />
        </div>

        <CopyBlock
          title="Final URL"
          hint="Where the ad sends people"
          value={sheet.finalUrl || 'Not set'}
        />

        <CopyBlock
          title="Headlines"
          hint="Paste one per headline field. Each is already within Google's 30-character limit."
          value={sheet.headlines.join('\n')}
          lines={sheet.headlines}
          count={`${sheet.headlines.length} approved`}
        />

        <CopyBlock
          title="Descriptions"
          hint="Paste one per description field. Each is within the 90-character limit."
          value={sheet.descriptions.join('\n')}
          lines={sheet.descriptions}
          count={`${sheet.descriptions.length} approved`}
        />

        <CopyBlock
          title="Keywords"
          hint={'Already in Google’s notation: [square brackets] means exact match, "quotes" means phrase match. Paste the whole list into the keywords box.'}
          value={sheet.keywords.map((k) => k.googleSyntax).join('\n')}
          lines={sheet.keywords.map((k) => k.googleSyntax)}
          count={`${sheet.keywords.length} approved`}
        />
      </div>

      <div className="mt-8">
        <RecordCampaignId
          campaignId={id}
          existingId={deployment?.external_campaign_id ?? null}
          isLive={isLive}
        />
      </div>
    </div>
  );
}

function NotReadyYet({ id, status }: { id: string; status: string }) {
  return (
    <div className="mx-auto max-w-2xl p-8">
      <Link href={`/campaigns/${id}`} className="text-sm text-muted-foreground underline">
        ← Back to campaign
      </Link>
      <div className="mt-6 rounded-lg border bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Not ready to set up yet</h1>
        <p className="mx-auto mt-2 max-w-prose text-sm text-muted-foreground">
          This campaign is at <strong>{status}</strong>. The setup sheet appears once you have
          approved every headline, description and keyword, and approved the campaign itself.
        </p>
        <Link
          href={`/campaigns/${id}/google`}
          className="mt-5 inline-block rounded bg-black px-4 py-2 text-sm text-white"
        >
          Review the ad copy
        </Link>
      </div>
    </div>
  );
}
