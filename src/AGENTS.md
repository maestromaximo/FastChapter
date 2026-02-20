# AGENTS.md (src)

Guidance for coding agents working in `src/`.

## Scope

- `src/App.tsx`
- `src/types/*`
- `src/components/*`
- `src/index.css`

## UI Priorities

- Preserve existing workspace layout: explorer (left), editor/preview (center), workflow pane (right).
- Preserve dark/light theme behavior.
- Keep profile launcher in the bottom-right unless explicitly requested otherwise.

## Explorer Behavior (Do Not Regress)

- Scroll must work even with hidden scrollbars.
- Context menu placement must avoid clipping near window edges.
- Right-click actions must support create/rename/delete/upload as currently implemented.
- Multi-select behavior:
  - `Shift+click`: contiguous range select.
  - `Ctrl/Cmd+click`: toggle additive selection.
  - Bulk move and bulk delete should work for selected entries.

## Recording/Preview Behavior (Do Not Regress)

- Closing/saving while recording must still finalize media capture before save.
- Audio files should render with an inline audio player preview (not raw text placeholder).
- Notices/toasts should auto-dismiss according to configured timeout.

## Type and API Discipline

- Keep `window.fastChapter` usage aligned with `src/types/global.d.ts`.
- If renderer starts using a new API method, verify matching preload + main IPC support.
- Prefer typed payload/result objects over ad-hoc `any`.

## Validation

- `npm run build` succeeds.
- Explorer interactions remain functional (including multi-select and drag-move).
- Audio recording save and preview continue working.
