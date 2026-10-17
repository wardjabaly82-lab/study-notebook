#!/usr/bin/env node
/* Study Notebook connector for the Claude desktop app (an MCP server).
   Claude calls these tools while you study, to keep your notebook up to date.
   - If the Study Notebook app is open, changes go to it directly and appear live.
   - If it's closed, changes are written safely to the notes file and appear
     the next time the app opens. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const Ops = require('../../renderer/notebook-ops.js');

const VERSION = '1.0.0';

/* ---------- where the app keeps its notes ---------- */

function dataDir() {
  if (process.env.STUDY_NOTEBOOK_DATA_DIR) return process.env.STUDY_NOTEBOOK_DATA_DIR;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Study Notebook');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Study Notebook');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Study Notebook');
}
// Must match linkPath() in the app (main/connector-link.js).
function linkPath(dir) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\study-notebook-' + crypto.createHash('sha1').update(dir.toLowerCase()).digest('hex').slice(0, 16);
  return path.join(dir, 'connector.sock');
}

const DIR = dataDir();
const DATA = path.join(DIR, 'notebook-data.json');
const LOCK = path.join(DIR, 'notebook-data.lock');
const DOC_PATH = /^data\/users\/local\/[A-Za-z0-9_-]{1,64}(\/(sections|sources|lectures|cards)\/[A-Za-z0-9_-]{1,64})?$/;

/* ---------- live mode: talk to the open app ---------- */

function readToken() { try { return fs.readFileSync(path.join(DIR, 'connector.token'), 'utf8').trim(); } catch (e) { return null; } }

// Resolves to the app's answer, or to null when the app isn't running.
function callApp(op, args) {
  const token = readToken();
  if (!token) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(linkPath(DIR));
    let buf = '', connected = false, done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(t); sock.destroy(); fn(v); };
    // 1.5 s to connect (otherwise the app isn't running), then 20 s for the answer.
    let t = setTimeout(() => finish(resolve, null), 1500);
    sock.on('connect', () => {
      connected = true;
      clearTimeout(t);
      t = setTimeout(() => finish(reject, new Error('The Study Notebook app didn’t answer in time.')), 20000);
      sock.write(JSON.stringify({ token, id: crypto.randomUUID(), op, args }) + '\n');
    });
    sock.on('data', d => {
      buf += d;
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let msg; try { msg = JSON.parse(buf.slice(0, i)); } catch (e) { return finish(reject, new Error('Unexpected reply from the app.')); }
      if (msg.ok) finish(resolve, { result: msg.result, live: true });
      else finish(reject, new Ops.OpError(msg.error || 'The app couldn’t do that.'));
    });
    sock.on('error', e => {
      // Not running (no socket / refused): fall back to the notes file.
      if (!connected && ['ENOENT', 'ECONNREFUSED', 'EPIPE', 'ENOTSOCK'].includes(e.code)) finish(resolve, null);
      else finish(reject, new Error('Couldn’t reach the Study Notebook app.'));
    });
  });
}

/* ---------- file mode: the app is closed ---------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withLock(fn) {
  fs.mkdirSync(DIR, { recursive: true });
  for (let i = 0; i < 60; i++) {
    try {
      const fd = fs.openSync(LOCK, 'wx');
      fs.writeSync(fd, String(process.pid)); fs.closeSync(fd);
      try { return await fn(); } finally { try { fs.unlinkSync(LOCK); } catch (e) {} }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 15000) fs.unlinkSync(LOCK); } catch (e2) {}
      await sleep(100);
    }
  }
  throw new Error('The notes file is busy. Try again in a moment.');
}

function readDocs() {
  for (const f of [DATA, DATA.replace(/\.json$/, '.previous.json')]) {
    try { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (d && d.docs && typeof d.docs === 'object') return d.docs; } catch (e) {}
  }
  return {};
}

function writeDocs(docs) {
  for (const [k, v] of Object.entries(docs)) if (!DOC_PATH.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Refusing to save notes in an unexpected format.');
  const text = JSON.stringify({ version: 1, savedAt: Date.now(), docs });
  if (fs.existsSync(DATA)) {
    // Update the existing file in place. When the Claude app runs this connector on
    // Windows, new files it creates in AppData can be redirected into the Claude app's
    // private storage, but changes to existing files reach the real file.
    try { fs.copyFileSync(DATA, DATA.replace(/\.json$/, '.previous.json')); } catch (e) {}
    const fd = fs.openSync(DATA, 'r+');
    try { const buf = Buffer.from(text, 'utf8'); fs.ftruncateSync(fd, 0); fs.writeSync(fd, buf, 0, buf.length, 0); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  } else {
    fs.writeFileSync(DATA, text, { encoding: 'utf8', mode: 0o600 });
  }
}

const READ_ONLY = new Set(['list_courses', 'get_outline', 'read_section', 'search_notes', 'list_lectures', 'read_lecture', 'get_practice_overview']);

async function runOnFile(op, args) {
  if (READ_ONLY.has(op)) return { result: Ops.run(readDocs(), op, args).result, live: false };
  return withLock(async () => {
    const docs = readDocs();
    const { result, writes } = Ops.run(docs, op, args);
    if (writes.length) {
      for (const w of writes) { if (w.data === null) delete docs[w.path]; else docs[w.path] = w.data; }
      writeDocs(docs);
    }
    return { result, live: false };
  });
}

async function perform(op, args) {
  const live = await callApp(op, args);
  return live || runOnFile(op, args);
}

/* ---------- MCP server ---------- */

