// Run: node --test tests/ai/
// Checks the Ask AI loop for both Claude and Gemini replies, with scripted model answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const SNAgent = require('../../renderer/ai-agent.js');

const base = {
  sectionId: 'sec1',
  sectionTitle: 'Rank',
  sectionPath: 'Matrices › Rank',
  sectionText: 'The rank counts the non-zero rows. Count them after elimination.',
  selection: 'The rank counts the non-zero rows.',
  question: 'Why does this work?',
  languageRule: 'Reply in English.',
  model: 'test-model'
};

// Replies the scripted model gives, one per call.
function scripted(provider, replies) {
  let i = 0;
  const bodies = [];
  const callApi = async (p, model, body) => {
    bodies.push(body);
    if (i >= replies.length) throw new Error('model asked too many times');
    return replies[i++];
  };
  return { callApi, bodies };
}

const claudeText = text => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const claudeTool = (name, input, id = 'tu1') => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const geminiText = text => ({ candidates: [{ content: { parts: [{ text }] } }] });
const geminiTool = (name, args) => ({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] });

test('Claude: answers only, no change', async () => {
  const s = scripted('anthropic', [claudeText('Because counting rows after elimination gives the rank.')]);
  const out = await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => ({ result: 'x' }) });
  assert.equal(out.text, 'Because counting rows after elimination gives the rank.');
  assert.deepEqual(out.edits, []);
  assert.equal(out.truncated, false);
});

test('Claude: one edit_part on the selected section is applied and reported', async () => {
  const s = scripted('anthropic', [
    claudeTool('edit_part', { section_id: 'sec1', find: 'The rank counts the non-zero rows.', replace: 'The rank is the number of independent rows.' }),
    claudeText('I made that sentence clearer.')
  ]);
  const applied = [];
  const out = await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async (name, args) => { applied.push([name, args]); return { result: 'Changed.', isError: false }; } });
  assert.equal(applied.length, 1);
  assert.equal(applied[0][0], 'edit_part');
  assert.equal(out.edits.length, 1);
  assert.equal(out.edits[0].sectionId, 'sec1');
  // The second request must carry the tool result back, marked as success.
  const second = s.bodies[1].messages.at(-1);
  assert.equal(second.role, 'user');
  assert.equal(second.content[0].type, 'tool_result');
  assert.equal(second.content[0].tool_use_id, 'tu1');
  assert.equal(second.content[0].is_error, undefined);
});

test('a change to another section is refused and never applied', async () => {
  const s = scripted('anthropic', [
    claudeTool('edit_part', { section_id: 'OTHER', find: 'x', replace: 'y' }),
    claudeText('Done.')
  ]);
  let calls = 0;
  const out = await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => { calls++; return { result: 'ok' }; } });
  assert.equal(calls, 0);
  assert.deepEqual(out.edits, []);
  const block = s.bodies[1].messages.at(-1).content[0];
  assert.equal(block.is_error, true);
  assert.match(block.content, /only read or change the selected section/);
});

test('an unknown tool is refused', async () => {
  const s = scripted('anthropic', [claudeTool('delete_section', { section_id: 'sec1' }), claudeText('ok')]);
  let calls = 0;
  await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => { calls++; return { result: 'ok' }; } });
  assert.equal(calls, 0);
  assert.equal(s.bodies[1].messages.at(-1).content[0].is_error, true);
});

test('a failed edit (passage not found) goes back to the model as an error and is not recorded', async () => {
  const s = scripted('anthropic', [
    claudeTool('edit_part', { section_id: 'sec1', find: 'not in the text', replace: 'z' }),
    claudeText('I could not find that passage.')
  ]);
  const out = await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => ({ result: 'That passage was not found.', isError: true }) });
  assert.deepEqual(out.edits, []);
  assert.equal(s.bodies[1].messages.at(-1).content[0].is_error, true);
  assert.equal(out.text, 'I could not find that passage.');
});

test('a thrown tool error is contained and reported, not raised', async () => {
  const s = scripted('anthropic', [claudeTool('read_section', { section_id: 'sec1' }), claudeText('Sorry.')]);
  const out = await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => { throw new Error('disk full'); } });
  assert.equal(out.text, 'Sorry.');
  assert.match(s.bodies[1].messages.at(-1).content[0].content, /disk full/);
});

test('the loop stops at the round limit, and the last round must answer without tools', async () => {
  const tools = Array.from({ length: SNAgent.MAX_ROUNDS - 1 }, (_, i) => claudeTool('read_section', { section_id: 'sec1' }, 't' + i));
  const s = scripted('anthropic', [...tools, claudeText('Here is the answer.')]);
  const out = await SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => ({ result: 'text' }) });
  assert.equal(out.text, 'Here is the answer.');
  assert.equal(s.bodies.length, SNAgent.MAX_ROUNDS);
  assert.deepEqual(s.bodies[SNAgent.MAX_ROUNDS - 1].tool_choice, { type: 'none' });
  assert.equal(s.bodies[0].tool_choice, undefined);
});

