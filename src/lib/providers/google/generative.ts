import { createClient } from '@/lib/supabase/server';
import { v4 as uuidv4 } from 'uuid';
import { GoogleCreativeItem } from './types';
import { validateCreativePayload } from './validation';

function convertToCreativeItems(strings: string[], matchType?: 'EXACT' | 'PHRASE'): GoogleCreativeItem[] {
  return strings.map(s => ({
    id: uuidv4(),
    original_value: s,
    current_value: s,
    ai_generated: true,
    owner_approved: null, // null means unreviewed
    rejected: false,
    match_type: matchType
  }));
}

export async function generateAndSaveGoogleCreatives(campaignId: string, ownerId: string) {
  const supabase = await createClient();

  const { data: campaign, error: cErr } = await supabase
    .from('unified_campaigns')
    .select('*')
    .eq('id', campaignId)
    .eq('owner_id', ownerId)
    .single();

  if (cErr || !campaign) {
    throw new Error('Campaign not found or unauthorized');
  }

  // Check if creative already exists and is fully approved
  if (campaign.creative_id) {
    const { data: existing } = await supabase
      .from('creatives')
      .select('status')
      .eq('id', campaign.creative_id)
      .single();
    
    if (existing && existing.status === 'APPROVED') {
      throw new Error('Cannot regenerate creatives for an approved campaign');
    }
  }

  // LLM Generation (Mocked for testing / no API key)
  // In a real scenario, this calls @google/genai or OpenAI with the campaign.service and campaign.offer
  const payload = {
    headlines: [
      `Buy ${campaign.service}`.substring(0, 30),
      `${campaign.offer} offer`.substring(0, 30),
      `Get ${campaign.service} today`.substring(0, 30)
    ],
    descriptions: [
      `Sign up for ${campaign.service} and get ${campaign.offer} now.`.substring(0, 90),
      `Best ${campaign.service} with ${campaign.offer} guaranteed.`.substring(0, 90)
    ],
    keywords: [
      `${campaign.service}`.substring(0, 80),
      `${campaign.service} deal`.substring(0, 80)
    ]
  };

  const validation = validateCreativePayload(payload);
  if (!validation.valid) {
    throw new Error('LLM generated invalid payload: ' + validation.errors.join(', '));
  }

  const headlines = convertToCreativeItems(payload.headlines);
  const descriptions = convertToCreativeItems(payload.descriptions);
  const keywords = convertToCreativeItems(payload.keywords, 'EXACT');

  const creativeId = campaign.creative_id || uuidv4();

  if (!campaign.creative_id) {
    // Insert new creative record
    const { error: insErr } = await supabase
      .from('creatives')
      .insert({
        id: creativeId,
        owner_id: ownerId,
        campaign_id: campaignId,
        status: 'DRAFT',
        version: 1
      });
    if (insErr) throw new Error('Failed to create creative record: ' + insErr.message);

    const { error: gErr } = await supabase
      .from('creatives_google')
      .insert({
        creative_id: creativeId,
        owner_id: ownerId,
        headlines,
        descriptions,
        keywords,
        generation_status: 'GENERATED',
        last_generated_at: new Date().toISOString()
      });
    if (gErr) throw new Error('Failed to create google creatives: ' + gErr.message);

    // Link back to campaign
    await supabase.from('unified_campaigns').update({ creative_id: creativeId }).eq('id', campaignId);
  } else {
    // Update existing
    await supabase
      .from('creatives_google')
      .update({
        headlines,
        descriptions,
        keywords,
        generation_status: 'GENERATED',
        last_generated_at: new Date().toISOString()
      })
      .eq('creative_id', creativeId)
      .eq('owner_id', ownerId);
  }

  return { creativeId };
}
