import { GoogleCreativeItem } from './types';

export const GOOGLE_LIMITS = {
  HEADLINE_MAX_LENGTH: 30,
  DESCRIPTION_MAX_LENGTH: 90,
  KEYWORD_MAX_LENGTH: 80,
  MAX_HEADLINES: 15,
  MIN_HEADLINES: 3,
  MAX_DESCRIPTIONS: 4,
  MIN_DESCRIPTIONS: 2,
  MAX_KEYWORDS: 20,
  MIN_KEYWORDS: 1,
  MAX_PAYLOAD_BYTES: 32768,
};

function hasControlOrNewline(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}
export const ITEM_TYPES = ['headlines', 'descriptions', 'keywords'] as const;
export type CreativeItemType = (typeof ITEM_TYPES)[number];

export function isCreativeItemType(value: string): value is CreativeItemType {
  return (ITEM_TYPES as readonly string[]).includes(value);
}

export function normalizeCreativeText(value: string): string {
  return value.normalize('NFC').trim().toLowerCase();
}

export function validateKeyword(item: GoogleCreativeItem): string[] {
  const errors: string[] = [];
  const value = item.current_value;
  if (typeof value !== 'string') {
    errors.push('Keyword must be a string');
    return errors;
  }
  if (value.trim().length === 0) errors.push('Keyword cannot be empty');
  if (value.length > GOOGLE_LIMITS.KEYWORD_MAX_LENGTH) {
    errors.push(`Keyword exceeds limit of ${GOOGLE_LIMITS.KEYWORD_MAX_LENGTH} characters`);
  }
  if (hasControlOrNewline(value)) errors.push('Keyword contains control or newline characters');
  if (value.split(/\s+/).length > 10) errors.push('Keyword has too many words (max 10)');
  if (/[!@#$%^&*()_+=[\]{};':"\\|,.<>?]+/.test(value)) {
    errors.push('Keyword contains invalid characters');
  }
  if (item.match_type !== 'EXACT' && item.match_type !== 'PHRASE') {
    errors.push('Unsupported match type (only EXACT or PHRASE allowed)');
  }
  return errors;
}

export function validateHeadline(item: GoogleCreativeItem): string[] {
  const errors: string[] = [];
  const value = item.current_value;
  if (typeof value !== 'string') {
    errors.push('Headline must be a string');
    return errors;
  }
  if (value.trim().length === 0) errors.push('Headline cannot be empty');
  if (value.length > GOOGLE_LIMITS.HEADLINE_MAX_LENGTH) {
    errors.push(`Headline exceeds limit of ${GOOGLE_LIMITS.HEADLINE_MAX_LENGTH} characters`);
  }
  if (hasControlOrNewline(value)) errors.push('Headline contains control or newline characters');
  return errors;
}

export function validateDescription(item: GoogleCreativeItem): string[] {
  const errors: string[] = [];
  const value = item.current_value;
  if (typeof value !== 'string') {
    errors.push('Description must be a string');
    return errors;
  }
  if (value.trim().length === 0) errors.push('Description cannot be empty');
  if (value.length > GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH) {
    errors.push(`Description exceeds limit of ${GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH} characters`);
  }
  if (hasControlOrNewline(value)) errors.push('Description contains control or newline characters');
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

function validateStringList(
  values: unknown,
  kind: 'headline' | 'description' | 'keyword',
  min: number,
  max: number
): string[] {
  const errors: string[] = [];
  const label = kind + 's';
  if (!Array.isArray(values)) {
    errors.push(`${label} must be an array`);
    return errors;
  }
  if (values.length < min) errors.push(`At least ${min} ${label} are required`);
  if (values.length > max) errors.push(`Maximum ${max} ${label} allowed`);

  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== 'string') {
      errors.push(`${kind}s must be strings`);
      continue;
    }
    const item: GoogleCreativeItem = {
      id: '',
      original_value: raw,
      current_value: raw,
      ai_generated: true,
      owner_approved: false,
      match_type: kind === 'keyword' ? 'EXACT' : undefined,
    };
    if (kind === 'headline') errors.push(...validateHeadline(item));
    else if (kind === 'description') errors.push(...validateDescription(item));
    else errors.push(...validateKeyword(item));

    const normalized = normalizeCreativeText(raw);
    if (seen.has(normalized)) errors.push(`Duplicate ${kind}: "${normalized}"`);
    seen.add(normalized);
  }
  return errors;
}

