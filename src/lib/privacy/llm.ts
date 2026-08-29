/**
 * External LLM privacy boundary.
 *
 * Creative generation calls an external model provider. This module is the
 * ONLY sanctioned way to build the data for that call: it copies an explicit
 * allow-list of campaign description fields and nothing else.
 *
 * ALLOWED TO SEND:
 * - service, offer            -- what is being advertised
 * - target_audience, location -- who the ad is for and where it runs
 * - destination_type          -- WEBSITE / WHATSAPP / PHONE, shapes the call to action
 * - the salon's own marketing description: name, area, services and prices,
 *   offers, positioning, tone, and which weekdays are quiet
 *
 * NEVER SEND:
 * - OAuth refresh/access tokens, Google Ads developer/customer/manager IDs,
 *   Supabase keys, encryption keys, Authorization headers, cookies
 * - Any lead or customer record: names, phone numbers, email addresses,
 *   session ids, attribution identifiers
 * - Landing URLs, budgets, spend limits, owner ids or campaign ids
 * - The salon's own WhatsApp or phone number, or its website and booking URLs
 */

export const LLM_ALLOWED_CAMPAIGN_FIELDS = [
  'service',
  'offer',
  'target_audience',
  'location',
  'destination_type',
] as const;

export type LlmAllowedField = (typeof LLM_ALLOWED_CAMPAIGN_FIELDS)[number];

export type LlmCampaignContext = {
  service: string;
  offer: string;
  target_audience: string;
  location: string;
  destination_type: string;
};

export const LLM_PRIVACY = {
  allowedFields: LLM_ALLOWED_CAMPAIGN_FIELDS,
  forbiddenFields: [
    'refresh_token',
    'access_token',
    'encrypted_credentials',
    'ENCRYPTION_KEY',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY',
  ] as const,
  consentRequired: true,
  currentlyExternal: true,
};

/** Values that must never appear in a prompt, whatever their source. */
const SECRET_ENV_VARS = [
  'GEMINI_API_KEY',
  'ENCRYPTION_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_ADS_TEST_CUSTOMER_ID',
  'GOOGLE_ADS_TEST_MANAGER_ID',
];

/** Shapes that indicate credential or personal data leaked into a prompt. */
const FORBIDDEN_PATTERNS: { name: string; re: RegExp }[] = [
  { name: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}/i },
  { name: 'authorization header', re: /\bauthorization\s*[:=]/i },
  { name: 'oauth token field', re: /\b(refresh_token|access_token|id_token|client_secret)\b/i },
  { name: 'encrypted credential blob', re: /\bencrypted_credentials\b/i },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'json web token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: 'email address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'phone number', re: /(?:\+?\d[\s-]?){9,}\d/ },
  { name: 'google ads customer id', re: /\b\d{3}-\d{3}-\d{4}\b/ },
];

/**
 * Copies only the allow-listed campaign fields. Anything else on the row --
 * budgets, owner ids, landing URLs, verification state -- is dropped here and
 * cannot reach the provider.
 */
export function buildLlmCampaignContext(campaign: Record<string, unknown>): LlmCampaignContext {
  const pick = (field: LlmAllowedField): string => {
    const value = campaign[field];
    return typeof value === 'string' ? value.trim() : '';
  };

  return {
    service: pick('service'),
    offer: pick('offer'),
    target_audience: pick('target_audience'),
    location: pick('location'),
    destination_type: pick('destination_type'),
  };
}

/**
 * Last line of defence before a prompt leaves the process. Throws rather than
 * sending anything that looks like a credential or personal data.
 */
export function assertPromptIsSafe(prompt: string): void {
  for (const envVar of SECRET_ENV_VARS) {
    const value = process.env[envVar];
    if (value && value.length >= 8 && prompt.includes(value)) {
      throw new Error(`LLM_PRIVACY_VIOLATION: prompt contains the value of ${envVar}`);
    }
  }

  for (const { name, re } of FORBIDDEN_PATTERNS) {
    if (re.test(prompt)) {
      throw new Error(`LLM_PRIVACY_VIOLATION: prompt contains what looks like a ${name}`);
    }
  }
}


/* ------------------------------------------------------------------------ *
 * Salon marketing context
 *
 * The strategist needs to know the salon; it does not need any way to contact
 * it. Contact details and URLs are dropped here, which also keeps them clear of
 * the phone-number and email guards below.
 * ------------------------------------------------------------------------ */

export const LLM_ALLOWED_SALON_FIELDS = [
  'salon_name',
  'description',
  'location',
  'service_areas',
  'target_customer_types',
  'unique_selling_points',
  'brand_positioning',
  'preferred_tone',
  'slow_days',
  'busy_days',
  'default_destination_type',
  'currency',
] as const;

export type LlmSalonContext = {
  salon_name: string;
  description: string;
  location: string;
  service_areas: string[];
  target_customer_types: string[];
  unique_selling_points: string[];
  brand_positioning: string;
  preferred_tone: string;
  slow_days: string[];
  busy_days: string[];
  default_destination_type: string;
  currency: string;
  services: { name: string; category: string; price: number | null; margin_tier: string | null }[];
  offers: { name: string; description: string; price: number | null; terms: string }[];
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean) : [];
}

function money(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Copies only the allow-listed salon fields, plus services and offers reduced
 * to what a strategist can actually use. Contact numbers, URLs, ids and
 * timestamps are dropped and cannot reach the provider.
 */
export function buildLlmSalonContext(
  profile: Record<string, unknown> | null,
  services: Record<string, unknown>[],
  offers: Record<string, unknown>[]
): LlmSalonContext {
  const p = profile || {};
  return {
    salon_name: text(p.salon_name),
    description: text(p.description),
    location: text(p.location),
    service_areas: stringList(p.service_areas),
    target_customer_types: stringList(p.target_customer_types),
    unique_selling_points: stringList(p.unique_selling_points),
    brand_positioning: text(p.brand_positioning),
    preferred_tone: text(p.preferred_tone),
    slow_days: stringList(p.slow_days),
    busy_days: stringList(p.busy_days),
    default_destination_type: text(p.default_destination_type) || 'WEBSITE',
    currency: text(p.currency) || 'INR',
    services: (services || [])
      .filter((s) => s && s.is_active !== false)
      .map((s) => ({
        name: text(s.name),
        category: text(s.category),
        price: money(s.price),
        margin_tier: text(s.margin_tier) || null,
      }))
      .filter((s) => s.name),
    offers: (offers || [])
      .filter((o) => o && o.is_active !== false)
      .map((o) => ({
        name: text(o.name),
        description: text(o.description),
        price: money(o.price),
        terms: text(o.terms),
      }))
      .filter((o) => o.name),
  };
}
