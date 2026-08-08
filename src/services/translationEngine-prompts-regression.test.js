const test = require('node:test');
const assert = require('node:assert/strict');

const TranslationEngine = require('./translationEngine');

const CUSTOM_PROMPT = 'Use concise {target_language} dialogue. Keep {target_language} natural.';
const CONTRACT_MARKERS = {
  original: 'Start immediately with "1."',
  ai: 'Preserving the timing and structure exactly as given',
  xml: 'Start with <s id="1">',
  json: 'valid JSON matching the response schema'
};
const WORKFLOWS = Object.keys(CONTRACT_MARKERS);

function createEngine(workflow) {
  const engine = new TranslationEngine(
    { translateSubtitle: async () => '' },
    'test-model',
    { translationWorkflow: workflow, mismatchRetries: 0 },
    { enableStreaming: false }
  );
  // The constructor currently coerces non-native `original` to XML. Set the
  // public workflow state directly so this regression covers every existing
  // prompt-builder route without changing constructor behavior in this task.
  engine.translationWorkflow = workflow;
  return engine;
}

function createPrompt(workflow, targetLanguage, customPrompt = CUSTOM_PROMPT) {
  return createEngine(workflow).createPromptForWorkflow(
    targetLanguage,
    customPrompt,
    1,
    null,
    0,
    1
  );
}

test('configured translation guidance is composed into every workflow contract', () => {
  for (const [workflow, marker] of Object.entries(CONTRACT_MARKERS)) {
    const prompt = createPrompt(workflow, 'Hebrew');

    assert.match(prompt, /BATCH 1\/1/, `${workflow}: missing batch header`);
    assert.match(prompt, /CONFIGURED TRANSLATION GUIDANCE:/, `${workflow}: missing configured-guidance header`);
    assert.ok(prompt.includes(marker), `${workflow}: missing workflow contract marker`);
    assert.match(
      prompt,
      /WORKFLOW OUTPUT CONTRACT \(takes precedence over the guidance above\):/,
      `${workflow}: missing workflow-contract precedence header`
    );

    const guidanceIndex = prompt.indexOf('CONFIGURED TRANSLATION GUIDANCE:');
    const contractIndex = prompt.indexOf('WORKFLOW OUTPUT CONTRACT (takes precedence over the guidance above):');
    assert.ok(guidanceIndex < contractIndex, `${workflow}: configured guidance must precede the workflow contract`);

    assert.ok(!prompt.includes('{target_language}'), `${workflow}: unresolved {target_language} placeholder`);
  }
});

test('Hebrew targets receive gender consistency and no-niqqud rules', () => {
  const hebrewTargets = ['Hebrew', 'he-IL', 'iw'];
  for (const workflow of WORKFLOWS) {
    for (const target of hebrewTargets) {
      const prompt = createPrompt(workflow, target);

      assert.match(prompt, /HEBREW LOCALIZATION RULES:/, `${workflow}/${target}: missing Hebrew rules header`);
      assert.ok(
        prompt.includes('Maintain consistent character gender, pronouns, verb/adjective forms, and honorifics across the provided entries.'),
        `${workflow}/${target}: missing gender-consistency rule`
      );
      assert.ok(
        prompt.includes('Use natural contemporary Hebrew subtitle phrasing without niqqud (Hebrew vowel-point diacritics).'),
        `${workflow}/${target}: missing no-niqqud rule`
      );
      assert.match(prompt, /CONFIGURED TRANSLATION GUIDANCE:/, `${workflow}/${target}: missing configured-guidance header`);
    }
  }
});

test('Hebrew rules are not applied to other Hebrew-script or non-Hebrew targets', () => {
  const nonModernHebrewTargets = ['French', 'Yiddish', 'Ancient Hebrew'];
  for (const workflow of WORKFLOWS) {
    for (const target of nonModernHebrewTargets) {
      const prompt = createPrompt(workflow, target);
      assert.ok(
        !prompt.includes('HEBREW LOCALIZATION RULES:'),
        `${workflow}/${target}: Hebrew rules incorrectly applied`
      );
    }
  }
});

test('blank configured prompts preserve the existing non-Hebrew workflow prompt', () => {
  for (const workflow of WORKFLOWS) {
    const prompt = createPrompt(workflow, 'French', '   ');
    assert.ok(prompt.includes(CONTRACT_MARKERS[workflow]), `${workflow}: missing workflow marker`);
    assert.ok(!prompt.includes('CONFIGURED TRANSLATION GUIDANCE:'), `${workflow}: unexpected configured-guidance header`);
    assert.ok(
      !prompt.includes('WORKFLOW OUTPUT CONTRACT (takes precedence over the guidance above):'),
      `${workflow}: unexpected precedence header`
    );
  }
});
