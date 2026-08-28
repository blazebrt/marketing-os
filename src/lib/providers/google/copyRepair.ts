import { GOOGLE_LIMITS, normalizeCreativeText } from './validation';
import type { RawAdCopy } from '@/lib/llm/gemini';

/**
 * Cleans raw model output into something that can satisfy validation.ts.
 * Nothing here relaxes a rule: it removes characters the validator rejects and
 * truncates over-long text at a word boundary. Anything that cannot be repaired
 * is dropped, and the caller re-generates if too little survives.
 */

/** Strips control characters and newlines, and collapses runs of whitespace. */
function flatten(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    out += code <= 31 || code === 127 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Truncates at a word boundary where possible, never mid-word if avoidable. */
function truncateCleanly(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const hardCut = value.slice(0, limit);
  const lastSpace = hardCut.lastIndexOf(' ');
  // Only back off to the word boundary if it keeps most of the allowance.
  const candidate = lastSpace > limit * 0.6 ? hardCut.slice(0, lastSpace) : hardCut;
  return candidate.replace(/[\s\-–—,;:.!?]+$/, '').trim();
}

function repairText(value: string, limit: number): string {
  return truncateCleanly(flatten(value), limit);
}

/** Keywords additionally reject punctuation and are capped at 10 words. */
function repairKeyword(value: string): string {
  const stripped = flatten(value)
    .replace(/[!@#$%^&*()_+=[\]{};':"\\|,.<>?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = stripped.split(' ').filter(Boolean).slice(0, 10);
  return truncateCleanly(words.join(' '), GOOGLE_LIMITS.KEYWORD_MAX_LENGTH);
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = normalizeCreativeText(key(item));
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export type RepairedAdCopy = {
  headlines: string[];
  descriptions: string[];
  keywords: { text: string; match_type: 'PHRASE' | 'EXACT' }[];
};

export function repairAdCopy(raw: RawAdCopy): RepairedAdCopy {
  const headlines = dedupe(
    raw.headlines.map((h) => repairText(h, GOOGLE_LIMITS.HEADLINE_MAX_LENGTH)).filter((h) => h.length > 0),
    (h) => h
  ).slice(0, GOOGLE_LIMITS.MAX_HEADLINES);

  const descriptions = dedupe(
    raw.descriptions.map((d) => repairText(d, GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH)).filter((d) => d.length > 0),
    (d) => d
  ).slice(0, GOOGLE_LIMITS.MAX_DESCRIPTIONS);

  const keywords = dedupe(
    raw.keywords
      .map((k) => ({ text: repairKeyword(k.text), match_type: k.match_type }))
      .filter((k) => k.text.length > 0),
    (k) => k.text
  ).slice(0, GOOGLE_LIMITS.MAX_KEYWORDS);

  return { headlines, descriptions, keywords };
}

/**
 * Whether a repaired set is rich enough to be worth keeping. Falling short is
 * not an error on its own -- it triggers another attempt at the model.
 */
export function meetsTargetCounts(copy: RepairedAdCopy): boolean {
  return (
    copy.headlines.length === GOOGLE_LIMITS.MAX_HEADLINES &&
    copy.descriptions.length === GOOGLE_LIMITS.MAX_DESCRIPTIONS &&
    copy.keywords.length >= GOOGLE_LIMITS.MAX_KEYWORDS - 5
  );
}

/** Human-readable shortfalls, fed back to the model on a retry. */
export function describeShortfalls(copy: RepairedAdCopy): string[] {
  const notes: string[] = [];
  if (copy.headlines.length < GOOGLE_LIMITS.MAX_HEADLINES) {
    notes.push(
      `Only ${copy.headlines.length} usable headlines survived; return ${GOOGLE_LIMITS.MAX_HEADLINES} unique headlines of at most ${GOOGLE_LIMITS.HEADLINE_MAX_LENGTH} characters.`
    );
  }
  if (copy.descriptions.length < GOOGLE_LIMITS.MAX_DESCRIPTIONS) {
    notes.push(
      `Only ${copy.descriptions.length} usable descriptions survived; return ${GOOGLE_LIMITS.MAX_DESCRIPTIONS} unique descriptions of at most ${GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  if (copy.keywords.length < GOOGLE_LIMITS.MAX_KEYWORDS - 5) {
    notes.push(
      `Only ${copy.keywords.length} usable keywords survived; return about ${GOOGLE_LIMITS.MAX_KEYWORDS} unique keywords using letters, numbers and spaces only.`
    );
  }
  return notes;
}