test('a model that still calls tools in the last round, with nothing to show, is an error', async () => {
  const endless = Array.from({ length: SNAgent.MAX_ROUNDS }, (_, i) => claudeTool('read_section', { section_id: 'sec1' }, 't' + i));
  const s = scripted('anthropic', endless);
  await assert.rejects(SNAgent.ask({ ...base, provider: 'anthropic', callApi: s.callApi, applyTool: async () => ({ result: 'text' }) }), err => err.code === 'empty');
});

test('an empty reply is an error with the reason, not a blank answer', async () => {
  const gem = scripted('gemini', [{ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }]);
  await assert.rejects(SNAgent.ask({ ...base, provider: 'gemini', callApi: gem.callApi, applyTool: async () => ({ result: '' }) }), err => err.code === 'empty' && /SAFETY/.test(err.message));
  const blocked = scripted('gemini', [{ promptFeedback: { blockReason: 'OTHER' } }]);
  await assert.rejects(SNAgent.ask({ ...base, provider: 'gemini', callApi: blocked.callApi, applyTool: async () => ({ result: '' }) }), err => err.code === 'empty' && /blocked/.test(err.message));
  const cla = scripted('anthropic', [{ content: [], stop_reason: 'refusal' }]);
  await assert.rejects(SNAgent.ask({ ...base, provider: 'anthropic', callApi: cla.callApi, applyTool: async () => ({ result: '' }) }), err => err.code === 'empty');
});

test('an answer cut off by the length limit is marked truncated', async () => {
  const cla = scripted('anthropic', [{ content: [{ type: 'text', text: 'Half an ans' }], stop_reason: 'max_tokens' }]);
  assert.equal((await SNAgent.ask({ ...base, provider: 'anthropic', callApi: cla.callApi, applyTool: async () => ({}) })).truncated, true);
  const gem = scripted('gemini', [{ candidates: [{ content: { parts: [{ text: 'Half' }] }, finishReason: 'MAX_TOKENS' }] }]);
  assert.equal((await SNAgent.ask({ ...base, provider: 'gemini', callApi: gem.callApi, applyTool: async () => ({}) })).truncated, true);
});

test('Gemini: thinking parts are not shown, and call ids are sent back with the results', async () => {
  const s = scripted('gemini', [
    { candidates: [{ content: { parts: [{ text: 'let me think', thought: true }, { functionCall: { id: 'fc-7', name: 'read_section', args: { section_id: 'sec1' } }, thoughtSignature: 'sig' }] } }] },
    { candidates: [{ content: { parts: [{ text: 'hidden', thought: true }, { text: 'The answer.' }] }, finishReason: 'STOP' }] }
  ]);
  const out = await SNAgent.ask({ ...base, provider: 'gemini', callApi: s.callApi, applyTool: async () => ({ result: 'text', isError: false }) });
  assert.equal(out.text, 'The answer.');
  const sent = s.bodies[1].contents;
  assert.equal(sent[1].parts[1].thoughtSignature, 'sig', 'the model turn goes back unchanged (Gemini needs its signature)');
  assert.equal(sent[2].parts[0].functionResponse.id, 'fc-7');
  assert.equal(s.bodies[0].generationConfig.maxOutputTokens, 8192);
});

test('the model call error is passed up (so the page can show the reason)', async () => {
  const out = SNAgent.ask({ ...base, provider: 'anthropic', callApi: async () => { const e = new Error('bad key'); e.code = 'bad_key'; throw e; }, applyTool: async () => ({ result: '' }) });
  await assert.rejects(out, err => err.code === 'bad_key');
});

test('Gemini: edit_part is applied on the selected section, and the reply comes back as a function response', async () => {
  const s = scripted('gemini', [
    geminiTool('edit_part', { section_id: 'sec1', find: 'counts the non-zero rows', replace: 'counts the independent rows' }),
    geminiText('Updated.')
  ]);
  const applied = [];
  const out = await SNAgent.ask({ ...base, provider: 'gemini', callApi: s.callApi, applyTool: async (n, a) => { applied.push(n); return { result: 'Changed.' }; } });
  assert.deepEqual(applied, ['edit_part']);
  assert.equal(out.text, 'Updated.');
  assert.equal(out.edits.length, 1);
  const fr = s.bodies[1].contents.at(-1).parts[0].functionResponse;
  assert.equal(fr.name, 'edit_part');
  assert.deepEqual(fr.response, { result: 'Changed.' });
});

test('Gemini: a refused change to another section is an error for the model', async () => {
  const s = scripted('gemini', [geminiTool('read_section', { section_id: 'NOPE' }), geminiText('ok')]);
  let calls = 0;
  await SNAgent.ask({ ...base, provider: 'gemini', callApi: s.callApi, applyTool: async () => { calls++; return { result: '' }; } });
  assert.equal(calls, 0);
  assert.ok(s.bodies[1].contents.at(-1).parts[0].functionResponse.response.error);
});

test('tool schemas use only the plain form both providers accept', () => {
  for (const t of SNAgent.TOOLS) {
    const json = JSON.stringify(t.parameters);
    assert.ok(!json.includes('additionalProperties'), t.name);
    assert.ok(Object.keys(t.parameters.properties).length > 0, t.name);
  }
});

test('an unknown provider is refused before anything is sent', async () => {
  await assert.rejects(SNAgent.ask({ ...base, provider: 'openai', callApi: async () => ({}), applyTool: async () => ({}) }), err => err.code === 'unknown_provider');
});
