# Fast Chapter (Electron Prototype)

Fast Chapter is a desktop app concept for voice-first book drafting. This prototype includes:

- Local account bootstrap (username-based)
- Bookshelf view
- Book creation with filesystem scaffolding
- VS Code-like project navigator wired to the real project directory
- Chapter-by-chapter folder generation
- Side-by-side writing bench (source + preview placeholder)
- Recording workflow with transcription placeholders
- Profile settings with local OpenAI API key storage
- Background OpenAI transcription jobs (`gpt-4o-transcribe`) with status tracking
- `Write My Book` placeholder action for future Codex SDK integration

## Tech Stack

- Electron (main + preload)
- React + Vite
- Tailwind CSS
- shadcn-style UI components

## Project Structure

- `electron/main.cjs`: app window + IPC + local filesystem orchestration
- `electron/preload.cjs`: secure API bridge to renderer
- `src/App.tsx`: complete UI/UX flow (bookshelf, workspace, recording, placeholders)
- `src/components/ui/*`: shadcn-style component primitives

## Local Data Layout

Data is stored in Electron user data under:

- `users/<username>/books/<book-uuid>/`

Each new book gets:

- `book.json`
- `main.tex` (includes cover, auto table of contents, chapters, back page)
- `cover-page.tex`
- `back-page.tex`
- `chapters/chapter-1/chapter-1.tex`
- `chapters/chapter-1/assets/`
- `recordings/`
- `transcriptions/`

Additional chapters are created as:

- `chapters/chapter-2/chapter-2.tex`, etc.

## Run

1. Install Node.js 20+ (Linux build if running in WSL bash).
2. Install dependencies:

```bash
npm install
```

3. Start in dev mode:

```bash
npm run dev
```

4. Build renderer assets:

```bash
npm run build
```

5. Run Electron against built renderer:

```bash
npm run start
```

## Next Integrations

- MyTeX / LaTeX compilation + rendered PDF pane
- Codex SDK writing orchestration from transcriptions
- Book export (PDF + source bundle)

## OpenAI Key + Transcription

1. Open **Profile & Settings** from the bottom-right user button.
2. Paste your OpenAI API key in **OpenAI Transcription** and click **Save Key**.
3. Optionally click **Test Key** to validate connectivity.
4. Record audio in a book workspace. Jobs run in the background and status appears in **Voice Workflow**.

Notes:
- The app uses `POST /v1/audio/transcriptions` with model `gpt-4o-transcribe`.
- Supported file types for this workflow are `mp3/mp4/mpeg/mpga/m4a/wav/webm`.
- Upload size is limited to **25 MB per file**.
