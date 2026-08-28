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
 *
 * NEVER SEND:
 * - OAuth refresh/access tokens, Google Ads developer/customer/manager IDs,
 *   Supabase keys, encryption keys, Authorization headers, cookies
 * - Any lead or customer record: names, phone numbers, email addresses,
 *   session ids, attribution identifiers
 * - Landing URLs, budgets, spend limits, owner ids or campaign ids
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