const INSTRUCTIONS = `Study Notebook keeps the student's study notes, organized by course into topics and sub-topics. They study by talking with you; the notebook should end up holding the final, clear explanations, not the conversation.

While you help the student, keep their notebook up to date:
- When something has been understood (they say they get it, or they accept your final explanation), save that explanation with save_section. Also save whenever they ask ("save this", "add it to my notebook").
- Before saving, call get_outline for the course. If a section on that subject already exists, read it with read_section and update it with its section_id, keeping everything that is still correct, instead of adding a duplicate. A new sub-topic goes under its topic (parent_id); a new topic has no parent.
- If the student said they didn't understand an existing section, rewrite only that section, more simply.
- Notes must stand on their own for exam revision: a short definition, the explanation, formulas, a worked example where it fits, and common mistakes. Use Markdown; write math as \\( ... \\) inline and $$ ... $$ for display; never use # headings inside content (the title is the heading).
- Write in the course's notes language (Hebrew courses in Hebrew, keeping formulas in Latin form).
- If it's unclear which course, check list_courses or ask. If the course doesn't exist yet, offer to create it.
- After saving, tell the student in one short line what was saved and where.

Recorded lectures: the student can record a lecture in the Study Notebook app, which saves an automatic transcript to the course. When they ask you to make notes from a lecture ("make notes from today's lecture"):
- Call list_lectures, pick the lecture they mean (usually the newest without notes; ask if unclear), and read every part with read_lecture.
- The transcript is automatic speech-to-text with [mm:ss] times: fix recognition mistakes from context, turn spoken formulas into proper math, and leave out filler, jokes and course administration (unless it's about exams or homework, which you mention briefly).
- Check get_outline first and fit the lecture into the existing topics: add new sub-topics where they belong, and extend existing sections instead of duplicating them. Write complete notes, not a summary, as if the student missed the lecture.
- Pass lecture_id to every save_section call for that lecture, so the app shows which notes came from it.
- End each section made from a lecture with a source line linking to the moment it was taught, in exactly this form: *Source: [Lecture title, 12:30](#lec=LECTURE_ID@12:30)* (several moments can be listed). The student clicks it to jump to that point in the transcript.
- If part of the transcript is unclear, say which minute it was so the student can re-watch it.

Exam practice: the app lets the student practice flashcards, multiple-choice and open questions, with spaced repetition. When they ask for practice ("quiz me", "make flashcards for topic X", "prepare me for the exam"):
- Read the relevant notes first (get_outline, read_section), and call get_practice_overview to see what exists and where they make mistakes; focus new questions on weak topics and on topics without practice.
- Save with save_practice, linked to the topic's section_id. Mix kinds: flashcards for definitions and formulas, multiple_choice with plausible wrong choices (common mistakes), and open_question for proofs and calculations, with a full worked answer. Use the course's notes language and the same math format as notes.
- Questions must be answerable from the notes and match the level of a university exam in the course. Don't repeat existing questions.
- Then tell them in one line how many were added and that they can practice under Practice in the app.`;

const server = new McpServer({ name: 'study-notebook', version: VERSION }, { instructions: INSTRUCTIONS });

const courseArg = z.string().max(200).describe('The course: its name, its course number (e.g. 52324), or its course_id. Can be left out if there is only one course.').optional();
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

function respond(op, out) {
  const where = out.live ? 'The Study Notebook app is open and shows this change now.' : 'The Study Notebook app is closed; this will show the next time it opens.';
  const text = JSON.stringify(out.result, null, 2) + (READ_ONLY.has(op) ? '' : '\n\n' + where);
  return { content: [{ type: 'text', text }] };
}
function fail(e) {
  const msg = e instanceof Ops.OpError ? e.message : (e && e.message) || 'Something went wrong.';
  return { content: [{ type: 'text', text: msg }], isError: true };
}
function tool(name, config, toArgs) {
  server.registerTool(name, config, async input => {
    try { return respond(name, await perform(name, toArgs ? toArgs(input) : input)); }
    catch (e) { return fail(e); }
  });
}

