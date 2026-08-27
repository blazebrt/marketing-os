import { ERROR_CODES, type ErrorCode } from './errors';

/** Plain-English messages for the salon owner. No codes, no internals. */
const MESSAGES: Record<ErrorCode, string> = {
  [ERROR_CODES.UNAUTHORIZED]: 'You are not signed in, or this campaign is not yours. Try signing in again.',
  [ERROR_CODES.GENERATION_FAILED]: 'Something went wrong while saving. Nothing was changed. Please try again.',
  [ERROR_CODES.VALIDATION_FAILED]: 'That text will not fit in a Google ad. Shorten it and try again.',
  [ERROR_CODES.RATE_LIMITED]: 'You are writing ads too quickly. Wait a few seconds and try again.',
  [ERROR_CODES.DESTINATION_INVALID]: 'The website address for this campaign is not valid.',
  [ERROR_CODES.DESTINATION_UNREACHABLE]: 'We could not reach the website address for this campaign.',
  [ERROR_CODES.APPROVAL_FAILED]: 'This campaign is not ready to approve yet. Check the items still awaiting a decision.',
  [ERROR_CODES.CREATIVE_LOCKED]: 'This wording is already approved, so it cannot be changed. Use Replace if you want different wording.',
  [ERROR_CODES.CONFLICT]: 'Someone changed this campaign while you were working. Refresh the page and try again.',
  [ERROR_CODES.LLM_NOT_CONFIGURED]:
    'The ad-writing service is not set up yet. A GEMINI_API_KEY needs to be added to the site settings before ads can be written.',
  [ERROR_CODES.LLM_UNAVAILABLE]:
    'The ad-writing service did not respond. Nothing was saved. Please try again in a moment.',
  [ERROR_CODES.LLM_INVALID_OUTPUT]:
    'The ad-writing service could not produce ads that fit Google’s limits. Nothing was saved. Please try again.',
};

export function ownerMessage(code: string | undefined): string {
  if (code && code in MESSAGES) return MESSAGES[code as ErrorCode];
  return 'Something went wrong. Nothing was saved. Please try again.';
}
