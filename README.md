# Study Notebook

Study by talking with Claude in the Claude app. Study Notebook keeps the result: complete, organized notes for every course, split into topics and sub-topics, that Claude updates as you understand things. You read, edit, search and print them here.

- No account and no password. Your notes are saved on your own computer.
- Works with Hebrew and English notes, including math formulas.
- Records lectures playing on your computer (Hebrew, English, Arabic) and transcribes them privately; Claude turns them into notes.
- Exam practice: Claude writes flashcards, multiple-choice and open questions from your notes; you practice them here with spaced repetition and see your weak topics.
- English or Hebrew interface; light and dark mode.
- Search all courses at once (Ctrl+K): notes, lecture transcripts and practice questions.

---

## For students: install and set up

### 1. Download
- **Windows:** `Study-Notebook-Setup-x.y.z.exe`
- **Mac with an M1/M2/M3/M4 chip:** `Study-Notebook-x.y.z-arm64.dmg`
- **Older Intel Mac:** `Study-Notebook-x.y.z-x64.dmg`

### 2. Open it the first time
The app isn't signed with a paid developer certificate yet, so your computer warns you once.

- **Windows:** if you see "Windows protected your PC", click **More info**, then **Run anyway**.
- **Mac:** open the .dmg and drag Study Notebook into Applications. Open it once (macOS blocks it), then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.

