import { GoogleCreativeItem } from './types';

export const GOOGLE_LIMITS = {
  HEADLINE_MAX_LENGTH: 30,
  DESCRIPTION_MAX_LENGTH: 90,
  KEYWORD_MAX_LENGTH: 80,
  MAX_HEADLINES: 15,
  MAX_DESCRIPTIONS: 4,
};

export function validateKeyword(item: GoogleCreativeItem): string[] {
  const errors: string[] = [];
  if (!item.current_value || item.current_value.trim().length === 0) {
    errors.push('Keyword cannot be empty');
  }
  if (item.current_value && item.current_value.length > GOOGLE_LIMITS.KEYWORD_MAX_LENGTH) {
    errors.push(`Keyword exceeds limit of ${GOOGLE_LIMITS.KEYWORD_MAX_LENGTH} characters`);
  }
  if (item.current_value && /[!@#$%^&*()]/.test(item.current_value)) {
    errors.push('Keyword contains invalid characters');
  }
  if (item.match_type !== 'EXACT' && item.match_type !== 'PHRASE') {
    errors.push('Unsupported match type (only EXACT or PHRASE allowed)');
  }
  return errors;
}

export function validateHeadline(item: GoogleCreativeItem): string[] {
  const errors: string[] = [];
  if (!item.current_value || item.current_value.trim().length === 0) {
    errors.push('Headline cannot be empty');
  }
  if (item.current_value && item.current_value.length > GOOGLE_LIMITS.HEADLINE_MAX_LENGTH) {
    errors.push(`Headline exceeds limit of ${GOOGLE_LIMITS.HEADLINE_MAX_LENGTH} characters`);
  }
  return errors;
}

export function validateDescription(item: GoogleCreativeItem): string[] {
  const errors: string[] = [];
  if (!item.current_value || item.current_value.trim().length === 0) {
    errors.push('Description cannot be empty');
  }
  if (item.current_value && item.current_value.length > GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH) {
    errors.push(`Description exceeds limit of ${GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH} characters`);
  }
  return errors;
}
