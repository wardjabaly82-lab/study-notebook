// Run: node --test tests/ai/log.test.cjs
// The app log must never contain a key, in either Google format or Claude's.
const test = require('node:test');
const assert = require('node:assert/strict');
const { redact } = require('../../main/log.js');

test('Gemini keys in both formats are hidden', () => {
  const aiza = 'AIza' + 'b'.repeat(30);
  const aq = 'AQ.' + 'c'.repeat(30);
  assert.ok(!redact('key ' + aiza).includes('bbbb'));
  assert.ok(!redact('key ' + aq).includes('cccc'));
  assert.equal(redact('key ' + aq), 'key AQ.[hidden]');
});

test('Claude keys and request headers are hidden', () => {
  const claude = 'sk-ant-api03-' + 'a'.repeat(30);
  assert.ok(!redact(claude).includes('aaaa'));
  assert.ok(!redact('x-api-key: ' + claude).includes('aaaa'));
});
