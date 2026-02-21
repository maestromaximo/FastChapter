# Contributing to Fast Chapter

Thanks for contributing to Fast Chapter.

## Development Setup

1. Install Node.js 20+.
2. Install dependencies:

```bash
npm install
```

3. Start the app in development mode:

```bash
npm run dev
```

## Branching and Pull Requests

- Create a branch from `main`.
- Keep pull requests focused and small.
- Use clear commit messages.
- Open a PR with a complete description and test notes.

## Quality Expectations

Before opening a PR, run:

```bash
npm run build
```

Manual checks expected for UI/desktop changes:
- local user creation
- book creation scaffold
- workspace read/write behavior
- profile settings (theme and API key actions)
- recording + transcription job rendering
- explorer actions (create/rename/delete/move/upload, including multi-select move/delete)

## Coding Guidelines

- Use TypeScript types for IPC payloads and responses.
- Keep changes targeted; avoid unrelated refactors.
- Preserve secure path handling (no escaping project root).
- Keep file writes deterministic and idempotent when possible.

When changing IPC channels, update all of:
- `electron/main.cjs`
- `electron/preload.cjs`
- `src/types/global.d.ts`
- renderer usage in `src/App.tsx`

## Security

- Do not commit secrets, API keys, local user data, or generated profile files.
- Report vulnerabilities using `SECURITY.md`.

## Licensing

By contributing to this repository, you agree that your contributions are licensed under
the project's GNU Affero General Public License v3.0 (`AGPL-3.0`) in `LICENSE`.

## Pull Request Checklist

- [ ] Build passes with `npm run build`
- [ ] Scope is limited to the intended change
- [ ] No secrets or sensitive local data added
- [ ] User-impacting behavior documented in PR description
