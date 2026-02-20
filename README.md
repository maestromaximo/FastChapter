# Fast Chapter (Electron Prototype)

Fast Chapter is a desktop app concept for voice-first book drafting. This prototype includes:

- Local account bootstrap (username-based)
- Bookshelf view
- Book creation with filesystem scaffolding
- VS Code-like project navigator wired to the real project directory
- Chapter-by-chapter folder generation
- Side-by-side writing bench (source + compiled PDF preview)
- Real LaTeX compilation to PDF preview (`main.tex`)
- Recording workflow with transcription placeholders
- Profile settings with local OpenAI API key storage
- Background OpenAI transcription jobs (`gpt-4o-transcribe`) with status tracking
- `Write Book` guided flow with Codex SDK session streaming

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

## Desktop Distribution (Windows + macOS)

Fast Chapter now includes an `electron-builder` packaging setup.

Build commands:

```bash
# Build both targets for the current OS config
npm run dist

# Windows artifacts (.exe installer + portable .exe)
npm run dist:win

# macOS artifacts (.dmg + .zip)
npm run dist:mac
```

Artifacts are written to `release/`.

### Which file should you share?

- Windows (recommended): `*-setup.exe`
  - Installer flow.
  - Can create desktop + Start Menu shortcuts.
  - Shows up like a normal installed app.
- Windows (no installer): `*-portable.exe`
  - Runs directly after download.
  - No automatic install/Start Menu registration.
- macOS (recommended): `*.dmg`
  - Users drag app to `/Applications`.
  - Then it appears in Launchpad/Applications like a normal app.
- macOS (alternative): `*.zip`
  - App bundle archive without DMG wrapper.

Notes:
- Building macOS artifacts requires macOS runners/machines.
- Building Windows artifacts is best done on Windows runners/machines.
- Unsigned builds may show OS security warnings on first launch.

### GitHub Actions Build

This repo includes `.github/workflows/build-desktop.yml`:

- Builds on `windows-latest` and `macos-latest`.
- Uploads artifacts on each workflow run.
- If triggered by a published GitHub Release, assets are attached to the release automatically.

## Next Integrations

- Book export (PDF + source bundle)

## Codex Prompt Templates

Developer-owned prompt templates for `Write Book` live in:

- `prompts/book-context.md`
- `prompts/write-first-chapter.md`
- `prompts/write-next-chapter.md`
- `prompts/verify-main-tex.md`

These are loaded by the Electron backend and are not scaffolded into user book folders.

## LaTeX Preview

- Fast Chapter now compiles `main.tex` to a real PDF preview in the workspace.
- Compiler selection is automatic:
  1. `latexmk` (preferred, incremental/optimized)
  2. `pdflatex` fallback
- If neither command is available on PATH, compile actions fail with an install hint.
- Compiled artifacts are stored in each book under `.fastchapter-build/` (hidden from navigator).

## OpenAI Key + Transcription

1. Open **Profile & Settings** from the bottom-right user button.
2. Paste your OpenAI API key in **OpenAI Transcription** and click **Save Key**.
3. Optionally click **Test Key** to validate connectivity.
4. Record audio in a book workspace. Jobs run in the background and status appears in **Voice Workflow**.

Notes:
- The app uses `POST /v1/audio/transcriptions` with model `gpt-4o-transcribe`.
- Supported file types for this workflow are `mp3/mp4/mpeg/mpga/m4a/wav/webm`.
- Upload size is limited to **25 MB per file**.
