export class GoogleProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: any
  ) {
    super(message);
    this.name = 'GoogleProviderError';
  }
}

export const ERROR_CODES = {
  AUTH_FAILED: 'GOOGLE_AUTH_FAILED',
  TEST_ACCOUNT_REQUIRED: 'GOOGLE_TEST_ACCOUNT_REQUIRED',
  PERMISSION_DENIED: 'GOOGLE_PERMISSION_DENIED',
  RATE_LIMITED: 'GOOGLE_RATE_LIMITED',
  INVALID_REQUEST: 'GOOGLE_INVALID_REQUEST',
  RESOURCE_CONFLICT: 'GOOGLE_RESOURCE_CONFLICT',
  DEPLOYMENT_FAILED: 'GOOGLE_DEPLOYMENT_FAILED',
  RECONCILIATION_REQUIRED: 'GOOGLE_RECONCILIATION_REQUIRED',
  INTERNAL_ERROR: 'GOOGLE_INTERNAL_ERROR',
} as const;
