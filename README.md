# Fast Chapter

Fast Chapter is an Electron desktop app for voice-first book drafting.

It is built around a local-first workflow:
- local user profiles
- local book/project files
- chapter-by-chapter LaTeX authoring
- recording and transcription pipelines
- practical writing workspace UI

## Features

- Local account bootstrap and profile settings
- Bookshelf + per-book workspace
- Automatic LaTeX project scaffolding for new books
- Explorer with create/rename/delete/move/upload actions
- Multi-select explorer actions (bulk move/delete)
- Recording save flow with organized folder structure
- Background transcription jobs (`gpt-4o-transcribe`)
- Chapter writing workflow with Codex session support
- Real LaTeX compilation and PDF preview (`main.tex`)
- Export workflow for book archives

## Tech Stack

- Electron (`electron/main.cjs`, `electron/preload.cjs`)
- React 18 + Vite + TypeScript (`src/*`)
- Tailwind CSS + shadcn-style component primitives (`src/components/ui/*`)
- Node.js `>=20`

## Getting Started

### Prerequisites

- Node.js 20+
- npm 10+
- Optional for PDF compile preview: `latexmk` (recommended) or `pdflatex` on `PATH`

### Install

```bash
npm install
```

### Run (development)

```bash
npm run dev
```

Useful split commands:

```bash
npm run dev:ui
npm run dev:electron
```

### Build and run production app

```bash
npm run build
npm run start
```

## Book Scaffold Rules

When a new book is created, Fast Chapter ensures:

- `book.json`
- `main.tex`
- `cover-page.tex`
- `back-page.tex`
- `chapters/chapter-1/chapter-1.tex`
- `chapters/chapter-1/assets/`
- `recordings/`
- `transcriptions/`

`main.tex` is the project entry file and includes cover page, table of contents, chapter includes, and back page.

Recording/transcription files are organized under:

- `recordings/initial-outline/`
- `recordings/chapters/chapter-N/`
- `recordings/miscellaneous/`
- `transcriptions/initial-outline/`
- `transcriptions/chapters/chapter-N/`
- `transcriptions/miscellaneous/`

## OpenAI Transcription

- API key is stored in the local user profile (never hardcoded)
- Endpoint: `POST /v1/audio/transcriptions`
- Model: `gpt-4o-transcribe`
- UI tracks job state (`queued`, `in_progress`, `completed`, `failed`)
- Upload limit: 25 MB per file
- Supported formats: `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm`

## Desktop Distribution

```bash
npm run dist
npm run dist:win
npm run dist:mac
```

Artifacts are written to `release/`.

- Windows installer: `*-setup.exe`
- Windows portable: `*-portable.exe`
- macOS installer: `*.dmg`
- macOS archive: `*.zip`

## GitHub Actions

- `.github/workflows/build-desktop.yml`
  - Builds Windows and macOS distributables
  - Uploads artifacts to workflow runs
  - Can publish release assets for version tags (`v*`) or manual dispatch

## Contributing and Project Policies

- Contributing guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Contributors list: `CONTRIBUTORS.md`
- Issue and PR templates: `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`
- Repository ruleset template: `.github/rulesets/main.ruleset.json`

## License

Licensed under the GNU Affero General Public License v3.0 (`AGPL-3.0`).

- Full text: `LICENSE`

## Prompt Templates

Default prompt templates used by the write flow live in:

- `prompts/book-context.md`
- `prompts/write-first-chapter.md`
- `prompts/write-next-chapter.md`
- `prompts/verify-main-tex.md`

## Security Notes

- Never commit API keys or local profile data
- Keep all file operations constrained to the project root
- Review `SECURITY.md` for vulnerability reporting guidance
