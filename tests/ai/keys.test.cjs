// Run: node --test tests/ai/
// Checks the key store: encrypted, never sent back to the page, and sent only to the right provider.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { create, KeyError } = require('../../main/ai-keys.js');

const CLAUDE = 'sk-ant-api03-' + 'a'.repeat(30) + 'WXYZ';
const GEMINI = 'AIza' + 'b'.repeat(30) + 'QRST';

// A stand-in for Electron's safeStorage: "encrypts" by reversing, so the file never holds the plain key.
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: s => Buffer.from(String(s).split('').reverse().join(''), 'utf8'),
  decryptString: b => Buffer.from(b).toString('utf8').split('').reverse().join('')
});

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sn-keys-'));
  const sent = [];
  const fetchFn = opts.fetchFn || (async (url, init) => {
    sent.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
  });
  const keys = create({ dataDir: () => dir, safeStorage: opts.safe || fakeSafe(), fetchFn });
  return { keys, dir, sent };
}

test('saving a key shows only that it is saved and its last four characters', () => {
  const { keys } = setup();
  const s = keys.save('anthropic', CLAUDE);
  assert.equal(s.providers.anthropic.saved, true);
  assert.equal(s.providers.anthropic.last4, 'WXYZ');
  assert.equal(s.providers.gemini.saved, false);
  assert.ok(!JSON.stringify(s).includes(CLAUDE));
});

test('the key file never contains the plain key', () => {
  const { keys, dir } = setup();
  keys.save('anthropic', CLAUDE);
  const text = fs.readFileSync(path.join(dir, 'ai-keys.json'), 'utf8');
  assert.ok(!text.includes(CLAUDE));
  assert.ok(!text.includes(CLAUDE.split('').reverse().join('')));
});

test('no key is saved when this computer cannot encrypt', () => {
  const { keys, dir } = setup({ safe: fakeSafe(false) });
  assert.throws(() => keys.save('anthropic', CLAUDE), err => err.code === 'no_encryption');
  assert.equal(fs.existsSync(path.join(dir, 'ai-keys.json')), false);
});

test('Gemini keys in either Google format are accepted', () => {
  const { keys } = setup();
  const newer = 'AQ.' + 'c'.repeat(30) + 'ABCD';
  assert.equal(keys.save('gemini', newer).providers.gemini.last4, 'ABCD');
  assert.equal(keys.save('gemini', GEMINI).providers.gemini.last4, 'QRST');
  assert.throws(() => keys.save('gemini', 'AQ.short'), err => err.code === 'bad_format');
});

test('a key with the wrong shape is refused', () => {
  const { keys } = setup();
  assert.throws(() => keys.save('anthropic', GEMINI), err => err.code === 'bad_format');
  assert.throws(() => keys.save('gemini', CLAUDE), err => err.code === 'bad_format');
  assert.throws(() => keys.save('anthropic', 'hello'), err => err.code === 'bad_format');
});

test('an unknown provider is refused everywhere', () => {
  const { keys } = setup();
  assert.throws(() => keys.save('openai', CLAUDE), err => err.code === 'unknown_provider');
  assert.throws(() => keys.clear('openai'), err => err.code === 'unknown_provider');
});

test('clear removes one key and leaves the other', () => {
  const { keys } = setup();
  keys.save('anthropic', CLAUDE);
  keys.save('gemini', GEMINI);
  const s = keys.clear('anthropic');
  assert.equal(s.providers.anthropic.saved, false);
  assert.equal(s.providers.gemini.saved, true);
});

test('Claude requests carry the Claude key and go only to Anthropic', async () => {
  const { keys, sent } = setup();
  keys.save('anthropic', CLAUDE);
  const reply = await keys.forward('anthropic', 'claude-opus-5-5', { messages: [], max_tokens: 99999, stream: true });
  assert.deepEqual(reply, { ok: true });
  assert.equal(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent[0].init.headers['x-api-key'], CLAUDE);
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.stream, undefined);
});

test('Gemini requests carry the Gemini key and go only to Google', async () => {
  const { keys, sent } = setup();
  keys.save('gemini', GEMINI);
  await keys.forward('gemini', 'gemini-2.5-flash', { contents: [] });
  assert.equal(sent[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal(sent[0].init.headers['x-goog-api-key'], GEMINI);
  assert.equal(sent[0].init.headers['x-api-key'], undefined);
});

test('a request with no key saved is refused without any network call', async () => {
  const { keys, sent } = setup();
  await assert.rejects(keys.forward('anthropic', 'claude-opus-5-5', {}), err => err.code === 'no_key');
  assert.equal(sent.length, 0);
});

test('a bad model name or request body is refused', async () => {
  const { keys } = setup();
  keys.save('anthropic', CLAUDE);
  await assert.rejects(keys.forward('anthropic', '../../etc', {}), err => err.code === 'bad_model');
  await assert.rejects(keys.forward('anthropic', 'claude-opus-5-5', 'text'), err => err.code === 'bad_request');
});

test('API errors become plain codes the page can explain', async () => {
  const cases = [
    [401, 'bad_key'], [403, 'bad_key'], [429, 'rate_limited'],
    [400, 'no_credit'], [500, 'api_error']
  ];
  for (const [status, code] of cases) {
    const fetchFn = async () => ({ ok: false, status, text: async () => JSON.stringify({ error: { message: status === 400 ? 'Your credit balance is too low' : 'nope' } }) });
    const { keys } = setup({ fetchFn });
    keys.save('anthropic', CLAUDE);
    await assert.rejects(keys.forward('anthropic', 'claude-opus-5-5', {}), err => err instanceof KeyError && err.code === code, `status ${status}`);
  }
});

test('a network failure is reported as offline', async () => {
  const fetchFn = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
  const { keys } = setup({ fetchFn });
  keys.save('anthropic', CLAUDE);
  await assert.rejects(keys.forward('anthropic', 'claude-opus-5-5', {}), err => err.code === 'offline');
});
