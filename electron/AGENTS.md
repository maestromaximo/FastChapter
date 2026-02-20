# AGENTS.md (electron)

Guidance for coding agents working in `electron/`.

## Scope

- `electron/main.cjs`
- `electron/preload.cjs`

## Responsibilities

- Keep IPC handlers authoritative for filesystem and background work.
- Keep all project file operations constrained to the current book root.
- Preserve local-first behavior and deterministic file writes.

## IPC Contract Rules

When adding or changing an IPC endpoint:

1. Add/update handler in `electron/main.cjs`.
2. Expose/update bridge method in `electron/preload.cjs`.
3. Update renderer typings in `src/types/global.d.ts`.
4. Confirm call sites in `src/App.tsx` still match payload/response shape.

Do not ship partial IPC changes.

## Filesystem Safety

- Use path resolution helpers that prevent escaping the project root.
- Validate and normalize relative paths before reading/writing/moving.
- Never delete or overwrite outside the active book root.

## Recording + Transcription

- Preserve folder organization by recording kind:
  - `initial-outline`
  - `chapters/chapter-N`
  - `miscellaneous`
- Keep background transcription job state reliable (`queued`, `in_progress`, `completed`, `failed`).

## Validation

- `npm run build` succeeds after IPC changes.
- Recorder save path and transcription outputs match expected folders.
- Explorer operations (create/rename/delete/move/upload) continue to work through IPC.
