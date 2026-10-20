# Study Notebook

The owner is Jeff, a HUJI Data Science and Economics student. He studies by talking with Claude (and Gemini).
They save the final explanations into this notebook, and the app turns them into organized, practicable notes.

## The three parts

- **Desktop app** (Electron, Windows and Mac): `main/` is the main process, `renderer/` is the page.
  The page is plain JS with no framework or bundler. `renderer/app.js` is most of the UI, and `main/preload.js` is the `window.desktop` bridge.
- **Online notebook and connector** (Cloudflare Worker, `cloud/`): https://study-notebook.wardjabaly82.workers.dev
  - Google sign-in, D1 database and KV storage.
  - The MCP server Claude and Gemini connect to, at `/mcp` (`cloud/src/mcp.js`), with OAuth through `@cloudflare/workers-oauth-provider`.
  - The website version of the app, built from `renderer/` by `scripts/build-web.js`.
- **Local connector** (`connector/`): the older MCP server that runs on the computer for the Claude desktop app.

### Shared code

`renderer/notebook-ops.js` does every notebook operation (save_section, edit_part, …). It is shared by the app, the connector and the cloud.
`connector/src/instructions.js` is what Claude and Gemini are told.
`scripts/sync-cloud.js` copies both files into `cloud/src/`. Edit the originals, never the copies in `cloud/src/`.

## How every change ships (the owner's standing rule: "anything I ask, change it in the app")

1. Make the change, and test it (see below).
2. Bump `version` in `package.json`.
3. Add an entry at the top of `renderer/whats-new.js`, in plain words, with both `en` and `he` lines. It appears in the app after updating, and as the GitHub release notes.
4. Commit and push to `main`. That starts:
   - **GitHub Actions** "Publish release" (`.github/workflows/release.yml`): builds the Windows and then the Mac app and publishes the release. It only runs when `package.json` changes.
   - **Cloudflare Workers Builds**: deploys `cloud/` on every push to `main`.
5. Check that both finished: `gh api repos/wardjabaly82-lab/study-notebook/commits/<sha>/check-runs`.

A change only to `cloud/` deploys on push without a version bump. Still add a what's-new line when users will notice it.

## Testing

- **Server:** `bash tests/cloud.sh` starts the Worker locally and runs `cloud/test/server-test.mjs`. It must end with `SHARED SERVER TEST PASSED`.
  - It needs `cloud/.dev.vars` containing `DEV_FAKE_GOOGLE=1`. That file is git-ignored, so create it on a new computer.
- **App:** `tests/app/*.mjs` launch the real Electron app with Playwright, using a throwaway profile, and print ✓/✗ lines ending in `ALL GOOD`.
  - Setup once: `npm install --no-save playwright-core`.
  - Run one: `node tests/app/step15.mjs`. On Linux without a screen, use `xvfb-run -a node …`.
  - Screenshots go to `tests/app/shots/`. Look at them.
  - Tests set `localStorage['sn-seen-version']='9.9.9'` so the What's new window doesn't get in the way.
  - The app opens on the Home ("Today") screen. Click a course (`.side .course`) to get into its notes.

## The owner's preferences

- Hebrew UI and notes with right-to-left layout. Every new UI string needs a Hebrew entry in `renderer/i18n.js`.
- Gemini support must never break Claude, and the other way round. Test both paths.
- Simple, plain-language messages in the app. No jargon.
- Don't edit his real notes without asking.

## Things that were learned the hard way

- **Gemini:**
  - Gemini's tool reader refuses JSON Schema extras and objects with empty `properties`, and when it refuses, it silently drops all the tools.
  - So Gemini gets a simplified copy of the tool list (`toolsFor(app)` in `cloud/src/mcp.js`). Claude gets the full schemas.
  - Gemini chats must start with `@Study Notebook`, Gemini asks the user to Allow every save, and it takes 1–2 minutes to connect on Google's side.
- **Diagnosing connections:** the site owner can open `/account?trace=1` to see the sign-in steps and every request Gemini made (method and tool names only, kept 2 days). Look there before guessing.
- **Highlights and drawings:**
  - Highlights are stored as quoted text plus surrounding context, not as positions. See `renderer/marks.js`, which also re-finds them nearby when the text changed a little.
  - When two copies of a section meet (app, sync, server), `keepMarks` merges marks by `marksAt`.
- **What changed:** when Claude or Gemini edits a section, `prevContent` keeps the previous text. The app compares the two and marks the new sentences (`SNMarks.changes`) until the student presses "Got it".
- **Per-notebook look:** font, zoom, page width, hidden panels and drawing tools are stored per course on each device, in `localStorage['sn-view:<courseId>']`.
- **Release:** the release workflow reads `renderer/whats-new.js` with Node, so keep it a plain `window.SNWhatsNew = [...]` array.
- **Network:** pushes from some networks fail with "remote end hung up". Retry once.
