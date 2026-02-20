# AGENTS.md

Guidance for coding agents working in this repository.

## Mission

Build and iterate on **Fast Chapter**, an Electron desktop app for voice-first book drafting:

- Local-first user and book storage
- Chapter-by-chapter LaTeX workflow
- Recording + transcription pipeline
- Fast, practical UI for writing and project navigation

## Stack

- Electron (`electron/main.cjs`, `electron/preload.cjs`)
- React 18 + Vite + TypeScript (`src/*`)
- Tailwind CSS + shadcn-style component primitives (`src/components/ui/*`)
- Node.js `>=20` (required by `package.json`)

## Core Commands

```bash
npm install
npm run dev
npm run dev:ui
npm run dev:electron
npm run build
npm run start
```

Notes:
- Use a Node 20+ runtime.
- In WSL, use Linux Node binaries; avoid calling Windows `node.exe` from bash.

## Architecture Map

- `electron/main.cjs`
  - Creates BrowserWindow
  - Handles IPC for users/books/files/recordings/profile/navigation actions
  - Owns local filesystem scaffolding
  - Owns OpenAI transcription job orchestration
- `electron/preload.cjs`
  - Exposes `window.fastChapter` API safely to renderer
- `src/App.tsx`
  - Main product UI (auth, bookshelf, workspace, profile)
  - Recording dialog + workflow
  - Theme, notices, local interaction states
- `src/types/domain.ts`, `src/types/global.d.ts`
  - Shared renderer typing and preload API typings

## Product Rules

When creating a new book, ensure these artifacts exist:

- `book.json`
- `main.tex`
- `cover-page.tex`
- `back-page.tex`
- `chapters/chapter-1/chapter-1.tex`
- `chapters/chapter-1/assets/`
- `recordings/`
- `transcriptions/`

`main.tex` should be the project entry file and include cover page, table of contents, chapter includes, and back page.

Recording and transcription outputs should be organized by type:

- `recordings/initial-outline/`
- `recordings/chapters/chapter-N/`
- `recordings/miscellaneous/`
- `transcriptions/initial-outline/`
- `transcriptions/chapters/chapter-N/`
- `transcriptions/miscellaneous/`

## UI/UX Guardrails

- Preserve the existing dark/light theme behavior.
- Keep the profile launcher in the bottom-right unless explicitly asked otherwise.
- Avoid duplicating top navigation bars or headers.
- Use existing shadcn-style primitives before introducing new UI patterns.
- Keep workspace layout practical: navigator (left), editor/preview (center), voice workflow (right).

## OpenAI Transcription Rules

- API key is stored in local user profile (not hardcoded).
- Audio transcription uses `POST /v1/audio/transcriptions` with `gpt-4o-transcribe`.
- Keep background job status visible (queued, in_progress, completed, failed).
- Respect upload limits and supported formats in UI messaging.

## Coding Standards

- Use TypeScript types for IPC payloads and responses.
- Prefer small, targeted changes over broad refactors.
- Keep file writes deterministic and idempotent where possible.
- Preserve secure path handling for project file operations (no escaping project root).
- Do not break existing `window.fastChapter` contract without updating:
  - `electron/preload.cjs`
  - `src/types/global.d.ts`
  - renderer usage in `src/App.tsx`

When adding or changing IPC channels:

- Register the handler in `electron/main.cjs`.
- Expose it in `electron/preload.cjs`.
- Update `src/types/global.d.ts`.
- Update renderer call sites in `src/App.tsx`.

## Validation Checklist

Before finishing changes:

1. App launches with `npm run dev`.
2. Local user creation still works.
3. Book creation scaffolds expected files/folders.
4. Workspace file open/save still functions.
5. Profile settings (theme + API key actions) still function.
6. Recording save and transcription job list still render correctly.
7. Explorer actions still function (create/rename/delete/move/upload, including multi-select bulk delete/move).

## Scoped Guides

- `electron/AGENTS.md` for Electron main/preload IPC and filesystem rules.
- `src/AGENTS.md` for renderer/UI behavior and interaction guardrails.

If local build tools cannot run in current shell, state that clearly and describe what still needs manual verification.

## Safety

- Never commit API keys or sensitive local profile data.
- Never use destructive git operations unless explicitly requested.
- Do not remove user-authored local content when migrating scaffolds.