export function validateCreativePayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  const jsonSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (jsonSize > GOOGLE_LIMITS.MAX_PAYLOAD_BYTES) {
    return { valid: false, errors: ['Payload exceeds maximum size'] };
  }

  const body = payload as Record<string, unknown>;
  errors.push(
    ...validateStringList(body.headlines, 'headline', GOOGLE_LIMITS.MIN_HEADLINES, GOOGLE_LIMITS.MAX_HEADLINES)
  );
  errors.push(
    ...validateStringList(
      body.descriptions,
      'description',
      GOOGLE_LIMITS.MIN_DESCRIPTIONS,
      GOOGLE_LIMITS.MAX_DESCRIPTIONS
    )
  );
  errors.push(
    ...validateStringList(body.keywords, 'keyword', GOOGLE_LIMITS.MIN_KEYWORDS, GOOGLE_LIMITS.MAX_KEYWORDS)
  );

  return { valid: errors.length === 0, errors };
}

export function validateStoredItems(
  items: unknown,
  type: CreativeItemType
): ValidationResult {
  if (!Array.isArray(items)) return { valid: false, errors: [`${type} must be an array`] };

  const fn = type === 'headlines' ? validateHeadline : type === 'descriptions' ? validateDescription : validateKeyword;
  const min =
    type === 'headlines'
      ? GOOGLE_LIMITS.MIN_HEADLINES
      : type === 'descriptions'
        ? GOOGLE_LIMITS.MIN_DESCRIPTIONS
        : GOOGLE_LIMITS.MIN_KEYWORDS;
  const max =
    type === 'headlines'
      ? GOOGLE_LIMITS.MAX_HEADLINES
      : type === 'descriptions'
        ? GOOGLE_LIMITS.MAX_DESCRIPTIONS
        : GOOGLE_LIMITS.MAX_KEYWORDS;

  const errors: string[] = [];
  if (items.length < min) errors.push(`At least ${min} ${type} are required`);
  if (items.length > max) errors.push(`Maximum ${max} ${type} allowed`);

  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      errors.push('Creative items must be objects');
      continue;
    }
    const typed = item as GoogleCreativeItem;
    errors.push(...fn(typed));
    if (typeof typed.current_value === 'string') {
      const n = normalizeCreativeText(typed.current_value);
      if (seen.has(n)) errors.push(`Duplicate ${type}`);
      seen.add(n);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function googleCreativeApprovalErrors(google: {
  headlines?: GoogleCreativeItem[];
  descriptions?: GoogleCreativeItem[];
  keywords?: GoogleCreativeItem[];
}): string[] {
  const errors: string[] = [];
  for (const type of ITEM_TYPES) {
    const items = google[type] || [];
    if (items.some((i) => i.rejected)) {
      errors.push(`Rejected ${type} remain`);
    }
    const unapproved = items.filter((i) => i.owner_approved !== true);
    if (unapproved.length > 0) errors.push(`Unapproved ${type} remain`);
    const stored = validateStoredItems(items, type);
    if (!stored.valid) errors.push(...stored.errors);
  }
  return errors;
}

export function hasApprovedItem(google: {
  headlines?: GoogleCreativeItem[];
  descriptions?: GoogleCreativeItem[];
  keywords?: GoogleCreativeItem[];
}): boolean {
  return ITEM_TYPES.some((type) => (google[type] || []).some((i) => i.owner_approved === true && !i.rejected));
}