tool('list_courses', {
  title: 'List courses',
  description: 'List the student’s courses with their notes language and number of sections.',
  inputSchema: {}, annotations: RO
});

tool('get_outline', {
  title: 'Get a course outline',
  description: 'Show a course’s notebook as a tree of sections (ids, titles, short previews). Call this before saving, to find where new notes belong and whether a section on the subject already exists.',
  inputSchema: { course: courseArg }, annotations: RO
});

tool('read_section', {
  title: 'Read a section',
  description: 'Read the full content of one notebook section, e.g. before updating it.',
  inputSchema: { course: courseArg, section_id: z.string().max(64).describe('The section id from get_outline or search_notes.') }, annotations: RO
});

tool('search_notes', {
  title: 'Search notes',
  description: 'Find notebook sections whose title or content contains some text, in one course or all courses.',
  inputSchema: { query: z.string().min(2).max(200).describe('Words to look for.'), course: courseArg }, annotations: RO
});

tool('save_section', {
  title: 'Save to notebook',
  description: 'Save a final, clear explanation to the notebook. Without section_id it adds a new section (a topic, or a sub-topic when parent_id is given); with section_id it replaces that section’s content (the previous version is kept for undo in the app). Content is Markdown with \\( \\) and $$ $$ math, no # headings.',
  inputSchema: {
    course: courseArg,
    title: z.string().min(1).max(200).describe('Section title, short and specific, in the course’s notes language.'),
    content: z.string().min(1).max(200000).describe('The complete explanation in Markdown.'),
    section_id: z.string().max(64).optional().describe('Set this to update an existing section instead of adding one.'),
    parent_id: z.string().max(64).optional().describe('For a new sub-topic: the id of the topic it belongs under.'),
    lecture_id: z.string().max(64).optional().describe('When these notes come from a recorded lecture: its lecture_id.')
  },
  annotations: WRITE
});

tool('list_lectures', {
  title: 'List recorded lectures',
  description: 'List the lectures recorded in a course (newest first): title, date, length, spoken language, whether notes were already made, and how many parts the transcript has.',
  inputSchema: { course: courseArg }, annotations: RO
});

tool('read_lecture', {
  title: 'Read a lecture transcript',
  description: 'Read one part of a recorded lecture’s automatic transcript. Long lectures have several parts; read them all before writing notes.',
  inputSchema: {
    course: courseArg,
    lecture_id: z.string().max(64).describe('The lecture id from list_lectures.'),
    part: z.number().int().min(1).max(1000).optional().describe('Which part to read, starting at 1.')
  },
  annotations: RO
});

tool('save_practice', {
  title: 'Save practice questions',
  description: 'Save flashcards, multiple-choice questions and open questions for exam practice in the app, optionally linked to a topic section. Duplicates of existing questions are skipped.',
  inputSchema: {
    course: courseArg,
    topic_section_id: z.string().max(64).optional().describe('The topic or sub-topic section these questions practice.'),
    items: z.array(z.object({
      kind: z.enum(['flashcard', 'multiple_choice', 'open_question']),
      question: z.string().min(1).max(4000).describe('Front of the card or the question (Markdown and math allowed).'),
      answer: z.string().min(1).max(8000).describe('Back of the card, the correct answer, or a full worked solution.'),
      choices: z.array(z.string().max(1000)).min(2).max(6).optional().describe('multiple_choice only: the options.'),
      correct_choice: z.number().int().min(1).max(6).optional().describe('multiple_choice only: number of the right option, starting at 1.'),
      explanation: z.string().max(6000).optional().describe('Why the answer is right and the common mistake behind wrong choices.')
    })).min(1).max(60)
  },
  annotations: WRITE
});

tool('get_practice_overview', {
  title: 'Practice results',
  description: 'How the student is doing in practice: number of items, how many are due, accuracy per topic, the questions they get wrong most, and topics with no practice yet.',
  inputSchema: { course: courseArg }, annotations: RO
});

tool('create_course', {
  title: 'Create a course',
  description: 'Create a new course notebook.',
  inputSchema: {
    name: z.string().min(1).max(80).describe('Course name, e.g. "52324 - Probability for Statistics students".'),
    notes_language: z.enum(['Hebrew', 'English', 'Same as the material']).optional().describe('Language to write this course’s notes in.')
  },
  annotations: WRITE
});

(async () => {
  await server.connect(new StdioServerTransport());
  // Tell the Study Notebook app (if it's open) that the Claude app is connected.
  callApp('ping', {}).catch(() => {});
})().catch(e => { process.stderr.write('Study Notebook connector failed to start: ' + (e && e.message) + '\n'); process.exit(1); });
