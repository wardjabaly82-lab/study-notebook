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

const BASES = { anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com' };

// baseUrls is only for the app tests, which point the requests at a local stand-in.
function create({ dataDir, safeStorage, fetchFn = globalThis.fetch, baseUrls = null, onModelChange = () => {} }) {
  const bases = { ...BASES, ...(baseUrls || {}) };
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

  function headersFor(provider, key) {
    return provider === 'anthropic'
      ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : { 'content-type': 'application/json', 'x-goog-api-key': key };
  }

  async function send(url, init) {
    let res;
    try {
      res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new KeyError('offline', e && e.message);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }
    return { res, text, data };
  }

  function failure(res, data, text) {
    const message = JSON.stringify((data && data.error) || text).slice(0, 300);
    // Google answers a wrong key with 400 (API_KEY_INVALID) as well as 401/403.
    if (res.status === 401 || res.status === 403 || /API key not valid|API_KEY_INVALID|ACCESS_TOKEN_TYPE_UNSUPPORTED/.test(message)) {
      return new KeyError('bad_key', message);
    }
    if (res.status === 429) return new KeyError('rate_limited', message);
    if (/credit balance|billing/i.test(message)) return new KeyError('no_credit', message);
    if (res.status === 404 && /model/i.test(message)) return new KeyError('model_gone', message);
    return new KeyError('api_error', `${res.status} ${message}`);
  }

  // The model the page asked for, or the replacement found when that one was retired.
  function modelFor(provider, model) {
    const swap = (readAll().models || {})[provider];
    return swap && swap.from === model && MODEL_PATTERN.test(swap.to) ? swap.to : model;
  }
  function rememberModel(provider, from, to) {
    const all = readAll();
    all.models = { ...(all.models || {}), [provider]: { from, to, at: Date.now() } };
    writeAll(all);
  }

  // When a company retires a model, ask it which models this key can use and pick
  // the closest one: the model its error message names, or the newest of the same family.
  async function replacementFor(provider, key, gone, errorMessage) {
    const named = /use (?:models\/)?([a-z0-9][a-z0-9.\-]{2,60})/i.exec(errorMessage || '');
    const url = provider === 'anthropic'
      ? `${bases.anthropic}/v1/models?limit=100`
      : `${bases.gemini}/v1beta/models?pageSize=200`;
    const { res, data } = await send(url, { method: 'GET', headers: headersFor(provider, key) });
    if (!res.ok || !data) return named ? named[1] : '';
    let ids;
    if (provider === 'anthropic') {
      ids = (data.data || []).map(m => m.id); // newest first
    } else {
      ids = (data.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name || '').replace(/^models\//, ''))
        .filter(id => /^gemini-/.test(id) && !/(embedding|image|tts|audio|live|vision)/.test(id));
      const ver = id => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [])[1] || 0);
      const preview = id => /preview|exp/.test(id) ? 1 : 0;
      ids.sort((a, b) => preview(a) - preview(b) || ver(b) - ver(a) || a.length - b.length);
    }
    ids = ids.filter(id => id !== gone && MODEL_PATTERN.test(id));
    if (named && ids.includes(named[1])) return named[1];
    const family = (/(opus|sonnet|haiku|flash-lite|flash|pro)/.exec(gone) || [])[1];
    const same = family ? ids.filter(id => id.includes(family) && (family !== 'flash' || !id.includes('flash-lite'))) : [];
    return same[0] || ids[0] || (named ? named[1] : '');
  }

  // Sends one request for the page: the key is added here and nowhere else.
  async function forward(provider, model, body) {
    checkProvider(provider);
    if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) throw new KeyError('bad_model');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new KeyError('bad_request');
    const key = keyFor(provider);
    if (!key) throw new KeyError('no_key');

    const attempt = async useModel => {
      let url;
      const payload = { ...body };
      if (provider === 'anthropic') {
        url = `${bases.anthropic}/v1/messages`;
        payload.model = useModel;
        payload.max_tokens = Math.min(Number(payload.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP);
        delete payload.stream;
      } else {
        url = `${bases.gemini}/v1beta/models/${encodeURIComponent(useModel)}:generateContent`;
      }
      const { res, data, text } = await send(url, { method: 'POST', headers: headersFor(provider, key), body: JSON.stringify(payload) });
      if (res.ok && data) return data;
      throw failure(res, data, text);
    };

    const first = modelFor(provider, model);
    try {
      return await attempt(first);
    } catch (e) {
      if (e.code !== 'model_gone') throw e;
      const next = await replacementFor(provider, key, first, e.message);
      if (!next || next === first) throw new KeyError('api_error', `404 ${e.message}`);
      const data = await attempt(next);
      rememberModel(provider, model, next);
      onModelChange(provider, first, next);
      return data;
    }
  }

  return { status, save, clear, forward, PROVIDERS };
}

module.exports = { create, PROVIDERS, KeyError };
