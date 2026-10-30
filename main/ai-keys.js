'use strict';
// The student's own AI keys (Claude and Gemini), for the in-app AI.
// Keys are stored encrypted by the operating system (Electron safeStorage).
// If the system can't encrypt, nothing is saved: a key is never written in plain text.
// The page never gets a key back. It only learns whether one is saved.
// forward() adds the key to a request on its way out, so the key stays in this process.
const fs = require('fs');
const path = require('path');

const PROVIDERS = {
  anthropic: {
    label: 'Claude',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/,
    keyHint: 'sk-ant-…',
    keyUrl: 'https://platform.claude.com/settings/keys'
  },
  gemini: {
    label: 'Gemini',
    // Google issues two formats: the older "AIza…" keys and the newer "AQ.…" keys.
    keyPattern: /^(AIza|AQ\.)[A-Za-z0-9_.\-]{20,}$/,
    keyHint: 'AIza… or AQ.…',
    keyUrl: 'https://aistudio.google.com/app/apikey'
  }
};

const MODEL_PATTERN = /^[a-z0-9][a-z0-9.\-]{2,60}$/i;
const MAX_TOKENS_CAP = 4000;
const TIMEOUT_MS = 60000;

class KeyError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

function create({ dataDir, safeStorage, fetchFn = globalThis.fetch }) {
  const file = () => path.join(dataDir(), 'ai-keys.json');

  function readAll() {
    try { return JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch (e) { return {}; }
  }
  function writeAll(obj) {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = file() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file());
  }
  function checkProvider(provider) {
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) throw new KeyError('unknown_provider');
  }

  // What the page may see: whether a key is saved, and its last four characters.
  function status() {
    const saved = readAll();
    const out = {};
    for (const id of Object.keys(PROVIDERS)) {
      const entry = saved[id];
      out[id] = entry ? { saved: true, last4: entry.last4 || '' } : { saved: false };
    }
    return { encryptionAvailable: safeStorage.isEncryptionAvailable(), providers: out };
  }

  function save(provider, rawKey) {
    checkProvider(provider);
    if (!safeStorage.isEncryptionAvailable()) throw new KeyError('no_encryption');
    const key = String(rawKey || '').trim();
    if (!PROVIDERS[provider].keyPattern.test(key)) throw new KeyError('bad_format');
    const all = readAll();
    all[provider] = {
      sealed: safeStorage.encryptString(key).toString('base64'),
      last4: key.slice(-4),
      savedAt: Date.now()
    };
    writeAll(all);
    return status();
  }

  function clear(provider) {
    checkProvider(provider);
    const all = readAll();
    delete all[provider];
    writeAll(all);
    return status();
  }

  // Only used inside this process, never sent to the page.
  function keyFor(provider) {
    const entry = readAll()[provider];
    if (!entry || !entry.sealed) return '';
    try { return safeStorage.decryptString(Buffer.from(entry.sealed, 'base64')); } catch (e) { return ''; }
  }

  // Sends one request for the page: the key is added here and nowhere else.
  async function forward(provider, model, body) {
    checkProvider(provider);
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) throw new KeyError('bad_model');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new KeyError('bad_request');
    const key = keyFor(provider);
    if (!key) throw new KeyError('no_key');

    let url, headers;
    const payload = { ...body };
    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' };
      payload.model = model;
      payload.max_tokens = Math.min(Number(payload.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP);
      delete payload.stream;
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
      headers = { 'content-type': 'application/json', 'x-goog-api-key': key };
    }

    let res;
    try {
      res = await fetchFn(url, {
        method: 'POST', headers, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (e) {
      throw new KeyError('offline', e && e.message);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    if (res.ok && data) return data;

    const message = JSON.stringify((data && data.error) || text).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new KeyError('bad_key', message);
    if (res.status === 429) throw new KeyError('rate_limited', message);
    if (/credit|billing|quota/i.test(message)) throw new KeyError('no_credit', message);
    throw new KeyError('api_error', `${res.status} ${message}`);
  }

  return { status, save, clear, forward, PROVIDERS };
}

module.exports = { create, PROVIDERS, KeyError };
