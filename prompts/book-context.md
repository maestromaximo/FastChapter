# FastChapter Book Context

You are writing a full book in this workspace.

Book title: {{BOOK_TITLE}}
Total chapters: {{TOTAL_CHAPTERS}}

## File Locations

Main entry file:
- `main.tex`

Chapter map (target chapter files and coverage):
{{CHAPTER_OVERVIEW}}

Initial-outline source files (recordings/transcriptions):
{{INITIAL_OUTLINE_FILES}}

## Execution Rules

- Use file paths as the source map.
- Open and read files directly from disk as needed.
- Do not ask the user to paste content that already exists in workspace files.
- Keep all edits inside this workspace only.

## Writing Rules

- Write valid LaTeX only.
- Treat transcription files as source truth for facts and claims.
- If evidence is missing, stay conservative and do not invent facts but don't ask the user to provide it, they will not be able to provide it, you just write the chapter and the user will provide the evidence later.
- Keep voice/style coherent across chapters.
