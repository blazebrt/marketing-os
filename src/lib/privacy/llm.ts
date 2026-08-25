/**
 * External LLM privacy boundary.
 *
 * The current generator is local/mock and does not call a provider.
 * Before enabling a real LLM, the following campaign fields WOULD leave the app:
 *
 * ALLOWED TO SEND (with owner consent):
 * - service
 * - offer
 * - non-secret campaign context needed to write ads (language, destination_type)
 *
 * NEVER SEND:
 * - OAuth refresh/access tokens
 * - Google Ads developer tokens / customer IDs / manager IDs
 * - Supabase keys
 * - encryption keys
 * - Authorization headers
 * - cookies
 * - internal database secrets
 *
 * Production must collect explicit consent before any external LLM call.
 */
export const LLM_PRIVACY = {
  allowedFields: ['service', 'offer', 'destination_type'] as const,
  forbiddenFields: [
    'refresh_token',
    'access_token',
    'encrypted_credentials',
    'ENCRYPTION_KEY',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY',
  ] as const,
  consentRequired: true,
  currentlyExternal: false,
};
