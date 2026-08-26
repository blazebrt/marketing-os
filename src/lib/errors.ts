export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  GENERATION_FAILED: 'GENERATION_FAILED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  DESTINATION_INVALID: 'DESTINATION_INVALID',
  DESTINATION_UNREACHABLE: 'DESTINATION_UNREACHABLE',
  APPROVAL_FAILED: 'APPROVAL_FAILED',
  CREATIVE_LOCKED: 'CREATIVE_LOCKED',
  CONFLICT: 'CONFLICT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;

  constructor(code: ErrorCode, httpStatus = 400) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function toSafeError(err: unknown): { code: ErrorCode; httpStatus: number } {
  if (err instanceof AppError) {
    return { code: err.code, httpStatus: err.httpStatus };
  }
  const message = err instanceof Error ? err.message : '';
  if (message.includes('RATE_LIMITED') || message.includes('Rate limit')) {
    return { code: ERROR_CODES.RATE_LIMITED, httpStatus: 429 };
  }
  if (message.includes('UNAUTHORIZED') || message.includes('Unauthorized') || message.includes('unauthorized')) {
    return { code: ERROR_CODES.UNAUTHORIZED, httpStatus: 401 };
  }
  if (message.includes('VALIDATION') || message.includes('invalid')) {
    return { code: ERROR_CODES.VALIDATION_FAILED, httpStatus: 400 };
  }
  if (message.includes('DESTINATION_INVALID')) {
    return { code: ERROR_CODES.DESTINATION_INVALID, httpStatus: 400 };
  }
  if (message.includes('DESTINATION_UNREACHABLE')) {
    return { code: ERROR_CODES.DESTINATION_UNREACHABLE, httpStatus: 400 };
  }
  if (message.includes('APPROVAL') || message.includes('rejected') || message.includes('unapproved')) {
    return { code: ERROR_CODES.APPROVAL_FAILED, httpStatus: 400 };
  }
  if (message.includes('APPROVED') || message.includes('CREATIVE_LOCKED')) {
    return { code: ERROR_CODES.CREATIVE_LOCKED, httpStatus: 409 };
  }
  return { code: ERROR_CODES.GENERATION_FAILED, httpStatus: 500 };
}

export function logSafeError(scope: string, err: unknown): void {
  const safe = toSafeError(err);
  console.error(JSON.stringify({ scope, code: safe.code }));
}
