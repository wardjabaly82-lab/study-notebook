/* What Claude talks to: the notebook tools, for the student who connected Claude. */
import Ops from './notebook-ops.js';
import { INSTRUCTIONS } from './instructions.js';
import { loadDocs, writeDocs, userById, usage, QUOTA_BYTES } from './store.js';

export const VERSION = '2.0.0';

const course = { type: 'string', maxLength: 200, description: 'The course: its name, its course number (e.g. 52324), or its course_id. Can be left out if there is only one course.' };
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const TOOLS = [
  { name: 'list_courses', title: 'List courses', description: 'List the student’s courses with their notes language and number of sections.', inputSchema: obj({}), annotations: RO },
  { name: 'get_outline', title: 'Get a course outline', description: 'Show a course’s notebook as a tree of sections (ids, titles, short previews). Call this before saving, to find where new notes belong and whether a section on the subject already exists.', inputSchema: obj({ course }), annotations: RO },
  { name: 'read_section', title: 'Read a section', description: 'Read the full content of one notebook section, e.g. before updating it.', inputSchema: obj({ course, section_id: { type: 'string', maxLength: 64, description: 'The section id from get_outline or search_notes.' } }, ['section_id']), annotations: RO },
  { name: 'search_notes', title: 'Search notes', description: 'Find notebook sections whose title or content contains some text, in one course or all courses.', inputSchema: obj({ query: { type: 'string', minLength: 2, maxLength: 200, description: 'Words to look for.' }, course }, ['query']), annotations: RO },
  { name: 'save_section', title: 'Save to notebook', description: 'Save a final, clear explanation to the notebook. Without section_id it adds a new section (a topic, or a sub-topic when parent_id is given); with section_id it replaces that section’s content (the previous version is kept for undo in the app). Content is Markdown with \\( \\) and $$ $$ math, no # headings.',
    inputSchema: obj({ course, title: { type: 'string', minLength: 1, maxLength: 200, description: 'Section title, short and specific, in the course’s notes language.' }, content: { type: 'string', minLength: 1, maxLength: 200000, description: 'The complete explanation in Markdown. Whenever the idea can be drawn (a curve, a relationship, a process, a cycle, a comparison, a classification), include a ```plot graph or ```mermaid diagram right after the paragraph it illustrates, without being asked (see the server instructions), ==highlights== and > [!tip] callout boxes.' }, section_id: { type: 'string', maxLength: 64, description: 'Set this to update an existing section instead of adding one.' }, parent_id: { type: 'string', maxLength: 64, description: 'For a new sub-topic: the id of the topic it belongs under.' }, lecture_id: { type: 'string', maxLength: 64, description: 'When these notes come from a recorded lecture: its lecture_id.' } }, ['title', 'content']), annotations: WRITE },
  { name: 'save_sections', title: 'Save several sections at once', description: 'Save many final explanations in one call, e.g. all the notes from a PDF, slides or a lecture. Each item is like save_section. To put an item under another item of the same list, set "under" to that item’s number (1 = the first item). Faster than calling save_section many times.',
    inputSchema: obj({ course, sections: { type: 'array', minItems: 1, maxItems: 40, items: obj({ title: { type: 'string', minLength: 1, maxLength: 200, description: 'Section title, short and specific, in the course’s notes language.' }, content: { type: 'string', minLength: 1, maxLength: 200000, description: 'The complete explanation in Markdown. Whenever the idea can be drawn (a curve, a relationship, a process, a cycle, a comparison, a classification), include a ```plot graph or ```mermaid diagram right after the paragraph it illustrates, without being asked (see the server instructions), ==highlights== and > [!tip] callout boxes.' }, section_id: { type: 'string', maxLength: 64, description: 'Set this to update an existing section instead of adding one.' }, parent_id: { type: 'string', maxLength: 64, description: 'An existing section to put this one under.' }, under: { type: 'integer', minimum: 1, maximum: 40, description: 'Put this one under an earlier item of this list: its number, starting at 1.' }, lecture_id: { type: 'string', maxLength: 64, description: 'When these notes come from a recorded lecture: its lecture_id.' } }, ['title', 'content']) } }, ['sections']), annotations: WRITE },
  { name: 'edit_part', title: 'Change or extend one part of a section', description: 'Change one passage inside a saved section, leaving the rest of the section exactly as it is. Use it when the student asks about one part of an explanation. To add the answer to a follow-up question the notes don’t cover yet (e.g. what the letters in a formula mean), use that passage as find and the same passage followed by the new explanation as replace. To go deeper or make it clearer, or to fix a mistake, replace the passage with the better version. Copy the passage from read_section exactly (it must appear once). The previous version is kept for undo in the app.',
    inputSchema: obj({ course, section_id: { type: 'string', maxLength: 64, description: 'The section that contains the passage.' }, find: { type: 'string', minLength: 1, maxLength: 20000, description: 'The exact passage to change, copied from read_section (a sentence, paragraph, step or formula).' }, replace: { type: 'string', minLength: 1, maxLength: 60000, description: 'The new text for that passage: the passage plus an added explanation, or a deeper, clearer or corrected version. Markdown with \\( \\) and $$ $$ math.' } }, ['section_id', 'find', 'replace']), annotations: WRITE },
  { name: 'list_lectures', title: 'List recorded lectures', description: 'List the lectures recorded in a course (newest first): title, date, length, spoken language, whether notes were already made, and how many parts the transcript has.', inputSchema: obj({ course }), annotations: RO },
  { name: 'read_lecture', title: 'Read a lecture transcript', description: 'Read one part of a recorded lecture’s automatic transcript. Long lectures have several parts; read them all before writing notes.', inputSchema: obj({ course, lecture_id: { type: 'string', maxLength: 64, description: 'The lecture id from list_lectures.' }, part: { type: 'integer', minimum: 1, maximum: 1000, description: 'Which part to read, starting at 1.' } }, ['lecture_id']), annotations: RO },
  { name: 'save_practice', title: 'Save practice questions', description: 'Save flashcards, multiple-choice questions and open questions for exam practice in the app, optionally linked to a topic section. Duplicates of existing questions are skipped.',
    inputSchema: obj({ course, topic_section_id: { type: 'string', maxLength: 64, description: 'The topic or sub-topic section these questions practice.' },
      items: { type: 'array', minItems: 1, maxItems: 60, items: obj({ kind: { type: 'string', enum: ['flashcard', 'multiple_choice', 'open_question'] }, question: { type: 'string', minLength: 1, maxLength: 4000, description: 'Front of the card or the question (Markdown and math allowed).' }, answer: { type: 'string', minLength: 1, maxLength: 8000, description: 'Back of the card, the correct answer, or a full worked solution.' }, choices: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', maxLength: 1000 }, description: 'multiple_choice only: the options.' }, correct_choice: { type: 'integer', minimum: 1, maximum: 6, description: 'multiple_choice only: number of the right option, starting at 1.' }, explanation: { type: 'string', maxLength: 6000, description: 'Why the answer is right and the common mistake behind wrong choices.' } }, ['kind', 'question', 'answer']) } }, ['items']), annotations: WRITE },
  { name: 'get_practice_overview', title: 'Practice results', description: 'How the student is doing in practice: number of items, how many are due, accuracy per topic, the questions they get wrong most, and topics with no practice yet.', inputSchema: obj({ course }), annotations: RO },
  { name: 'create_course', title: 'Create a course', description: 'Create a new course notebook.', inputSchema: obj({ name: { type: 'string', minLength: 1, maxLength: 80, description: 'Course name, e.g. "52324 - Probability for Statistics students".' }, notes_language: { type: 'string', enum: ['Hebrew', 'English', 'Same as the material'], description: 'Language to write this course’s notes in.' } }, ['name']), annotations: WRITE }
];
const READ_ONLY = new Set(TOOLS.filter(t => t.annotations.readOnlyHint).map(t => t.name));
const ONLINE_NOTE = 'Saved in the student’s Study Notebook. It shows on the website right away, and in the app on their computer within a minute if it is open.';

async function callTool(env, uid, name, args) {
  if (!TOOLS.some(t => t.name === name)) return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
  try {
    // Lectures are loaded only when this request is about one (they can be large).
    const aboutLecture = name === 'list_lectures' || name === 'read_lecture' || /"lecture_id"\s*:\s*"[^"]/.test(JSON.stringify(args || {}));
    const docs = await loadDocs(env, uid, { skipLarge: !aboutLecture });
    const { result, writes } = Ops.run(docs, name, args || {});
    if (writes && writes.length) {
      const adding = writes.reduce((n, w) => n + (w.data ? JSON.stringify(w.data).length : 0), 0);
      if ((await usage(env, uid)).bytes + adding > QUOTA_BYTES) return { content: [{ type: 'text', text: 'The student’s notebook is full (15 MB). Nothing was saved; ask them to delete old recordings or courses.' }], isError: true };
      await writeDocs(env, uid, writes);
    }
    const text = JSON.stringify(result, null, 2) + (READ_ONLY.has(name) ? '' : '\n\n' + ONLINE_NOTE);
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    const msg = e && e.name === 'OpError' ? e.message : 'Something went wrong while using the notebook.';
    if (!(e && e.name === 'OpError')) console.error('tool failed', name, e && e.stack);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

const PROTOCOLS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
async function rpc(env, uid, msg) {
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Invalid request');
  if (msg.id === undefined) return null;   // a notification: nothing to answer
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params && msg.params.protocolVersion;
      return reply({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[2], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'study-notebook', title: 'Study Notebook', version: VERSION }, instructions: INSTRUCTIONS });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: TOOLS });
    case 'tools/call': return reply(await callTool(env, uid, msg.params && msg.params.name, msg.params && msg.params.arguments));
    case 'resources/list': return reply({ resources: [] });
    case 'prompts/list': return reply({ prompts: [] });
    default: return fail(-32601, `Method not found: ${msg.method}`);
  }
}

export const McpHandler = {
  async fetch(request, env, ctx) {
    const uid = ctx && ctx.props && ctx.props.uid;
    if (!uid || !(await userById(env, uid))) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'This Study Notebook account no longer exists. Connect again.' } }, { status: 401, headers: { 'WWW-Authenticate': 'Bearer error="invalid_token"' } });
    if (request.method !== 'POST') return new Response('Use POST for MCP requests.', { status: 405, headers: { Allow: 'POST' } });
    let body; try { body = await request.json(); } catch (e) { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }); }
    const batch = Array.isArray(body);
    const out = (await Promise.all((batch ? body : [body]).map(m => rpc(env, uid, m)))).filter(Boolean);
    if (!out.length) return new Response(null, { status: 202 });
    return Response.json(batch ? out : out[0], { headers: { 'Cache-Control': 'no-store' } });
  }
};