### 3. Connect it to the Claude app
You need the [Claude desktop app](https://claude.ai/download) and a normal Claude account.

1. In Study Notebook, click **Connect to Claude** (on the welcome screen, or in **Settings**). This adds Study Notebook to the Claude app's settings; your other Claude settings are kept, with a backup copy.
2. Click **Restart Claude now** (or close Claude from the tray icon and open it again). Claude reads its settings when it starts.
3. The Study Notebook window turns green: **Connected to Claude**.

(Settings → Other ways to connect also offers the `.mcpb` extension file, which can be opened with the Claude app or dragged into its window.)

**Auto-save a course (once per course):** in Study Notebook open the course's **⋯ → Auto-save Claude chats to this course**, create a Claude Project with the course's name, and paste the instructions it gives you. Every chat in that project then saves to that course by itself: Claude saves explanations as you go, adds practice questions for each new topic, and when you ask about one part of something it deepens just that part. Say "don't save this" to keep something out.

Then just study by talking to Claude. When you understand something, Claude saves the final explanation into your notebook, under the right course and topic. If you don't understand a section, Claude rewrites just that part. You can also say "save this to my 52324 notebook" any time. The first time, Claude asks permission to use Study Notebook; choose **Always allow**.

If the notebook app is open, Claude's changes appear in it instantly. If it's closed, they appear the next time you open it.

### Use it in any chat (phone and web too)
Normally Claude reaches Study Notebook only in chats in the Claude app on this computer. To use it in **every** chat, put an online copy of your notebook in your own free Cloudflare account: **Settings → Use in any chat**, then follow the three steps (details in [cloud/README.md](cloud/README.md)). The app keeps your laptop and the online copy in sync both ways.

### 4. Record a lecture
Click **Record lecture**, give it a name, choose the spoken language (Hebrew, English, Arabic, or mixed), and play the recorded lecture in Chrome. Study Notebook captures the sound playing on your computer and writes a transcript live, on your own computer (nothing is uploaded). Keep other sounds off while recording. Click **Stop and save** at the end (or it stops when the sound source closes).

Then tell Claude in the Claude app the sentence the app shows you, e.g. *"Make notes from my lecture "Lecture 4" and save them to my 52324 notebook"*. Claude reads the transcript, fixes recognition mistakes, and writes complete notes into the right topics. The lecture page lists which notes came from it.

- The first recording downloads the speech engine once: about 2 GB (the engine plus a 1.6 GB speech model). Hebrew uses the ivrit.ai Hebrew model; English, Arabic and mixed lectures use Whisper large-v3-turbo. If the Hebrew model can't be downloaded, the general model is used instead.
- Only the parts with speech are transcribed: voice detection skips music, laughter and silence, and the app drops the stock phrases and repeated words speech engines tend to invent there ("I. I. I.", "Thank you.", subtitle credits).
- With an NVIDIA graphics card it runs on the card and easily keeps up with the lecture; otherwise it uses the processor (slower).
- Recording works on Windows for now. The computer won't go to sleep while recording.
- Settings → Lecture recording shows the space used and can remove the engine.

### 5. Practice for exams
Open **Practice**, pick a type (mixed, flashcards, fill in the blank, multiple choice) and press **Make questions**: the app writes them from your notes right away, on your computer, without Claude. Claude also adds questions on its own when it saves a new topic, and you can ask it for more:

Ask Claude in the Claude app, e.g. *"Make practice questions for my 52324 notebook, focusing on my weak topics"*. Claude saves flashcards, multiple-choice and open questions linked to your topics. Click **Practice** in the app: answer, then rate how well you knew it (Again / Hard / Good / Easy). Questions you miss come back in 10 minutes; ones you know come back days or weeks later (spaced repetition). The practice page shows your accuracy per topic, and Claude can see it too, so it writes more questions where you're weak. Keyboard: Space shows the answer, 1–4 rate it, 1–6 pick a multiple-choice answer.

Notes Claude makes from a lecture end with links like *[Lecture 4, 12:30]*: click one to open the transcript at that moment.

### 6. Read, edit and print
Your place in each course is remembered, so the app reopens where you stopped reading. Deleted something by mistake? Press **Undo** on the message that appears. Text size: Ctrl + and Ctrl − (Ctrl 0 for normal). Press **?** for all keyboard shortcuts.

**Before an exam:** in the course's **⋯** menu, choose **Set exam date**. The course header counts down, and **Practice** shows a **Today** plan that spreads the topics you haven't covered (or keep getting wrong) over the days left, with the last two days kept for a full review. **⋯ → Formula sheet** gathers every definition, claim and formula onto as few pages as possible, ready to print or save as PDF.

Settings → Language switches the interface between English and Hebrew. Every section can be edited, undone (back to the version before the last change) or deleted. Search finds words across the course. Click **Print / PDF** at the top. Choose the whole course or one topic, the paper size (A3, A4, A5, A6, B5, Letter, Legal, Tabloid or a custom size), orientation, margins, text size and paper style (plain, grid, lined or dotted). The preview shows exactly how each page will look. Then **Save as PDF**, or **Print…** to choose your printer, the paper type (card, photo, colored…), copies and double-sided printing.

### 7. Back up your notes
Notes save automatically, and the app keeps a backup copy each day (the last 14) in the notes folder's `backups` folder. To keep a copy or move to a new laptop, open **Settings → Back up all notes**, then use **Restore from backup** on the other computer.

---

## For the developer

### Run it on your computer
Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

### Make installers
Push a version tag to GitHub and the workflow in `.github/workflows/build.yml` builds the Windows installer and both Mac apps, then attaches them to a GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

You can also run it by hand: GitHub → **Actions → Build installers → Run workflow**. The files appear under that run's **Artifacts**.

To build on your own machine: `npm run dist:win` on Windows, `npm run dist:mac` on a Mac.

### Automatic updates and the Microsoft Store
See [STORE-AND-UPDATES.md](STORE-AND-UPDATES.md): both are prepared and need your own GitHub and Microsoft accounts to switch on.

### A personal installer with your own notes
`personal.config.js` builds `Study-Notebook-Setup-x.y.z-with-my-notes.exe`, which also carries `build/seed-notes.json` (a notes backup). On the first start, if the computer has no notes yet, the app loads them; it never overwrites existing notes. Don't share this installer; it contains your notes.

```bash
npm run build:connector
npx electron-builder --config personal.config.js --win nsis
```

### How it's put together
| Path | What it does |
|---|---|
| `main/main.js` | The app window, saving notes to disk, themes, Save/Open dialogs |
| `main/preload.js` | The only bridge the page can use to reach the computer |
| `renderer/index.html`, `renderer/app.js`, `renderer/app.css` | The notebook: courses, notes, editing, search, settings, light and dark mode |
| `renderer/print.html`, `renderer/print-ui.js`, `main/print.js` | Print / PDF: page layout, the print dialog with preview, PDF and printer output |
| `connector/` | The Claude connector (an MCP server) and its manifest; `npm run build:connector` packs it into `build/Study Notebook.mcpb` |
| `main/claude-setup.js` | One-click connection: adds the connector to the Claude app's settings file and restarts Claude |
| `main/connector-link.js` | The private local link the connector uses to update the open app live |
| `main/engine.js` | The speech engine: GPU detection, verified downloads, the local transcription server |
| `renderer/recorder.js`, `renderer/rec-worklet.js` | Lecture recording: capturing the computer's sound, splitting it at pauses, live transcript |
| `renderer/i18n.js` | Interface text in English and Hebrew |
| `main/updates.js` | Automatic updates from GitHub Releases (off until configured) |
| `renderer/notebook-ops.js` | Notebook, lecture and practice operations shared by the app and the connector |
| `scripts/copy-vendor.js` | Copies the PDF, Markdown, math libraries and fonts in so the app works offline |

Notes are stored in `notebook-data.json` (plus `notebook-data.previous.json` as a safety copy) in the app's data folder. Settings → **Open notes folder** shows where.
