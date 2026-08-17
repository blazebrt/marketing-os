import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { GoogleCreativeItem } from '@/lib/providers/google/types';
import { Bot, CheckCircle, XCircle } from 'lucide-react';

export default async function GoogleReviewPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: campaign } = await supabase
    .from('unified_campaigns')
    .select('id, creative_id, status')
    .eq('id', params.id)
    .single();

  if (!campaign) {
    return <div>Campaign not found</div>;
  }

  let creativeGoogle = null;
  if (campaign.creative_id) {
    const { data } = await supabase
      .from('creatives_google')
      .select('*')
      .eq('creative_id', campaign.creative_id)
      .single();
    creativeGoogle = data;
  }

  const headlines: GoogleCreativeItem[] = creativeGoogle?.headlines || [];
  const descriptions: GoogleCreativeItem[] = creativeGoogle?.descriptions || [];
  const keywords: GoogleCreativeItem[] = creativeGoogle?.keywords || [];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Google Campaign Review</h1>
        <p className="text-muted-foreground mt-2">
          Review and approve AI-generated marketing content before deployment.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <div className="flex items-center gap-2 text-lg font-semibold border-b pb-2">
          <Bot className="w-5 h-5 text-blue-500" />
          Bidding Recommendation: Manual CPC
        </div>
        <div className="space-y-2 text-sm">
          <p className="font-medium">Why?</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Not enough conversion history</li>
            <li>Safer for a new account</li>
            <li>Conversion tracking does not yet provide enough evidence</li>
          </ul>
        </div>
      </div>

      <div className="space-y-6">
        <CreativeSection title="Headlines" items={headlines} />
        <CreativeSection title="Descriptions" items={descriptions} />
        <CreativeSection title="Keywords" items={keywords} />
      </div>

      {campaign.status !== 'READY_TO_DEPLOY' && (
        <div className="bg-yellow-50 text-yellow-800 p-4 rounded-md border border-yellow-200">
          Campaign must be approved before final deployment prep can occur. Current status: {campaign.status}
        </div>
      )}
    </div>
  );
}

function CreativeSection({ title, items }: { title: string, items: GoogleCreativeItem[] }) {
  if (items.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg border shadow-sm">
        <h2 className="text-xl font-semibold mb-4">{title}</h2>
        <p className="text-muted-foreground text-sm">No items generated yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg border shadow-sm">
      <h2 className="text-xl font-semibold mb-4">{title}</h2>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <div key={item.id || idx} className="flex items-center justify-between p-3 bg-slate-50 rounded border">
            <div className="flex items-center gap-3">
              <span className="font-medium">{item.current_value}</span>
              {item.ai_generated && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex items-center gap-1">
                  <Bot className="w-3 h-3" /> AI
                </span>
              )}
              {item.match_type && (
                <span className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded-full">
                  {item.match_type}
                </span>
              )}
            </div>
            <div>
              {item.owner_approved ? (
                <span className="flex items-center gap-1 text-sm text-green-600 font-medium">
                  <CheckCircle className="w-4 h-4" /> Approved
                </span>
              ) : (
                <span className="flex items-center gap-1 text-sm text-amber-600 font-medium">
                  <XCircle className="w-4 h-4" /> Pending Review
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
