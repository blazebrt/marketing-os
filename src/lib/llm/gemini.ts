import { GoogleGenAI, Type } from '@google/genai';
import { AppError, ERROR_CODES } from '@/lib/errors';
import { assertPromptIsSafe, type LlmCampaignContext } from '@/lib/privacy/llm';
import { GOOGLE_LIMITS } from '@/lib/providers/google/validation';

/** Raw, unvalidated model output. Callers must sanitise and validate before storing. */
export type RawAdCopy = {
  headlines: string[];
  descriptions: string[];
  keywords: { text: string; match_type: 'PHRASE' | 'EXACT' }[];
};

// gemini-flash-latest tracks the current Flash model, so the app does not break
// when a pinned version is retired. Override with GEMINI_MODEL to pin one.
const DEFAULT_MODEL = 'gemini-flash-latest';

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headlines: { type: Type.ARRAY, items: { type: Type.STRING } },
    descriptions: { type: Type.ARRAY, items: { type: Type.STRING } },
    keywords: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          match_type: { type: Type.STRING, enum: ['PHRASE', 'EXACT'] },
        },
        required: ['text', 'match_type'],
      },
    },
  },
  required: ['headlines', 'descriptions', 'keywords'],
};

function callToAction(destinationType: string): string {
  if (destinationType === 'WHATSAPP') return 'Customers will message the salon on WhatsApp, so invite them to message or enquire.';
  if (destinationType === 'PHONE') return 'Customers will phone the salon, so invite them to call or book by phone.';
  return 'Customers will land on the salon website, so invite them to book online.';
}

function buildPrompt(context: LlmCampaignContext, previousErrors?: string[]): string {
  const audience = context.target_audience || 'local salon customers';
  const location = context.location || 'the local area';

  const retryNote = previousErrors?.length
    ? `\nYour previous attempt was rejected for these reasons. Fix every one:\n${previousErrors.map((e) => `- ${e}`).join('\n')}\n`
    : '';

  return `You are writing Google Search ads for an Indian salon and beauty business.

Campaign details:
- Service being promoted: ${context.service}
- Offer: ${context.offer}
- Who the ads are for: ${audience}
- Area the ads target: ${location}
- ${callToAction(context.destination_type)}

Write ad copy for Indian consumers searching in India. Requirements:
- Sound natural to an Indian reader. Use Indian English as it is actually written in salon
  advertising. Rupee amounts use the Rs. or the rupee sign, never dollars.
- It is fine to use common Hinglish words that Indian salon customers genuinely search for
  (for example bridal, mehendi, facial, threading, keratin) but do not force them.
- Reference ${location} naturally where it helps a nearby customer recognise the salon.
- Do not invent facts: no prices other than the offer above, no discounts other than the
  offer above, no claims about awards, ratings, years in business, or number of customers.
- No emoji. No ALL CAPS words. No exclamation marks in headlines.
- Every item must be unique. Do not repeat the same phrase in different casing.

Produce exactly:
- ${GOOGLE_LIMITS.MAX_HEADLINES} headlines, each at most ${GOOGLE_LIMITS.HEADLINE_MAX_LENGTH} characters
  including spaces. Count characters carefully; this limit is enforced and over-long
  headlines are discarded.
- ${GOOGLE_LIMITS.MAX_DESCRIPTIONS} descriptions, each at most ${GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH} characters including spaces.
- ${GOOGLE_LIMITS.MAX_KEYWORDS} keywords, each at most ${GOOGLE_LIMITS.KEYWORD_MAX_LENGTH} characters and at most 10 words.
  Keywords must contain only letters, numbers and spaces: no punctuation of any kind.
  Give roughly two thirds PHRASE match (broader intent, e.g. the service plus the area)
  and one third EXACT match (the tightest, highest intent searches).
${retryNote}`;
}

/**
 * Calls Gemini and returns its raw suggestion. Throws rather than returning
 * anything on a missing key or a failed call: there is deliberately no
 * template fallback, so a failure is visible to the owner.
 */
export async function generateAdCopy(
  context: LlmCampaignContext,
  previousErrors?: string[]
): Promise<RawAdCopy> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(ERROR_CODES.LLM_NOT_CONFIGURED, 503);
  }

  const prompt = buildPrompt(context, previousErrors);
  // Throws if anything credential-shaped or personal reached the prompt.
  assertPromptIsSafe(prompt);

  // GEMINI_BASE_URL lets the endpoint be pointed at a proxy or a stub in tests.
  const baseUrl = process.env.GEMINI_BASE_URL;
  const ai = new GoogleGenAI(baseUrl ? { apiKey, httpOptions: { baseUrl } } : { apiKey });

  let text: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || DEFAULT_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.9,
      },
    });
    text = response.text;
  } catch {
    // The provider error may quote request details; never surface or log it raw.
    throw new AppError(ERROR_CODES.LLM_UNAVAILABLE, 502);
  }

  if (!text) {
    throw new AppError(ERROR_CODES.LLM_UNAVAILABLE, 502);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AppError(ERROR_CODES.LLM_INVALID_OUTPUT, 502);
  }

  const body = parsed as Partial<RawAdCopy>;
  if (!Array.isArray(body?.headlines) || !Array.isArray(body?.descriptions) || !Array.isArray(body?.keywords)) {
    throw new AppError(ERROR_CODES.LLM_INVALID_OUTPUT, 502);
  }

  return {
    headlines: body.headlines.filter((h): h is string => typeof h === 'string'),
    descriptions: body.descriptions.filter((d): d is string => typeof d === 'string'),
    keywords: body.keywords
      .filter((k): k is { text: string; match_type: 'PHRASE' | 'EXACT' } =>
        !!k && typeof (k as { text?: unknown }).text === 'string')
      .map((k) => ({
        text: k.text,
        match_type: k.match_type === 'PHRASE' ? 'PHRASE' : 'EXACT',
      })),
  };
}
