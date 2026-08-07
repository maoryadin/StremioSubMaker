/**
 * Detects foreign-script contamination in machine translations.
 *
 * LLMs translating into a non-Latin script occasionally emit a character from a
 * visually or statistically adjacent script mid-word. Observed live against Gemini on
 * 2026-08-07 translating EN -> Hebrew: 1.7%-2.4% of cues came back with an Arabic
 * codepoint spliced into a Hebrew word, e.g.
 *
 *   "אני הסכנה"   ->  "א\u0627ני הסכנה"   (Arabic alef U+0627 inside אני)
 *   "קנית אותי"   ->  "קנית אות\u064A"    (Arabic yeh U+064A for Hebrew yod)
 *
 * The result renders with wrong glyphs and breaks text search. Nothing downstream
 * catches it, so it ships to viewers.
 *
 * Detection rule, deliberately conservative to avoid false positives:
 *   flag a cue when the translation contains characters from a known script that is
 *   (a) not a script the target language is written in, and
 *   (b) not already present in the source cue.
 *
 * Condition (b) is what keeps legitimate content safe — an English film that quotes an
 * Arabic sign still has Arabic in the source, so the translation may keep it.
 * Unknown/unmapped target languages are never checked.
 */

// Character ranges per script. Only scripts where a stray character is unambiguous.
// Arabic intentionally excludes Arabic-Indic digits and punctuation: those can be
// legitimate formatting in Hebrew/Latin output and are not script contamination.
const SCRIPT_RANGES = {
  hebrew: /[\u0590-\u05FF\uFB1D-\uFB4F]/,
  arabic: /[\u0621-\u063A\u0641-\u064A\u066E-\u066F\u0671-\u06D3\u06FA-\u06FC\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/,
  cyrillic: /[\u0400-\u04FF\u0500-\u052F]/,
  greek: /[\u0370-\u03FF\u1F00-\u1FFF]/,
  devanagari: /[\u0900-\u097F]/,
  thai: /[\u0E00-\u0E7F]/,
  hangul: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/,
  kana: /[\u3040-\u309F\u30A0-\u30FF]/,
  han: /[\u4E00-\u9FFF\u3400-\u4DBF]/
};

// Which scripts a target language legitimately uses. Latin and common punctuation are
// always allowed and are not modelled here.
const LANGUAGE_SCRIPTS = {
  hebrew: ['hebrew'],
  arabic: ['arabic'],
  cyrillic: ['cyrillic'],
  greek: ['greek'],
  devanagari: ['devanagari'],
  thai: ['thai'],
  japanese: ['han', 'kana'],
  korean: ['hangul', 'han'],
  chinese: ['han']
};

// Language tokens (ISO 639-1/2 codes and English names) -> script group above.
const LANGUAGE_TOKEN_TO_GROUP = new Map(Object.entries({
  he: 'hebrew', heb: 'hebrew', hebrew: 'hebrew', iw: 'hebrew',
  yid: 'hebrew', yiddish: 'hebrew',
  ar: 'arabic', ara: 'arabic', arabic: 'arabic',
  fa: 'arabic', fas: 'arabic', per: 'arabic', persian: 'arabic', farsi: 'arabic',
  ur: 'arabic', urd: 'arabic', urdu: 'arabic',
  ps: 'arabic', pus: 'arabic', pashto: 'arabic', pushto: 'arabic',
  ckb: 'arabic', sorani: 'arabic',
  ru: 'cyrillic', rus: 'cyrillic', russian: 'cyrillic',
  uk: 'cyrillic', ukr: 'cyrillic', ukrainian: 'cyrillic',
  bg: 'cyrillic', bul: 'cyrillic', bulgarian: 'cyrillic',
  sr: 'cyrillic', srp: 'cyrillic', serbian: 'cyrillic',
  mk: 'cyrillic', mkd: 'cyrillic', macedonian: 'cyrillic',
  be: 'cyrillic', bel: 'cyrillic', belarusian: 'cyrillic',
  el: 'greek', ell: 'greek', gre: 'greek', greek: 'greek',
  hi: 'devanagari', hin: 'devanagari', hindi: 'devanagari',
  mr: 'devanagari', mar: 'devanagari', marathi: 'devanagari',
  ne: 'devanagari', nep: 'devanagari', nepali: 'devanagari',
  th: 'thai', tha: 'thai', thai: 'thai',
  ja: 'japanese', jpn: 'japanese', japanese: 'japanese',
  ko: 'korean', kor: 'korean', korean: 'korean',
  zh: 'chinese', zho: 'chinese', chi: 'chinese', chinese: 'chinese',
  mandarin: 'chinese', cantonese: 'chinese'
}));

function tokenize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

/**
 * Resolve the set of scripts a target language is legitimately written in.
 * @param {string} targetLanguage
 * @returns {string[]|null} allowed script names, or null when the language is unmapped
 */
function getAllowedScripts(targetLanguage) {
  for (const token of tokenize(targetLanguage)) {
    const group = LANGUAGE_TOKEN_TO_GROUP.get(token);
    if (group) return LANGUAGE_SCRIPTS[group] || null;
  }
  return null;
}

/**
 * Scripts present in a string, restricted to the known set.
 * @param {string} text
 * @returns {Set<string>}
 */
function scriptsPresent(text) {
  const found = new Set();
  const str = String(text || '');
  if (!str) return found;
  for (const [name, re] of Object.entries(SCRIPT_RANGES)) {
    if (re.test(str)) found.add(name);
  }
  return found;
}

/**
 * Find foreign-script contamination introduced by translation.
 * @param {string} sourceText - original cue text
 * @param {string} translatedText - translated cue text
 * @param {string[]|null} allowedScripts - from getAllowedScripts()
 * @returns {string[]} names of offending scripts (empty when clean)
 */
function findForeignScripts(sourceText, translatedText, allowedScripts) {
  if (!allowedScripts || allowedScripts.length === 0) return [];
  const inTranslation = scriptsPresent(translatedText);
  if (inTranslation.size === 0) return [];

  const allowed = new Set(allowedScripts);
  const inSource = scriptsPresent(sourceText);

  const offending = [];
  for (const script of inTranslation) {
    if (allowed.has(script)) continue;
    if (inSource.has(script)) continue; // legitimately carried over from the source
    offending.push(script);
  }
  return offending;
}

/**
 * Extract the offending substrings, for logging.
 * @param {string} text
 * @param {string[]} scripts
 * @returns {string[]}
 */
function extractForeignRuns(text, scripts) {
  const runs = [];
  for (const script of scripts) {
    const re = SCRIPT_RANGES[script];
    if (!re) continue;
    const global = new RegExp(`${re.source}+`, 'g');
    const matches = String(text || '').match(global);
    if (matches) runs.push(...matches);
  }
  return runs;
}

module.exports = {
  SCRIPT_RANGES,
  getAllowedScripts,
  scriptsPresent,
  findForeignScripts,
  extractForeignRuns
};
