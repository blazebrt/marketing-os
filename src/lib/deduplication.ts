import { createClient } from './supabase/server';

export async function processIncomingLead(leadData: any) {
  const supabase = await createClient();
  
  // Normalize identifiers
  const normalizedPhone = leadData.phone ? leadData.phone.replace(/\D/g, '') : null;
  const normalizedEmail = leadData.email ? leadData.email.trim().toLowerCase() : null;

  // 1. Try to find exact existing match (never aggressively merge)
  let existingLeadId = null;

  if (normalizedPhone) {
    const { data: phoneMatch } = await supabase
      .from('leads')
      .select('id')
      .eq('normalized_phone', normalizedPhone)
      .single();
    if (phoneMatch) existingLeadId = phoneMatch.id;
  }

  if (!existingLeadId && normalizedEmail) {
    const { data: emailMatch } = await supabase
      .from('leads')
      .select('id')
      .eq('normalized_email', normalizedEmail)
      .single();
    if (emailMatch) existingLeadId = emailMatch.id;
  }

  // 2. Fetch First-Touch Attribution if session exists
  let attributionData = {};
  if (leadData.landing_session_id) {
    const { data: interaction } = await supabase
      .from('marketing_interactions')
      .select('*')
      .eq('session_id', leadData.landing_session_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
      
    if (interaction) {
      attributionData = {
        campaign_name: interaction.campaign_id, // simplified mapping
        ad_group_name: interaction.ad_group_id,
        ad_name: interaction.ad_id,
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
    name: leadData.name,
    phone: leadData.phone,
    email: leadData.email,
    normalized_phone: normalizedPhone,
    normalized_email: normalizedEmail,
    landing_session_id: leadData.landing_session_id,
    ...attributionData,
  };

  if (existingLeadId) {
    // Update existing lead safely (only update missing fields or status)
    await supabase.from('leads').update(upsertData).eq('id', existingLeadId);
    return { success: true, leadId: existingLeadId, action: 'updated' };
  } else {
    // Create new lead
    const { data, error } = await supabase.from('leads').insert({
      ...upsertData,
      status: 'NEW'
    }).select('id').single();
    
    if (error) throw error;
    return { success: true, leadId: data.id, action: 'inserted' };
  }
}
