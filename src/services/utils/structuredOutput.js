/**
 * Shared structured-output (JSON schema) helpers for the LLM translation providers.
 *
 * The subtitle translation contract is always the same: given N source cues, return
 * exactly N objects of { id, text }. Pinning that count in the response schema makes
 * the engine's most common failure — an entry-count mismatch — impossible at decode
 * time, instead of something the parser has to detect and repair afterwards.
 */

/**
 * Maximum array length that can be pinned with minItems/maxItems.
 *
 * Verified empirically against the Gemini API on 2026-08-07: a responseSchema with
 * minItems/maxItems <= 149 is accepted, >= 150 is rejected with
 * `HTTP 400 Request contains an invalid argument`. Reproduced deterministically on
 * gemini-flash-lite-latest, gemini-3.5-flash and gemini-3-flash-preview. The limit is
 * not documented by Google, so it is pinned here with the evidence rather than left
 * as a magic number at the call sites.
 *
 * OpenAI strict Structured Outputs supports minItems/maxItems with no comparable
 * ceiling (except on fine-tuned models, where the keywords are rejected outright and
 * the provider's existing structured-output downgrade path handles it).
 */
const STRUCTURED_ITEM_COUNT_LIMIT = 149;

/**
 * Whether an expected entry count can be pinned in a response schema.
 * @param {number} expectedCount
 * @returns {boolean}
 */
function canPinItemCount(expectedCount) {
  return Number.isInteger(expectedCount)
    && expectedCount >= 1
    && expectedCount <= STRUCTURED_ITEM_COUNT_LIMIT;
}

/**
 * Gemini responseSchema: a root array of { id, text }.
 * Gemini accepts a root-level array, so no envelope object is needed.
 * @param {number} [expectedCount] - pins the array length when within the API limit
 * @returns {object}
 */
function buildGeminiSubtitleSchema(expectedCount) {
  const schema = {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        id: { type: 'INTEGER' },
        text: { type: 'STRING' }
      },
      required: ['id', 'text'],
      propertyOrdering: ['id', 'text']
    }
  };

  if (canPinItemCount(expectedCount)) {
    schema.minItems = expectedCount;
    schema.maxItems = expectedCount;
  }

  return schema;
}

/**
 * OpenAI strict Structured Outputs schema.
 * OpenAI requires a root object, so the array is wrapped in an `entries` envelope —
 * the engine's parseJsonResponse() already unwraps `entries` / `items` / `data`.
 * @param {number} [expectedCount] - pins the array length when supported
 * @returns {object}
 */
function buildOpenAISubtitleSchema(expectedCount) {
  const entries = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        text: { type: 'string' }
      },
      required: ['id', 'text'],
      additionalProperties: false
    }
  };

  if (canPinItemCount(expectedCount)) {
    entries.minItems = expectedCount;
    entries.maxItems = expectedCount;
  }

  return {
    type: 'object',
    properties: { entries },
    required: ['entries'],
    additionalProperties: false
  };
}

module.exports = {
  STRUCTURED_ITEM_COUNT_LIMIT,
  canPinItemCount,
  buildGeminiSubtitleSchema,
  buildOpenAISubtitleSchema
};
