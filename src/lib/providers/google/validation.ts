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
  if (item.current_value && item.current_value.split(/\s+/).length > 10) {
    errors.push('Keyword has too many words (max 10)');
  }
  if (item.current_value && /[!@#$%^&*()_+=[\]{};':"\\|,.<>?]+/.test(item.current_value)) {
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

export interface GoogleCreativePayload {
  headlines: string[];
  descriptions: string[];
  keywords: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateCreativePayload(payload: any): ValidationResult {
  const errors: string[] = [];
  
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  // HEADLINES
  if (!Array.isArray(payload.headlines)) {
    errors.push('headlines must be an array');
  } else {
    if (payload.headlines.length < 3) errors.push('At least 3 headlines are required');
    if (payload.headlines.length > GOOGLE_LIMITS.MAX_HEADLINES) errors.push(`Maximum ${GOOGLE_LIMITS.MAX_HEADLINES} headlines allowed`);
    
    const hSet = new Set();
    for (const h of payload.headlines) {
      if (typeof h !== 'string') {
        errors.push('Headlines must be strings');
        continue;
      }
      const item: GoogleCreativeItem = { id: '', original_value: h, current_value: h, ai_generated: true, owner_approved: false };
      const errs = validateHeadline(item);
      if (errs.length > 0) errors.push(...errs);

      const normalized = h.trim().toLowerCase();
      if (hSet.has(normalized)) {
        errors.push(`Duplicate headline: "${normalized}"`);
      }
      hSet.add(normalized);
    }
  }

  // DESCRIPTIONS
  if (!Array.isArray(payload.descriptions)) {
    errors.push('descriptions must be an array');
  } else {
    if (payload.descriptions.length < 2) errors.push('At least 2 descriptions are required');
    if (payload.descriptions.length > GOOGLE_LIMITS.MAX_DESCRIPTIONS) errors.push(`Maximum ${GOOGLE_LIMITS.MAX_DESCRIPTIONS} descriptions allowed`);

    const dSet = new Set();
    for (const d of payload.descriptions) {
      if (typeof d !== 'string') {
        errors.push('Descriptions must be strings');
        continue;
      }
      const item: GoogleCreativeItem = { id: '', original_value: d, current_value: d, ai_generated: true, owner_approved: false };
      const errs = validateDescription(item);
      if (errs.length > 0) errors.push(...errs);

      const normalized = d.trim().toLowerCase();
      if (dSet.has(normalized)) {
        errors.push(`Duplicate description: "${normalized}"`);
      }
      dSet.add(normalized);
    }
  }

  // KEYWORDS
  if (!Array.isArray(payload.keywords)) {
    errors.push('keywords must be an array');
  } else {
    if (payload.keywords.length < 1) errors.push('At least 1 keyword is required');

    const kSet = new Set();
    for (const k of payload.keywords) {
      if (typeof k !== 'string') {
        errors.push('Keywords must be strings');
        continue;
      }
      const item: GoogleCreativeItem = { id: '', original_value: k, current_value: k, ai_generated: true, owner_approved: false, match_type: 'EXACT' };
      const errs = validateKeyword(item);
      if (errs.length > 0) errors.push(...errs);

      const normalized = k.trim().toLowerCase();
      if (kSet.has(normalized)) {
        errors.push(`Duplicate keyword: "${normalized}"`);
      }
      kSet.add(normalized);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
