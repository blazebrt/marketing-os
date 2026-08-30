import { createClient } from './supabase/server';

export async function processIncomingLead(leadData: {
  phone?: string;
  email?: string;
  name?: string;
  landing_session_id?: string;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  const normalizedPhone = leadData.phone ? leadData.phone.replace(/\D/g, '').slice(0, 32) : null;
  const normalizedEmail = leadData.email ? leadData.email.trim().toLowerCase().slice(0, 320) : null;

  let existingLeadId = null;

  if (normalizedPhone) {
    const { data: phoneMatch } = await supabase
      .from('leads')
      .select('id')
      .eq('owner_id', user.id)
      .eq('normalized_phone', normalizedPhone)
      .single();
    if (phoneMatch) existingLeadId = phoneMatch.id;
  }

  if (!existingLeadId && normalizedEmail) {
    const { data: emailMatch } = await supabase
      .from('leads')
      .select('id')
      .eq('owner_id', user.id)
      .eq('normalized_email', normalizedEmail)
      .single();
    if (emailMatch) existingLeadId = emailMatch.id;
  }

  let attributionData: Record<string, unknown> = {};
  if (leadData.landing_session_id) {
    const { data: interaction } = await supabase
      .from('marketing_interactions')
      .select('*')
      .eq('owner_id', user.id)
      .eq('session_id', leadData.landing_session_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (interaction) {
      attributionData = {
        campaign_name: interaction.campaign_name,
        ad_group_name: interaction.ad_group_name,
        ad_name: interaction.ad_name,
        creative_id: interaction.creative_id,
        utm_source: interaction.utm_source,
        utm_medium: interaction.utm_medium,
        utm_campaign: interaction.utm_campaign,
        fbclid: interaction.fbclid,
        gclid: interaction.gclid,
      };
    }
  }

  const upsertData = {
    name: typeof leadData.name === 'string' ? leadData.name.slice(0, 200) : null,
    phone: leadData.phone || null,
    email: leadData.email || null,
    normalized_phone: normalizedPhone,
    normalized_email: normalizedEmail,
    landing_session_id: leadData.landing_session_id || null,
    ...attributionData,
  };

  if (existingLeadId) {
    await supabase.from('leads').update(upsertData).eq('id', existingLeadId).eq('owner_id', user.id);
    return { success: true, leadId: existingLeadId, action: 'updated' };
  }

  const { data, error } = await supabase.from('leads').insert({
    ...upsertData,
    owner_id: user.id,
    status: 'NEW',
    revenue_amount: 0,
  }).select('id').single();

  if (error) throw error;
  return { success: true, leadId: data.id, action: 'inserted' };
}
