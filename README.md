<p align="center">
  <img src="public/logo_no_background.svg" alt="Fast Chapter logo" width="120" />
</p>

<h1 align="center">Fast Chapter</h1>

<p align="center">
  Voice-first desktop app for drafting books chapter by chapter.
</p>

<p align="center">
  <a href="https://github.com/maestromaximo/FastChapter/releases"><img alt="Release" src="https://img.shields.io/github/v/release/maestromaximo/FastChapter?display_name=tag"></a>
  <a href="https://github.com/maestromaximo/FastChapter/actions/workflows/build-desktop.yml"><img alt="Build Desktop" src="https://img.shields.io/github/actions/workflow/status/maestromaximo/FastChapter/build-desktop.yml?label=desktop%20build"></a>
  <a href="https://github.com/maestromaximo/FastChapter/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/maestromaximo/FastChapter/total"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/License-AGPL--3.0-blue.svg"></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-30+-47848F?logo=electron&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white">
</p>

## Download

- Latest desktop builds: [GitHub Releases](https://github.com/maestromaximo/FastChapter/releases)
- CI artifacts (before release): [Build workflow runs](https://github.com/maestromaximo/FastChapter/actions/workflows/build-desktop.yml)

## What Fast Chapter Is

Fast Chapter is an Electron app for writers who want to draft by voice first and refine later. It is local-first by default and designed around practical book production workflows.

### Core capabilities

- Local user profiles and local project storage
- Bookshelf + per-book workspace
- Automatic LaTeX scaffold for new books
- Explorer actions: create, rename, move, delete, upload
- Multi-select explorer actions (bulk move/delete)
- Recording save flow + organized folder structure
- Background transcription jobs with `gpt-4o-transcribe`
- Write-book workflow with Codex session support
- LaTeX compile + in-app PDF preview (`main.tex`)
- Export books as ZIP archives

## Quick Start (Developers)

### Prerequisites

- Node.js 20+
- npm 10+
- Optional for PDF compile preview: `latexmk` (recommended) or `pdflatex` on `PATH`

### Install

```bash
npm install
```

### Run in development

```bash
npm run dev
```

Useful split commands:

```bash
npm run dev:ui
npm run dev:electron
```

### Build and run production locally

```bash
npm run build
npm run start
```

## Desktop Packaging

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

## Project Structure

- Electron main/preload: `electron/main.cjs`, `electron/preload.cjs`
- Renderer: `src/*` (React 18 + Vite + TypeScript)
- UI primitives: `src/components/ui/*`
- Prompt templates: `prompts/*`

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

- API key is stored in local user profile (never hardcoded)
- Endpoint: `POST /v1/audio/transcriptions`
- Model: `gpt-4o-transcribe`
- UI tracks job state: `queued`, `in_progress`, `completed`, `failed`
- Upload limit: 25 MB per file
- Supported formats: `mp3`, `mp4`, `mpeg`, `mpga`, `m4a`, `wav`, `webm`

## CI and Releases

- Workflow: `.github/workflows/build-desktop.yml`
- Builds Windows and macOS artifacts
- Uploads build artifacts to workflow runs
- Publishes release assets on `v*` tags or manual dispatch

## Contributing

- Guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
- Code of conduct: `CODE_OF_CONDUCT.md`
- Contributors: `CONTRIBUTORS.md`

## License

Licensed under GNU Affero General Public License v3.0 (`AGPL-3.0`).

- Full text: `LICENSE`
