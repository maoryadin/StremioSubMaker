const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getAllowedScripts,
  findForeignScripts,
  extractForeignRuns
} = require('./scriptIntegrity');

test('maps known target scripts and leaves unknown or ambiguous labels unchecked', () => {
  assert.deepEqual(getAllowedScripts('Hebrew'), ['hebrew']);
  assert.deepEqual(getAllowedScripts('he-IL'), ['hebrew']);
  assert.deepEqual(getAllowedScripts('yiddish'), ['hebrew']);
  assert.equal(getAllowedScripts('Klingon'), null);
  assert.equal(getAllowedScripts('Yi'), null);
});

test('flags introduced foreign scripts but preserves scripts already in source', () => {
  const allowed = getAllowedScripts('Hebrew');
  assert.deepEqual(findForeignScripts('I am the danger.', 'אני הסכנהن', allowed), ['arabic']);
  assert.deepEqual(findForeignScripts("I'm sorry.", 'אני מצטער שפал', allowed), ['cyrillic']);
  assert.deepEqual(findForeignScripts('The sign read مرحبا', 'השלט אמר مرحبا', allowed), []);
  assert.deepEqual(findForeignScripts('1.21 gigawatts?!', "1.21 ג'יגוואט?!", allowed), []);
  assert.deepEqual(findForeignScripts('The time is 12:30', 'השעה ١٢:٣٠؟', allowed), []);
  assert.deepEqual(extractForeignRuns('אני הסכנהن', ['arabic']), ['ن']);
});

