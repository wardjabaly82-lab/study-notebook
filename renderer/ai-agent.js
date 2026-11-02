/* The in-app AI for one selected passage (Ask AI).
   The student selects text, presses Ask AI, and the model answers and may
   rewrite that one passage. This file is pure logic: the page supplies the
   request sender (callApi) and the notebook change (applyTool), so it runs
   the same in the app and in tests.

   Guarantees enforced here, whatever the model says:
   - Only the selected section can be read or changed.
   - At most MAX_ROUNDS model calls per question.
   - Tool errors go back to the model as errors, never as silent changes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SNAgent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_ROUNDS = 4;
  // Gemini counts its thinking in this limit too, so it gets more room or answers come back cut or empty.
  const MAX_OUTPUT_TOKENS = { anthropic: 4000, gemini: 8192 };

  class AgentError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }

  // One schema, written in the plain form both providers accept:
  // no additionalProperties, no empty properties (CLAUDE.md, Gemini notes).
  const TOOLS = [
    {
      name: 'read_section',
      description: 'Read the full text of the section the student selected.',
      parameters: {
        type: 'object',
        properties: { section_id: { type: 'string', description: 'The id of the selected section.' } },
        required: ['section_id']
      }
    },
    {
      name: 'edit_part',
      description: 'Replace one passage of the selected section with a clearer or deeper version. The passage must be copied exactly from the section text and must appear only once in it.',
      parameters: {
        type: 'object',
        properties: {
          section_id: { type: 'string', description: 'The id of the selected section.' },
          find: { type: 'string', description: 'The exact passage to replace, copied from the section.' },
          replace: { type: 'string', description: 'The new passage, in Markdown with \\( \\) and $$ $$ math.' }
        },
        required: ['section_id', 'find', 'replace']
      }
    }
  ];

  // Each provider adapter knows only its own message shapes.
  const ADAPTERS = {
    anthropic: {
      body(model, system, messages, lastRound) {
        const body = {
          model,
          max_tokens: MAX_OUTPUT_TOKENS.anthropic,
          system,
          messages,
          tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }))
        };
        if (lastRound) body.tool_choice = { type: 'none' };
        return body;
      },
      userMessage(text) { return { role: 'user', content: text }; },
      read(json) {
        const blocks = Array.isArray(json.content) ? json.content : [];
        const calls = blocks.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} }));
        const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
        const stop = json.stop_reason || '';
        return { text, calls, cut: stop === 'max_tokens', why: stop === 'refusal' ? 'refused' : stop };
      },
      assistant(json) { return { role: 'assistant', content: json.content }; },
      results(calls, outcomes) {
        return {
          role: 'user',
          content: calls.map((c, i) => {
            const o = outcomes[i];
            const block = { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(o.result) };
            if (o.isError) block.is_error = true;
            return block;
          })
        };
      }
    },
    gemini: {
      body(model, system, messages, lastRound) {
        const body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages,
          tools: [{ functionDeclarations: TOOLS }],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS.gemini }
        };
        if (lastRound) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
        return body;
      },
      userMessage(text) { return { role: 'user', parts: [{ text }] }; },
      read(json) {
        const cand = Array.isArray(json.candidates) ? json.candidates[0] : null;
        const parts = (cand && cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
        // Parts marked thought are the model thinking to itself, not the answer.
        const text = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
        const calls = parts.filter(p => p.functionCall).map((p, i) => ({ id: p.functionCall.id || 'g' + i, googleId: p.functionCall.id, name: p.functionCall.name, args: p.functionCall.args || {} }));
        const finish = (cand && cand.finishReason) || '';
        const blocked = json.promptFeedback && json.promptFeedback.blockReason;
        return { text, calls, cut: finish === 'MAX_TOKENS', why: blocked ? 'blocked: ' + blocked : finish };
      },
      assistant(json) {
        const cand = json.candidates[0];
        return { role: 'model', parts: cand.content.parts };
      },
      results(calls, outcomes) {
        return {
          role: 'user',
          parts: calls.map((c, i) => {
            const o = outcomes[i];
            const fr = { name: c.name, response: o.isError ? { error: o.result } : { result: o.result } };
            if (c.googleId) fr.id = c.googleId;
            return { functionResponse: fr };
          })
        };
      }
    }
  };

  function systemPrompt({ sectionTitle, sectionPath, languageRule }) {
    return [
      'You are a patient university tutor. The student selected one passage in their study notebook and asked about it.',
      'Answer the question clearly and completely, step by step, with a small example when it helps.',
      `The selected section is "${sectionTitle}" (${sectionPath}). Its id is given in the message.`,
      'Change the notebook only if the student needs the passage explained better: then call edit_part once, with the exact passage as find and the clearer version as replace. Leave everything else in the section as it is.',
      'Never change other sections. Math: \\( ... \\) inline and $$ ... $$ for display. No # headings.',
      languageRule || 'Reply in the language the student wrote in.'
    ].join('\n');
  }

  // Runs one question. Returns { text, edits, truncated }.
  //   provider, model, sectionId, sectionTitle, sectionPath, sectionText,
  //   selection, question, languageRule
  //   callApi(provider, model, body) -> the provider's JSON reply (throws on failure)
  //   applyTool(name, args) -> { result, isError }   (the page's notebook operation)
  async function ask(opts) {
    const adapter = ADAPTERS[opts.provider];
    if (!adapter) throw new AgentError('unknown_provider');
    if (typeof opts.callApi !== 'function' || typeof opts.applyTool !== 'function') throw new AgentError('bad_setup');

    const system = systemPrompt(opts);
    const intro = [
      `Section id: ${opts.sectionId}`,
      `Full section text:\n${opts.sectionText || ''}`,
      `Selected passage:\n${opts.selection || ''}`,
      `Question: ${opts.question || 'Explain the selected passage.'}`
    ].join('\n\n');
    const messages = [adapter.userMessage(intro)];
    const edits = [];

    const runOne = async call => {
      if (!TOOLS.some(t => t.name === call.name)) return { result: 'Unknown tool.', isError: true };
      if (String((call.args && call.args.section_id) || '') !== String(opts.sectionId)) {
        return { result: 'You can only read or change the selected section.', isError: true };
      }
      try {
        const out = await opts.applyTool(call.name, call.args);
        if (call.name === 'edit_part' && !out.isError) edits.push({ sectionId: opts.sectionId, find: call.args.find, replace: call.args.replace });
        return out;
      } catch (e) {
        return { result: (e && e.message) || 'That did not work.', isError: true };
      }
    };

    // An answer with no words and no change would look like nothing happened, so it is an error the page explains.
    const finish = (text, reply, truncated) => {
      if (!text.trim() && !edits.length) throw new AgentError('empty', reply.why || 'no answer');
      return { text: text.trim(), edits, truncated };
    };

    let text = '', reply = {};
    for (let round = 0; round < MAX_ROUNDS; round++) {
      // The last round may not use tools, so the model always ends with an answer.
      const lastRound = round === MAX_ROUNDS - 1;
      const json = await opts.callApi(opts.provider, opts.model, adapter.body(opts.model, system, messages, lastRound));
      reply = adapter.read(json || {});
      if (reply.text) text = reply.text;
      if (!reply.calls.length || lastRound) return finish(text, reply, !!reply.cut || (lastRound && reply.calls.length > 0));
      messages.push(adapter.assistant(json));
      const outcomes = [];
      for (const call of reply.calls) outcomes.push(await runOne(call));
      messages.push(adapter.results(reply.calls, outcomes));
    }
    return finish(text, reply, true);
  }

  return { ask, TOOLS, AgentError, MAX_ROUNDS };
});
