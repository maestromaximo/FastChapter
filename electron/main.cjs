const path = require("node:path");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain } = require("electron");
const { v4: uuidv4 } = require("uuid");

const USERS_DIR = "users";
const BOOKS_DIR = "books";
const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const OPENAI_TRANSCRIPTION_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const LATEX_BUILD_DIR = ".fastchapter-build";
const LATEX_COMPILE_TIMEOUT_MS = 10 * 60 * 1000;
const LATEX_LOG_TAIL_LIMIT = 12000;
const LATEX_RELEVANT_EXTENSIONS = new Set([
  ".tex",
  ".sty",
  ".cls",
  ".bib",
  ".bst",
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
  ".svg",
  ".eps"
]);
const LATEX_IGNORED_DIRS = new Set([
  LATEX_BUILD_DIR,
  "recordings",
  "transcriptions",
  ".git",
  "node_modules"
]);
const CODEX_PROMPT_FILES = {
  bookContext: "book-context.md",
  firstChapter: "write-first-chapter.md",
  nextChapter: "write-next-chapter.md",
  verifyMainTex: "verify-main-tex.md"
};
const CODEX_PROMPTS_ROOT = path.join(__dirname, "..", "prompts");
const WRITE_BOOK_LOG_LINE_LIMIT = 2500;
const WRITE_BOOK_LOG_LINE_LENGTH_LIMIT = 1200;
const WRITE_BOOK_POLL_LOG_LIMIT = 200;

const transcriptionJobs = new Map();
const latexCompileCache = new Map();
const writeBookSessions = new Map();
let latexCompilerPromise = null;

function normalizeUserName(value) {
  const cleaned = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  return cleaned.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function getUsersRoot() {
  return path.join(app.getPath("userData"), USERS_DIR);
}

function getUserRoot(username) {
  return path.join(getUsersRoot(), username);
}

function getProfilePath(username) {
  return path.join(getUserRoot(username), "profile.json");
}

function getBooksRoot(username) {
  return path.join(getUserRoot(username), BOOKS_DIR);
}

function getBookRoot(username, bookId) {
  return path.join(getBooksRoot(username), bookId);
}

function resolveInside(root, candidateRelativePath) {
  const rootPath = path.resolve(root);
  const candidatePath = path.resolve(root, candidateRelativePath);

  if (candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`)) {
    return candidatePath;
  }

  throw new Error("Path escapes project boundary.");
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function buildChapterTeX(index, title) {
  return `\\chapter{${title}}\n\nWrite this chapter by voice first, then refine.\n`;
}

function parseChapterIndex(folderName) {
  const match = folderName.match(/^chapter-(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

async function listChapterDescriptors(bookRoot) {
  const chaptersRoot = path.join(bookRoot, "chapters");
  await ensureDir(chaptersRoot);

  const entries = await fs.readdir(chaptersRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const index = parseChapterIndex(entry.name);
      if (!index) return null;
      const texRelativePath = `chapters/${entry.name}/${entry.name}.tex`;
      return { index, texRelativePath };
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);
}

function buildMainTeX(chapters) {
  const chapterInputs =
    chapters.length > 0
      ? chapters.map((chapter) => `\\input{${chapter.texRelativePath}}`)
      : ["% No chapters yet. Add one from the workspace."];

  return [
    "\\documentclass[12pt]{book}",
    "\\usepackage[utf8]{inputenc}",
    "\\usepackage[T1]{fontenc}",
    "\\usepackage{graphicx}",
    "\\usepackage{hyperref}",
    "",
    "\\begin{document}",
    "",
    "% Cover",
    "\\input{cover-page.tex}",
    "",
    "% Front matter + auto TOC",
    "\\frontmatter",
    "\\tableofcontents",
    "",
    "% Main content",
    "\\mainmatter",
    ...chapterInputs,
    "",
    "% Back matter",
    "\\backmatter",
    "\\input{back-page.tex}",
    "",
    "\\end{document}",
    ""
  ].join("\n");
}

async function refreshMainTeX(bookRoot) {
  const chapters = await listChapterDescriptors(bookRoot);
  const mainPath = path.join(bookRoot, "main.tex");
  await fs.writeFile(mainPath, buildMainTeX(chapters), "utf8");
}

async function ensureLatexScaffold(bookRoot) {
  await ensureDir(path.join(bookRoot, "chapters"));

  const coverPath = path.join(bookRoot, "cover-page.tex");
  if (!(await fileExists(coverPath))) {
    await fs.writeFile(
      coverPath,
      "\\begin{titlepage}\n  \\centering\n  {\\Huge Fast Chapter Draft\\par}\n\\end{titlepage}\n",
      "utf8"
    );
  }

  const backPath = path.join(bookRoot, "back-page.tex");
  if (!(await fileExists(backPath))) {
    await fs.writeFile(backPath, "% Back page placeholder\n", "utf8");
  }

  const mainPath = path.join(bookRoot, "main.tex");
  if (!(await fileExists(mainPath))) {
    await refreshMainTeX(bookRoot);
  }
}

async function assertBookExists(bookRoot, bookId) {
  const metaPath = path.join(bookRoot, "book.json");
  if (!(await fileExists(metaPath))) {
    throw new Error(`Book not found: ${bookId}`);
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProfile(username, profileRaw) {
  const now = new Date().toISOString();
  const profile = isObject(profileRaw) ? profileRaw : {};
  const integrations = isObject(profile.integrations) ? profile.integrations : {};

  return {
    username,
    displayName: typeof profile.displayName === "string" ? profile.displayName : "",
    createdAt: typeof profile.createdAt === "string" ? profile.createdAt : now,
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : now,
    integrations: {
      openAIApiKey: typeof integrations.openAIApiKey === "string" ? integrations.openAIApiKey : "",
      autoTranscribe: integrations.autoTranscribe !== false
    }
  };
}

function sanitizeProfileForRenderer(profile) {
  return {
    username: profile.username,
    displayName: profile.displayName,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    integrations: {
      hasOpenAIApiKey: Boolean(profile.integrations.openAIApiKey),
      autoTranscribe: profile.integrations.autoTranscribe !== false
    }
  };
}

async function ensureProfileFile(username) {
  const profilePath = getProfilePath(username);

  try {
    const current = await readJson(profilePath);
    const normalized = normalizeProfile(username, current);
    await writeJson(profilePath, normalized);
    return normalized;
  } catch {
    const normalized = normalizeProfile(username, {});
    await writeJson(profilePath, normalized);
    return normalized;
  }
}

async function ensureUser(usernameRaw) {
  const username = normalizeUserName(usernameRaw);
  if (!username) {
    throw new Error("Please provide a valid local username.");
  }

  const userRoot = getUserRoot(username);
  await ensureDir(path.join(userRoot, BOOKS_DIR));
  await ensureProfileFile(username);

  return { username, rootPath: userRoot };
}

async function readUserProfilePrivate(usernameRaw) {
  const username = normalizeUserName(usernameRaw);
  if (!username) {
    throw new Error("Invalid username.");
  }

  await ensureUser(username);
  const profilePath = getProfilePath(username);

  try {
    const current = await readJson(profilePath);
    const normalized = normalizeProfile(username, current);
    await writeJson(profilePath, normalized);
    return normalized;
  } catch {
    const normalized = normalizeProfile(username, {});
    await writeJson(profilePath, normalized);
    return normalized;
  }
}

async function getUserProfile(usernameRaw) {
  const profile = await readUserProfilePrivate(usernameRaw);
  return sanitizeProfileForRenderer(profile);
}

async function updateUserProfile(payload) {
  const username = normalizeUserName(payload.username);
  const profile = await readUserProfilePrivate(username);

  if (typeof payload.displayName === "string") {
    profile.displayName = payload.displayName.trim();
  }

  if (typeof payload.openAIApiKey === "string") {
    profile.integrations.openAIApiKey = payload.openAIApiKey.trim();
  }

  if (payload.clearOpenAIApiKey) {
    profile.integrations.openAIApiKey = "";
  }

  if (typeof payload.autoTranscribe === "boolean") {
    profile.integrations.autoTranscribe = payload.autoTranscribe;
  }

  profile.updatedAt = new Date().toISOString();
  await writeJson(getProfilePath(username), profile);

  return sanitizeProfileForRenderer(profile);
}

async function parseOpenAIError(response) {
  const raw = await response.text();
  try {
    const json = JSON.parse(raw);
    if (typeof json?.error?.message === "string") {
      return json.error.message;
    }
  } catch {
    // Ignore parse errors and use raw text.
  }

  return raw || `HTTP ${response.status}`;
}

function normalizeRelativePath(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "");
}

function trimLogTail(output) {
  const text = String(output || "").trim();
  if (text.length <= LATEX_LOG_TAIL_LIMIT) return text;
  return text.slice(-LATEX_LOG_TAIL_LIMIT);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(command, args, cwd, timeoutMs = LATEX_COMPILE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const needsWindowsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(String(command || ""));
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: needsWindowsShell
    });

    let stdout = "";
    let stderr = "";
    let isFinished = false;
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      if (isFinished) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!isFinished) child.kill("SIGKILL");
      }, 1200);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (isFinished) return;
      isFinished = true;
      clearTimeout(timer);
      resolve({
        code: Number(code ?? -1),
        signal: signal || null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

function getCodexCommandCandidates() {
  return process.platform === "win32" ? ["codex", "codex.cmd"] : ["codex"];
}

async function resolveCodexCommand() {
  const candidates = getCodexCommandCandidates();
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const result = await runCommand(candidate, ["--version"], process.cwd(), 15000);
      if (result.code === 0) {
        return { command: candidate, versionResult: result };
      }
      lastError = new Error(trimLogTail(result.stderr || result.stdout || `${candidate} --version failed.`));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Codex CLI is not installed or not available on PATH.");
}

async function detectLatexCompiler() {
  if (latexCompilerPromise) {
    return latexCompilerPromise;
  }

  latexCompilerPromise = (async () => {
    const attempts = [
      { type: "latexmk", command: "latexmk", args: ["--version"] },
      { type: "pdflatex", command: "pdflatex", args: ["--version"] }
    ];

    for (const attempt of attempts) {
      try {
        const check = await runCommand(attempt.command, attempt.args, process.cwd(), 12000);
        if (check.code === 0) {
          return { type: attempt.type, command: attempt.command };
        }
      } catch {
        // Ignore and try next compiler option.
      }
    }

    throw new Error(
      "No LaTeX compiler found. Install TeX with latexmk (recommended) or pdflatex and ensure it is on PATH."
    );
  })();

  try {
    return await latexCompilerPromise;
  } catch (error) {
    latexCompilerPromise = null;
    throw error;
  }
}

async function collectLatexFingerprintFiles(bookRoot) {
  const stack = [bookRoot];
  const descriptors = [];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(bookRoot, absolutePath).replaceAll(path.sep, "/");

      if (entry.isDirectory()) {
        if (LATEX_IGNORED_DIRS.has(entry.name)) continue;
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!LATEX_RELEVANT_EXTENSIONS.has(ext)) continue;

      const stats = await fs.stat(absolutePath);
      descriptors.push(`${relativePath}|${stats.size}|${Math.round(stats.mtimeMs)}`);
    }
  }

  descriptors.sort((a, b) => a.localeCompare(b));
  return descriptors;
}

async function computeLatexFingerprint(bookRoot, entryRelativePath) {
  const descriptors = await collectLatexFingerprintFiles(bookRoot);
  const hash = crypto.createHash("sha1");
  hash.update(`entry:${entryRelativePath}\n`);
  descriptors.forEach((value) => hash.update(`${value}\n`));
  return hash.digest("hex");
}

async function loadPdfDataUrl(filePath) {
  const pdfBuffer = await fs.readFile(filePath);
  return `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
}

async function runLatexCompile({ compiler, bookRoot, entryRelativePath, buildRoot }) {
  if (compiler.type === "latexmk") {
    const args = [
      "-pdf",
      "-interaction=nonstopmode",
      "-file-line-error",
      "-halt-on-error",
      `-outdir=${buildRoot}`,
      entryRelativePath
    ];
    const result = await runCommand(compiler.command, args, bookRoot);
    const combinedLog = `${result.stdout}\n${result.stderr}`;

    if (result.code !== 0) {
      throw new Error(
        `LaTeX compile failed (${compiler.type}, code ${result.code}).\n${trimLogTail(combinedLog)}`
      );
    }

    return {
      durationMs: result.durationMs,
      logTail: trimLogTail(combinedLog)
    };
  }

  const args = [
    "-interaction=nonstopmode",
    "-file-line-error",
    "-halt-on-error",
    `-output-directory=${buildRoot}`,
    entryRelativePath
  ];

  const first = await runCommand(compiler.command, args, bookRoot);
  const second = first.code === 0 ? await runCommand(compiler.command, args, bookRoot) : null;
  const combinedLog = [first.stdout, first.stderr, second?.stdout || "", second?.stderr || ""].join("\n");
  const finalCode = second ? second.code : first.code;

  if (finalCode !== 0) {
    throw new Error(
      `LaTeX compile failed (${compiler.type}, code ${finalCode}).\n${trimLogTail(combinedLog)}`
    );
  }

  return {
    durationMs: first.durationMs + (second?.durationMs || 0),
    logTail: trimLogTail(combinedLog)
  };
}

async function compileLatex(payload) {
  const username = normalizeUserName(payload.username);
  const { bookId } = payload;
  const entryRelativePath = normalizeRelativePath(payload.entryRelativePath || "main.tex") || "main.tex";

  if (!entryRelativePath.toLowerCase().endsWith(".tex")) {
    throw new Error("LaTeX compile entry must be a .tex file.");
  }

  const bookRoot = getBookRoot(username, bookId);
  await assertBookExists(bookRoot, bookId);
  await ensureLatexScaffold(bookRoot);
  const entryAbsolutePath = resolveInside(bookRoot, entryRelativePath);

  if (!(await fileExists(entryAbsolutePath))) {
    throw new Error(`LaTeX entry file not found: ${entryRelativePath}`);
  }

  const outputBaseName = path.basename(entryRelativePath, ".tex");
  const buildRoot = path.join(bookRoot, LATEX_BUILD_DIR);
  const pdfAbsolutePath = path.join(buildRoot, `${outputBaseName}.pdf`);
  const outputRelativePath = path.relative(bookRoot, pdfAbsolutePath).replaceAll(path.sep, "/");
  await ensureDir(buildRoot);

  const cacheKey = `${username}:${bookId}:${entryRelativePath}`;
  const fingerprint = await computeLatexFingerprint(bookRoot, entryRelativePath);
  const cached = latexCompileCache.get(cacheKey);

  if (cached?.runningPromise) {
    return cached.runningPromise;
  }

  if (cached && cached.fingerprint === fingerprint && (await fileExists(pdfAbsolutePath))) {
    return {
      ok: true,
      cached: true,
      compiler: cached.compiler,
      entryRelativePath,
      outputRelativePath,
      durationMs: 0,
      generatedAt: new Date().toISOString(),
      logTail: cached.logTail || "",
      pdfDataUrl: await loadPdfDataUrl(pdfAbsolutePath)
    };
  }

  const compilePromise = (async () => {
    const compiler = await detectLatexCompiler();
    const execution = await runLatexCompile({
      compiler,
      bookRoot,
      entryRelativePath,
      buildRoot
    });

    if (!(await fileExists(pdfAbsolutePath))) {
      throw new Error(`Compilation finished but PDF was not produced: ${outputRelativePath}`);
    }

    const generatedAt = new Date().toISOString();
    latexCompileCache.set(cacheKey, {
      fingerprint,
      compiler: compiler.type,
      logTail: execution.logTail,
      generatedAt
    });

    return {
      ok: true,
      cached: false,
      compiler: compiler.type,
      entryRelativePath,
      outputRelativePath,
      durationMs: execution.durationMs,
      generatedAt,
      logTail: execution.logTail,
      pdfDataUrl: await loadPdfDataUrl(pdfAbsolutePath)
    };
  })();

  latexCompileCache.set(cacheKey, {
    ...(cached || {}),
    runningPromise: compilePromise
  });

  try {
    return await compilePromise;
  } finally {
    const current = latexCompileCache.get(cacheKey);
    if (current?.runningPromise) {
      delete current.runningPromise;
      latexCompileCache.set(cacheKey, current);
    }
  }
}

async function testOpenAIApiKey(payload) {
  const username = normalizeUserName(payload.username);
  const profile = await readUserProfilePrivate(username);
  const apiKey = (typeof payload.apiKey === "string" ? payload.apiKey : profile.integrations.openAIApiKey).trim();

  if (!apiKey) {
    throw new Error("No API key found. Paste an OpenAI API key first.");
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!response.ok) {
    const message = await parseOpenAIError(response);
    throw new Error(`OpenAI API key test failed: ${message}`);
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    message: "OpenAI API key is valid."
  };
}

async function listBooks(username) {
  const booksRoot = getBooksRoot(username);
  await ensureDir(booksRoot);

  const entries = await fs.readdir(booksRoot, { withFileTypes: true });
  const books = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(booksRoot, entry.name, "book.json");
    try {
      const meta = await readJson(metaPath);
      books.push(meta);
    } catch {
      // Skip malformed folders.
    }
  }

  return books.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function touchBook(username, bookId) {
  const metaPath = path.join(getBookRoot(username, bookId), "book.json");
  const meta = await readJson(metaPath);
  meta.updatedAt = new Date().toISOString();
  await writeJson(metaPath, meta);
  return meta;
}

async function createChapter(username, bookId) {
  const bookRoot = getBookRoot(username, bookId);
  const chaptersRoot = path.join(bookRoot, "chapters");
  await ensureDir(chaptersRoot);

  const entries = await fs.readdir(chaptersRoot, { withFileTypes: true });
  const chapterIndexes = entries
    .filter((entry) => entry.isDirectory() && /^chapter-\d+$/.test(entry.name))
    .map((entry) => Number(entry.name.replace("chapter-", "")))
    .filter(Number.isFinite);

  const nextIndex = chapterIndexes.length ? Math.max(...chapterIndexes) + 1 : 1;
  const folderName = `chapter-${nextIndex}`;
  const chapterRoot = path.join(chaptersRoot, folderName);

  await ensureDir(path.join(chapterRoot, "assets"));
  await fs.writeFile(
    path.join(chapterRoot, `${folderName}.tex`),
    buildChapterTeX(nextIndex, `Chapter ${nextIndex}`),
    "utf8"
  );

  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return {
    chapterIndex: nextIndex,
    chapterPath: path.relative(bookRoot, chapterRoot)
  };
}

async function createBook(username, titleRaw) {
  const title = titleRaw.trim() || "Untitled Book";
  const id = uuidv4();
  const now = new Date().toISOString();

  const bookRoot = getBookRoot(username, id);
  await ensureDir(bookRoot);
  await ensureDir(path.join(bookRoot, "chapters"));
  await ensureDir(path.join(bookRoot, "transcriptions"));
  await ensureDir(path.join(bookRoot, "recordings"));
  await ensureLatexScaffold(bookRoot);

  const metadata = {
    id,
    title,
    createdAt: now,
    updatedAt: now
  };

  await writeJson(path.join(bookRoot, "book.json"), metadata);
  await createChapter(username, id);
  await refreshMainTeX(bookRoot);

  return metadata;
}

async function renameBook(username, bookId, titleRaw) {
  const title = titleRaw.trim();
  if (!title) {
    throw new Error("Title cannot be empty.");
  }

  const metaPath = path.join(getBookRoot(username, bookId), "book.json");
  const meta = await readJson(metaPath);
  meta.title = title;
  meta.updatedAt = new Date().toISOString();
  await writeJson(metaPath, meta);
  return meta;
}

async function readTree(currentDir, rootDir) {
  const items = await fs.readdir(currentDir, { withFileTypes: true });

  const children = await Promise.all(
    items
      .filter(
        (item) =>
          item.name !== "book.json" &&
          !item.name.endsWith(".meta.json") &&
          !item.name.startsWith(".")
      )
      .map(async (item) => {
        const absolutePath = path.join(currentDir, item.name);
        const relativePath = path.relative(rootDir, absolutePath).replaceAll(path.sep, "/");

        if (item.isDirectory()) {
          const nested = await readTree(absolutePath, rootDir);
          return {
            name: item.name,
            path: relativePath,
            type: "directory",
            children: nested
          };
        }

        return {
          name: item.name,
          path: relativePath,
          type: "file"
        };
      })
  );

  return children.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === "directory" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

async function getBookTree(username, bookId) {
  const root = getBookRoot(username, bookId);
  await assertBookExists(root, bookId);
  await ensureLatexScaffold(root);
  return readTree(root, root);
}

function isLikelyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".tex", ".txt", ".md", ".json", ".yaml", ".yml"].includes(ext);
}

function isLikelyAudioFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return [".wav", ".mp3", ".mp4", ".m4a", ".ogg", ".webm", ".flac", ".mpeg", ".mpga"].includes(ext);
}

async function readProjectFile(username, bookId, relativePath) {
  const bookRoot = getBookRoot(username, bookId);
  const absolutePath = resolveInside(bookRoot, relativePath);

  if (!isLikelyTextFile(absolutePath)) {
    throw new Error("Only text file previews are supported in this prototype.");
  }

  return fs.readFile(absolutePath, "utf8");
}

async function readProjectMediaDataUrl(username, bookId, relativePath) {
  const bookRoot = getBookRoot(username, bookId);
  const absolutePath = resolveInside(bookRoot, relativePath);

  if (!isLikelyAudioFile(absolutePath)) {
    throw new Error("Only audio previews are supported in this prototype.");
  }

  const buffer = await fs.readFile(absolutePath);
  const mimeType = extToMime(absolutePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function writeProjectFile(username, bookId, relativePath, content) {
  const bookRoot = getBookRoot(username, bookId);
  const absolutePath = resolveInside(bookRoot, relativePath);

  if (!isLikelyTextFile(absolutePath)) {
    throw new Error("Only text files can be edited in this prototype.");
  }

  await fs.writeFile(absolutePath, content, "utf8");
  await touchBook(username, bookId);

  return { ok: true };
}

function toProjectRelativePath(bookRoot, absolutePath) {
  return path.relative(bookRoot, absolutePath).replaceAll(path.sep, "/");
}

function sanitizeEntryName(nameRaw) {
  const name = String(nameRaw || "").trim();
  if (!name) {
    throw new Error("Name cannot be empty.");
  }
  if (name === "." || name === "..") {
    throw new Error("Invalid name.");
  }
  if (name.includes("/") || name.includes("\\")) {
    throw new Error("Name cannot include path separators.");
  }
  return name;
}

async function createProjectFile(username, bookId, parentRelativePath, nameRaw) {
  const bookRoot = getBookRoot(username, bookId);
  const parentRelative = String(parentRelativePath || "").trim();
  const name = sanitizeEntryName(nameRaw);
  const parentAbsolutePath = resolveInside(bookRoot, parentRelative || ".");
  const parentStats = await fs.stat(parentAbsolutePath);

  if (!parentStats.isDirectory()) {
    throw new Error("Selected parent is not a directory.");
  }

  const targetRelativePath = parentRelative ? `${parentRelative}/${name}` : name;
  const targetAbsolutePath = resolveInside(bookRoot, targetRelativePath);

  await fs.writeFile(targetAbsolutePath, "", { encoding: "utf8", flag: "wx" });
  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return {
    ok: true,
    path: toProjectRelativePath(bookRoot, targetAbsolutePath),
    type: "file"
  };
}

async function createProjectDirectory(username, bookId, parentRelativePath, nameRaw) {
  const bookRoot = getBookRoot(username, bookId);
  const parentRelative = String(parentRelativePath || "").trim();
  const name = sanitizeEntryName(nameRaw);
  const parentAbsolutePath = resolveInside(bookRoot, parentRelative || ".");
  const parentStats = await fs.stat(parentAbsolutePath);

  if (!parentStats.isDirectory()) {
    throw new Error("Selected parent is not a directory.");
  }

  const targetRelativePath = parentRelative ? `${parentRelative}/${name}` : name;
  const targetAbsolutePath = resolveInside(bookRoot, targetRelativePath);

  await fs.mkdir(targetAbsolutePath, { recursive: false });
  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return {
    ok: true,
    path: toProjectRelativePath(bookRoot, targetAbsolutePath),
    type: "directory"
  };
}

async function renameProjectEntry(username, bookId, relativePath, nextNameRaw) {
  const bookRoot = getBookRoot(username, bookId);
  const sourceAbsolutePath = resolveInside(bookRoot, relativePath);
  const sourceRelativePath = toProjectRelativePath(bookRoot, sourceAbsolutePath);

  if (!sourceRelativePath) {
    throw new Error("Project root cannot be renamed.");
  }

  const nextName = sanitizeEntryName(nextNameRaw);
  const sourceParentAbsolutePath = path.dirname(sourceAbsolutePath);
  const sourceParentRelativePath = toProjectRelativePath(bookRoot, sourceParentAbsolutePath);
  const targetRelativePath = sourceParentRelativePath ? `${sourceParentRelativePath}/${nextName}` : nextName;
  const targetAbsolutePath = resolveInside(bookRoot, targetRelativePath);

  await fs.rename(sourceAbsolutePath, targetAbsolutePath);
  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return {
    ok: true,
    path: toProjectRelativePath(bookRoot, targetAbsolutePath)
  };
}

async function deleteProjectEntry(username, bookId, relativePath) {
  const bookRoot = getBookRoot(username, bookId);
  const targetAbsolutePath = resolveInside(bookRoot, relativePath);
  const targetRelativePath = toProjectRelativePath(bookRoot, targetAbsolutePath);

  if (!targetRelativePath) {
    throw new Error("Project root cannot be deleted.");
  }

  const stats = await fs.stat(targetAbsolutePath);

  if (stats.isDirectory()) {
    await fs.rm(targetAbsolutePath, { recursive: true, force: false });
  } else {
    await fs.unlink(targetAbsolutePath);
  }

  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return { ok: true };
}

async function writeProjectBinaryFile(username, bookId, relativePath, base64Content) {
  const bookRoot = getBookRoot(username, bookId);
  const absolutePath = resolveInside(bookRoot, relativePath);
  const parentPath = path.dirname(absolutePath);

  await fs.mkdir(parentPath, { recursive: true });

  const cleanedBase64 = String(base64Content || "").replace(/^data:.*;base64,/, "");
  const buffer = Buffer.from(cleanedBase64, "base64");
  await fs.writeFile(absolutePath, buffer);

  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return {
    ok: true,
    path: toProjectRelativePath(bookRoot, absolutePath)
  };
}

async function moveProjectEntry(username, bookId, relativePath, targetParentRelativePath) {
  const bookRoot = getBookRoot(username, bookId);
  const sourceAbsolutePath = resolveInside(bookRoot, relativePath);
  const sourceRelativePath = toProjectRelativePath(bookRoot, sourceAbsolutePath);

  if (!sourceRelativePath) {
    throw new Error("Project root cannot be moved.");
  }

  const targetParentAbsolutePath = resolveInside(bookRoot, String(targetParentRelativePath || "").trim() || ".");
  const targetParentStats = await fs.stat(targetParentAbsolutePath);

  if (!targetParentStats.isDirectory()) {
    throw new Error("Drop target is not a directory.");
  }

  const sourceStats = await fs.stat(sourceAbsolutePath);
  const targetParentRelative = toProjectRelativePath(bookRoot, targetParentAbsolutePath);

  if (
    sourceStats.isDirectory() &&
    targetParentRelative &&
    (targetParentRelative === sourceRelativePath || targetParentRelative.startsWith(`${sourceRelativePath}/`))
  ) {
    throw new Error("A folder cannot be moved inside itself.");
  }

  const destinationRelativePath = targetParentRelative
    ? `${targetParentRelative}/${path.basename(sourceAbsolutePath)}`
    : path.basename(sourceAbsolutePath);
  const destinationAbsolutePath = resolveInside(bookRoot, destinationRelativePath);

  if (destinationAbsolutePath === sourceAbsolutePath) {
    return { ok: true, path: sourceRelativePath };
  }

  if (await fileExists(destinationAbsolutePath)) {
    throw new Error("Destination already contains an item with the same name.");
  }

  await fs.rename(sourceAbsolutePath, destinationAbsolutePath);
  await refreshMainTeX(bookRoot);
  await touchBook(username, bookId);

  return {
    ok: true,
    path: toProjectRelativePath(bookRoot, destinationAbsolutePath)
  };
}

function mimeToExt(mimeType) {
  if (!mimeType) return "webm";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  return "webm";
}

function extToMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".wav") return "audio/wav";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".mp4") return "audio/mp4";
  if (ext === ".m4a") return "audio/m4a";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".webm") return "audio/webm";
  if (ext === ".flac") return "audio/flac";
  return "application/octet-stream";
}

function buildTranscriptionJobCacheKey(username, bookId, jobId) {
  return `${username}:${bookId}:${jobId}`;
}

function getTranscriptionMetaPath(bookRoot, baseName) {
  return path.join(bookRoot, "transcriptions", `${baseName}.meta.json`);
}

function resolveRecordingSubdirectory(kind, chapterIndex) {
  if (kind === "initial-outline") {
    return "initial-outline";
  }

  if (kind === "chapter-recording") {
    const chapterNumber =
      Number.isFinite(chapterIndex) && Number(chapterIndex) > 0 ? Number(chapterIndex) : 1;
    return path.join("chapters", `chapter-${chapterNumber}`);
  }

  if (kind === "loose-note") {
    return "miscellaneous";
  }

  return "miscellaneous";
}

async function listFilesRecursive(rootDir, relativePrefix = "") {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const output = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    const relativePath = relativePrefix
      ? path.join(relativePrefix, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(absolutePath, relativePath);
      output.push(...nested);
      continue;
    }

    if (entry.isFile()) {
      output.push({ absolutePath, relativePath: relativePath.replaceAll(path.sep, "/") });
    }
  }

  return output;
}

function toPublicTranscriptionJob(job) {
  return {
    id: job.id,
    baseName: job.baseName,
    model: job.model,
    status: job.status,
    recordingPath: job.recordingPath,
    transcriptionPath: job.transcriptionPath,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    fileSizeBytes: job.fileSizeBytes
  };
}

async function persistTranscriptionJob(job) {
  const metaPayload = {
    id: job.id,
    username: job.username,
    bookId: job.bookId,
    baseName: job.baseName,
    model: job.model,
    status: job.status,
    recordingPath: job.recordingPath,
    transcriptionPath: job.transcriptionPath,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error || null,
    fileSizeBytes: job.fileSizeBytes
  };

  await writeJson(job.metaPath, metaPayload);
}

async function parseTranscriptionResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const json = await response.json();
    if (typeof json?.text === "string") {
      return json.text;
    }
    return JSON.stringify(json, null, 2);
  }

  return response.text();
}

async function requestOpenAITranscription({ apiKey, audioPath, mimeType, prompt, language }) {
  const audioBuffer = await fs.readFile(audioPath);

  if (audioBuffer.length > OPENAI_TRANSCRIPTION_UPLOAD_LIMIT_BYTES) {
    throw new Error("Recording exceeds 25 MB. Split the audio into smaller chunks before transcribing.");
  }

  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });

  form.append("file", blob, path.basename(audioPath));
  form.append("model", OPENAI_TRANSCRIPTION_MODEL);
  form.append("response_format", "json");

  if (language) {
    form.append("language", language);
  }

  if (prompt) {
    form.append("prompt", prompt);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20 * 60 * 1000);

  try {
    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form,
      signal: controller.signal
    });

    if (!response.ok) {
      const errorMessage = await parseOpenAIError(response);
      throw new Error(`OpenAI transcription failed: ${errorMessage}`);
    }

    return parseTranscriptionResponse(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function setJobStatus(job, status, errorMessage = "") {
  job.status = status;
  job.updatedAt = new Date().toISOString();
  job.error = errorMessage || null;

  const cacheKey = buildTranscriptionJobCacheKey(job.username, job.bookId, job.id);
  transcriptionJobs.set(cacheKey, job);
  await persistTranscriptionJob(job);
}

async function runTranscriptionJob(job, apiKey, prompt, language) {
  try {
    await setJobStatus(job, "in_progress");

    const text = await requestOpenAITranscription({
      apiKey,
      audioPath: job.recordingAbsolutePath,
      mimeType: job.mimeType,
      prompt,
      language
    });

    const normalizedText = String(text || "").trim() || "[Empty transcription returned by OpenAI]";
    await fs.writeFile(job.transcriptionAbsolutePath, `${normalizedText}\n`, "utf8");

    await setJobStatus(job, "completed");
    await touchBook(job.username, job.bookId);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);

    let current = "";
    try {
      current = await fs.readFile(job.transcriptionAbsolutePath, "utf8");
    } catch {
      // Ignore missing file.
    }

    const failureBlock = `\n\nAutomatic transcription failed:\n${message}\n`;
    await fs.writeFile(job.transcriptionAbsolutePath, `${current.trim()}${failureBlock}`.trim(), "utf8");

    await setJobStatus(job, "failed", message);
    await touchBook(job.username, job.bookId);
  }
}

async function listTranscriptionJobs(username, bookId) {
  const bookRoot = getBookRoot(username, bookId);
  const transcriptionsRoot = path.join(bookRoot, "transcriptions");
  await ensureDir(transcriptionsRoot);

  const output = new Map();
  const entries = await fs.readdir(transcriptionsRoot, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".meta.json")) continue;

    const metaPath = path.join(transcriptionsRoot, entry.name);
    try {
      const raw = await readJson(metaPath);
      if (!raw?.id) continue;
      output.set(raw.id, {
        id: raw.id,
        baseName: raw.baseName,
        model: raw.model || OPENAI_TRANSCRIPTION_MODEL,
        status: raw.status || "queued",
        recordingPath: raw.recordingPath,
        transcriptionPath: raw.transcriptionPath,
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
        error: raw.error || null,
        fileSizeBytes: raw.fileSizeBytes || 0
      });
    } catch {
      // Ignore malformed metadata.
    }
  }

  for (const job of transcriptionJobs.values()) {
    if (job.username !== username || job.bookId !== bookId) continue;
    output.set(job.id, toPublicTranscriptionJob(job));
  }

  return [...output.values()].sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );
}

async function queueTranscriptionJob(payload) {
  const {
    username,
    bookId,
    bookRoot,
    baseName,
    recordingAbsolutePath,
    recordingPath,
    transcriptionAbsolutePath,
    transcriptionPath,
    mimeType,
    prompt,
    language
  } = payload;

  const profile = await readUserProfilePrivate(username);
  const apiKey = profile.integrations.openAIApiKey.trim();

  if (!apiKey || profile.integrations.autoTranscribe === false) {
    return null;
  }

  let fileSizeBytes = 0;
  try {
    const stats = await fs.stat(recordingAbsolutePath);
    fileSizeBytes = stats.size;
  } catch {
    // Ignore stat failures.
  }

  const now = new Date().toISOString();
  const job = {
    id: uuidv4(),
    username,
    bookId,
    baseName,
    model: OPENAI_TRANSCRIPTION_MODEL,
    status: "queued",
    recordingPath,
    transcriptionPath,
    recordingAbsolutePath,
    transcriptionAbsolutePath,
    metaPath: getTranscriptionMetaPath(bookRoot, baseName),
    mimeType,
    createdAt: now,
    updatedAt: now,
    error: null,
    fileSizeBytes
  };

  const cacheKey = buildTranscriptionJobCacheKey(username, bookId, job.id);
  transcriptionJobs.set(cacheKey, job);
  await persistTranscriptionJob(job);

  if (fileSizeBytes > OPENAI_TRANSCRIPTION_UPLOAD_LIMIT_BYTES) {
    const oversizedMessage = "Recording exceeds 25 MB. Split the audio into smaller chunks before transcribing.";
    await fs.writeFile(
      transcriptionAbsolutePath,
      `Automatic transcription skipped:\n${oversizedMessage}\n`,
      "utf8"
    );
    await setJobStatus(job, "failed", oversizedMessage);
    return toPublicTranscriptionJob(job);
  }

  setImmediate(() => {
    runTranscriptionJob(job, apiKey, prompt, language).catch(() => {
      // Errors are already persisted in runTranscriptionJob.
    });
  });

  return toPublicTranscriptionJob(job);
}

async function saveRecording(payload) {
  const { username, bookId, kind, chapterIndex, transcript, audioBase64, mimeType } = payload;
  const bookRoot = getBookRoot(username, bookId);

  const recordingsRoot = path.join(bookRoot, "recordings");
  const transcriptionsRoot = path.join(bookRoot, "transcriptions");
  await ensureDir(recordingsRoot);
  await ensureDir(transcriptionsRoot);

  const timestamp = Date.now();
  const safeKind = String(kind || "loose-note")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-");
  const chapterLabel = chapterIndex ? `-chapter-${chapterIndex}` : "";
  const baseName = `${timestamp}-${safeKind}${chapterLabel}`;
  const recordingSubdirectory = resolveRecordingSubdirectory(safeKind, chapterIndex);

  const hasAudioBlob = Boolean(audioBase64);
  const audioExt = mimeToExt(mimeType);
  const recordingFile = hasAudioBlob ? `${baseName}.${audioExt}` : `${baseName}.txt`;
  const recordingAbsolutePath = path.join(recordingsRoot, recordingSubdirectory, recordingFile);
  await ensureDir(path.dirname(recordingAbsolutePath));

  if (hasAudioBlob) {
    const cleaned = String(audioBase64).replace(/^data:.*;base64,/, "");
    const buffer = Buffer.from(cleaned, "base64");
    await fs.writeFile(recordingAbsolutePath, buffer);
  } else {
    await fs.writeFile(
      recordingAbsolutePath,
      "No audio captured. Add manual transcript notes or capture microphone audio.",
      "utf8"
    );
  }

  const transcriptionFile = `${baseName}.txt`;
  const transcriptionAbsolutePath = path.join(transcriptionsRoot, recordingSubdirectory, transcriptionFile);
  await ensureDir(path.dirname(transcriptionAbsolutePath));

  const transcriptText = String(transcript || "").trim();
  const baseTranscriptionText = transcriptText
    ? transcriptText
    : "Transcription pending. If OpenAI key is configured, this will auto-fill soon.";

  await fs.writeFile(transcriptionAbsolutePath, `${baseTranscriptionText}\n`, "utf8");

  let transcriptionJob = null;

  if (hasAudioBlob) {
    transcriptionJob = await queueTranscriptionJob({
      username,
      bookId,
      bookRoot,
      baseName,
      recordingAbsolutePath,
      recordingPath: path.relative(bookRoot, recordingAbsolutePath).replaceAll(path.sep, "/"),
      transcriptionAbsolutePath,
      transcriptionPath: path.relative(bookRoot, transcriptionAbsolutePath).replaceAll(path.sep, "/"),
      mimeType: mimeType || extToMime(recordingAbsolutePath),
      prompt: transcriptText || undefined,
      language: undefined
    });
  }

  await touchBook(username, bookId);

  return {
    name: baseName,
    kind: safeKind,
    chapterIndex: chapterIndex || null,
    createdAt: new Date(timestamp).toISOString(),
    recordingPath: path.relative(bookRoot, recordingAbsolutePath).replaceAll(path.sep, "/"),
    transcriptionPath: path.relative(bookRoot, transcriptionAbsolutePath).replaceAll(path.sep, "/"),
    transcriptionJob
  };
}

async function listRecordings(username, bookId) {
  const bookRoot = getBookRoot(username, bookId);
  const recordingsRoot = path.join(bookRoot, "recordings");
  const transcriptionsRoot = path.join(bookRoot, "transcriptions");
  await ensureDir(recordingsRoot);
  await ensureDir(transcriptionsRoot);

  const recordingEntries = await listFilesRecursive(recordingsRoot);
  const transcriptionEntries = await listFilesRecursive(transcriptionsRoot);

  const recordings = recordingEntries
    .map((entry) => {
      const baseName = path.basename(entry.relativePath);
      const parts = baseName.split("-");
      const maybeTime = Number(parts[0]);
      const date = Number.isFinite(maybeTime) ? new Date(maybeTime).toISOString() : null;
      return {
        fileName: entry.relativePath,
        path: `recordings/${entry.relativePath}`,
        createdAt: date
      };
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const transcriptions = transcriptionEntries
    .filter((entry) => !entry.relativePath.endsWith(".meta.json"))
    .map((entry) => ({
      fileName: entry.relativePath,
      path: `transcriptions/${entry.relativePath}`
    }))
    .sort((a, b) => b.fileName.localeCompare(a.fileName));

  const jobs = await listTranscriptionJobs(username, bookId);

  return { recordings, transcriptions, jobs };
}

function sanitizeLogLine(value) {
  return String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\r/g, "");
}

function appendWriteBookLog(session, tone, text) {
  const now = new Date().toISOString();
  const normalizedTone = tone === "error" ? "error" : tone === "success" ? "success" : "info";
  const lines = String(text || "")
    .split("\n")
    .map((line) => sanitizeLogLine(line))
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    lines.push("");
  }

  lines.forEach((line) => {
    session.logs.push({
      index: session.nextLogIndex++,
      at: now,
      tone: normalizedTone,
      text: line.slice(0, WRITE_BOOK_LOG_LINE_LENGTH_LIMIT)
    });
  });

  while (session.logs.length > WRITE_BOOK_LOG_LINE_LIMIT) {
    session.logs.shift();
  }
}

function buildWriteBookSessionPublic(session, afterLogIndex = 0) {
  const fromIndex = Number.isFinite(afterLogIndex) ? Number(afterLogIndex) : 0;
  const matchingLogs = session.logs.filter((entry) => entry.index >= fromIndex);
  const logs = matchingLogs.slice(0, WRITE_BOOK_POLL_LOG_LIMIT);
  const nextLogIndex = logs.length > 0 ? logs[logs.length - 1].index + 1 : fromIndex;
  const hasMoreLogs = matchingLogs.length > logs.length;

  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    completedAt: session.completedAt || null,
    threadId: session.threadId || null,
    currentChapterIndex: session.currentChapterIndex,
    totalChapters: session.totalChapters,
    error: session.error || null,
    logs,
    nextLogIndex: hasMoreLogs ? nextLogIndex : session.nextLogIndex,
    hasMoreLogs
  };
}

function hasPathPrefix(candidate, prefix) {
  const cleanCandidate = String(candidate || "").replaceAll("\\", "/");
  const cleanPrefix = String(prefix || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!cleanPrefix) return cleanCandidate.length > 0;
  return cleanCandidate === cleanPrefix || cleanCandidate.startsWith(`${cleanPrefix}/`);
}

async function readTextOrEmpty(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function getWriteBookChecklist(username, bookId) {
  const bookRoot = getBookRoot(username, bookId);
  await assertBookExists(bookRoot, bookId);
  await ensureLatexScaffold(bookRoot);

  const bookMetaPath = path.join(bookRoot, "book.json");
  let bookTitle = "Untitled Book";
  try {
    const meta = await readJson(bookMetaPath);
    if (typeof meta?.title === "string" && meta.title.trim()) {
      bookTitle = meta.title.trim();
    }
  } catch {
    // Ignore malformed metadata and keep fallback title.
  }

  const chapters = await listChapterDescriptors(bookRoot);
  const recordingsRoot = path.join(bookRoot, "recordings");
  const transcriptionsRoot = path.join(bookRoot, "transcriptions");
  await ensureDir(recordingsRoot);
  await ensureDir(transcriptionsRoot);

  const recordingEntries = await listFilesRecursive(recordingsRoot);
  const transcriptionEntries = (await listFilesRecursive(transcriptionsRoot)).filter(
    (entry) => !entry.relativePath.endsWith(".meta.json")
  );

  const initialOutlineRecordingPaths = recordingEntries
    .filter((entry) => hasPathPrefix(entry.relativePath, "initial-outline"))
    .map((entry) => `recordings/${entry.relativePath}`);
  const initialOutlineTranscriptionPaths = transcriptionEntries
    .filter((entry) => hasPathPrefix(entry.relativePath, "initial-outline"))
    .map((entry) => `transcriptions/${entry.relativePath}`);
  const initialOutlineCount = initialOutlineRecordingPaths.length + initialOutlineTranscriptionPaths.length;

  const chapterDiagnostics = [];
  for (const chapter of chapters) {
    const chapterFolder = `chapters/chapter-${chapter.index}`;
    const chapterRecordingPaths = recordingEntries
      .filter((entry) => hasPathPrefix(entry.relativePath, chapterFolder))
      .map((entry) => `recordings/${entry.relativePath}`);
    const chapterTranscriptionPaths = transcriptionEntries
      .filter((entry) => hasPathPrefix(entry.relativePath, chapterFolder))
      .map((entry) => `transcriptions/${entry.relativePath}`);

    const texAbsolutePath = resolveInside(bookRoot, chapter.texRelativePath);
    const texContent = await readTextOrEmpty(texAbsolutePath);
    const hasSeedText = texContent.trim().length > 0;

    chapterDiagnostics.push({
      index: chapter.index,
      texPath: chapter.texRelativePath,
      hasSeedText,
      recordingCount: chapterRecordingPaths.length,
      transcriptionCount: chapterTranscriptionPaths.length,
      hasVoiceMaterial: chapterRecordingPaths.length > 0 || chapterTranscriptionPaths.length > 0,
      recordingPaths: chapterRecordingPaths,
      transcriptionPaths: chapterTranscriptionPaths
    });
  }

  const missingVoiceChapterIndexes = chapterDiagnostics
    .filter((chapter) => !chapter.hasVoiceMaterial)
    .map((chapter) => chapter.index);
  const missingSeedChapterIndexes = chapterDiagnostics
    .filter((chapter) => !chapter.hasSeedText)
    .map((chapter) => chapter.index);

  const checks = [
    {
      id: "initial-outline-material",
      label: "Initial outline material",
      ok: initialOutlineCount > 0,
      blocking: false,
      details:
        initialOutlineCount > 0
          ? `${initialOutlineCount} initial-outline file(s) detected.`
          : "No initial-outline recordings/transcriptions found yet."
    },
    {
      id: "chapters-exist",
      label: "Chapter folders",
      ok: chapterDiagnostics.length > 0,
      blocking: false,
      details:
        chapterDiagnostics.length > 0
          ? `${chapterDiagnostics.length} chapter folder(s) detected.`
          : "No chapters found. Create at least one chapter before writing."
    },
    {
      id: "chapter-voice-material",
      label: "Voice material per chapter",
      ok: missingVoiceChapterIndexes.length === 0 && chapterDiagnostics.length > 0,
      blocking: false,
      details:
        missingVoiceChapterIndexes.length === 0
          ? "Every chapter has recordings or transcriptions."
          : `Missing chapter voice material for: ${missingVoiceChapterIndexes.join(", ")}.`
    },
    {
      id: "chapter-seed-text",
      label: "Chapter seed text exists",
      ok: missingSeedChapterIndexes.length === 0 && chapterDiagnostics.length > 0,
      blocking: false,
      details:
        missingSeedChapterIndexes.length === 0
          ? "Each chapter .tex file has some content."
          : `Empty chapter tex files: ${missingSeedChapterIndexes.join(", ")}.`
    }
  ];

  const minimumRecommendedReady =
    chapterDiagnostics.length > 0 && initialOutlineCount > 0 && missingVoiceChapterIndexes.length === 0;

  return {
    generatedAt: new Date().toISOString(),
    bookTitle,
    checks,
    minimumRecommendedReady,
    initialOutlineRecordingPaths,
    initialOutlineTranscriptionPaths,
    chapters: chapterDiagnostics
  };
}

async function checkCodexAvailability() {
  const checkedAt = new Date().toISOString();

  try {
    const { command: codexCommand, versionResult } = await resolveCodexCommand();
    const helpResult = await runCommand(codexCommand, ["--help"], process.cwd(), 15000);
    const loginStatusResult = await runCommand(codexCommand, ["login", "status"], process.cwd(), 15000);

    if (versionResult.code !== 0) {
      return {
        checkedAt,
        installed: false,
        authenticated: false,
        version: null,
        helpPreview: "",
        loginStatus: "",
        message: trimLogTail(versionResult.stderr || versionResult.stdout || "codex --version failed.")
      };
    }

    const loginText = sanitizeLogLine(`${loginStatusResult.stdout}\n${loginStatusResult.stderr}`).trim();
    const authenticated =
      loginStatusResult.code === 0 && !/(not\s+logged\s+in|logged\s+out)/i.test(loginText);

    return {
      checkedAt,
      installed: true,
      authenticated,
      command: codexCommand,
      version: sanitizeLogLine(versionResult.stdout || versionResult.stderr).trim() || null,
      helpPreview: sanitizeLogLine(helpResult.stdout || helpResult.stderr)
        .split("\n")
        .slice(0, 16)
        .join("\n")
        .trim(),
      loginStatus: loginText || "No login status output.",
      message: authenticated
        ? "Codex is installed and authenticated."
        : "Codex is installed, but no active login was detected."
    };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const notInstalled = /ENOENT|not found/i.test(message);
    return {
      checkedAt,
      installed: false,
      authenticated: false,
      version: null,
      helpPreview: "",
      loginStatus: "",
      message: notInstalled
        ? "Codex CLI is not installed or not available on PATH."
        : `Unable to check Codex: ${message}`
    };
  }
}

function applyPromptVariables(template, variables) {
  return String(template || "").replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_full, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : ""
  );
}

async function loadCodexPromptTemplates() {
  const readPrompt = async (fileName) =>
    readTextOrEmpty(path.join(CODEX_PROMPTS_ROOT, fileName)).then((value) => value.trim());

  return {
    bookContext: await readPrompt(CODEX_PROMPT_FILES.bookContext),
    firstChapter: await readPrompt(CODEX_PROMPT_FILES.firstChapter),
    nextChapter: await readPrompt(CODEX_PROMPT_FILES.nextChapter),
    verifyMainTex: await readPrompt(CODEX_PROMPT_FILES.verifyMainTex)
  };
}

function buildChapterPrompt({
  isFirstChapter,
  bookTitle,
  chapter,
  totalChapters,
  chapterOverview,
  initialOutlineOverview,
  promptTemplates
}) {
  const baseVariables = {
    BOOK_TITLE: bookTitle,
    CHAPTER_INDEX: String(chapter.index),
    CHAPTER_FILE: chapter.texPath,
    TOTAL_CHAPTERS: String(totalChapters),
    CHAPTER_OVERVIEW: chapterOverview,
    CHAPTER_TRANSCRIPTIONS:
      chapter.transcriptionPaths.length > 0
        ? chapter.transcriptionPaths.map((item) => `- ${item}`).join("\n")
        : "- (none found)",
    CHAPTER_RECORDINGS:
      chapter.recordingPaths.length > 0
        ? chapter.recordingPaths.map((item) => `- ${item}`).join("\n")
        : "- (none found)",
    INITIAL_OUTLINE_FILES: initialOutlineOverview
  };

  const defaultFirstPrompt = [
    `You are drafting the book "${bookTitle}" inside this workspace.`,
    "",
    "Context:",
    chapterOverview,
    "",
    "Initial outline material:",
    initialOutlineOverview,
    "",
    `Write Chapter ${chapter.index} now.`,
    `- Target LaTeX file: ${chapter.texPath}`,
    "- Use transcriptions as the source of truth for facts and claims.",
    "- Keep LaTeX valid and keep existing project structure intact.",
    "- Write directly into the target file.",
    "- If evidence is missing, keep prose conservative and avoid inventing facts.",
    "",
    "Chapter transcriptions:",
    baseVariables.CHAPTER_TRANSCRIPTIONS,
    "",
    "Chapter recordings:",
    baseVariables.CHAPTER_RECORDINGS,
    "",
    "After writing, return a short summary of what you changed."
  ].join("\n");

  const defaultNextPrompt = [
    `Continue in the same thread and write Chapter ${chapter.index}.`,
    `- Target LaTeX file: ${chapter.texPath}`,
    "- Keep continuity with the previous chapters.",
    "- Use chapter transcriptions as source truth.",
    "- Write directly into the target file and keep LaTeX valid.",
    "",
    "Chapter transcriptions:",
    baseVariables.CHAPTER_TRANSCRIPTIONS,
    "",
    "Chapter recordings:",
    baseVariables.CHAPTER_RECORDINGS,
    "",
    "Then return a short summary."
  ].join("\n");

  const bookContextPrompt = promptTemplates.bookContext
    ? applyPromptVariables(promptTemplates.bookContext, baseVariables)
    : "";
  const taskPromptTemplate = isFirstChapter ? promptTemplates.firstChapter : promptTemplates.nextChapter;
  const fallbackTaskPrompt = isFirstChapter ? defaultFirstPrompt : defaultNextPrompt;
  const taskPrompt = taskPromptTemplate
    ? applyPromptVariables(taskPromptTemplate, baseVariables)
    : fallbackTaskPrompt;

  return [bookContextPrompt, taskPrompt].filter(Boolean).join("\n\n");
}

function buildVerifyMainTexPrompt({
  bookTitle,
  totalChapters,
  chapterOverview,
  promptTemplates
}) {
  const variables = {
    BOOK_TITLE: bookTitle,
    TOTAL_CHAPTERS: String(totalChapters),
    CHAPTER_OVERVIEW: chapterOverview,
    MAIN_TEX_FILE: "main.tex"
  };

  const fallbackPrompt = [
    `Final verification step for "${bookTitle}".`,
    "",
    "Open and validate `main.tex`.",
    "- Ensure chapter includes match existing chapter files.",
    "- Ensure cover/back page includes are intact.",
    "- Keep LaTeX structure consistent and valid.",
    "- If mismatches exist, fix `main.tex` directly.",
    "",
    "Chapter map:",
    chapterOverview,
    "",
    "Return a concise summary of any fixes."
  ].join("\n");

  if (!promptTemplates.verifyMainTex) {
    return fallbackPrompt;
  }

  return applyPromptVariables(promptTemplates.verifyMainTex, variables);
}

function formatChapterOverview(chapters) {
  if (chapters.length === 0) return "- (no chapters found)";

  return chapters
    .map(
      (chapter) =>
        `- Chapter ${chapter.index}: ${chapter.texPath} | recordings=${chapter.recordingCount} | transcriptions=${chapter.transcriptionCount}`
    )
    .join("\n");
}

function formatInitialOutlineOverview(checklist) {
  const lines = [
    ...checklist.initialOutlineTranscriptionPaths.map((item) => `- ${item}`),
    ...checklist.initialOutlineRecordingPaths.map((item) => `- ${item}`)
  ];
  if (lines.length === 0) return "- (none found)";
  return lines.slice(0, 40).join("\n");
}

function logCodexItemEvent(session, eventType, item, commandOutputOffsets) {
  if (item.type === "command_execution") {
    if (eventType === "item.started") {
      appendWriteBookLog(session, "info", `$ ${item.command}`);
    }

    const output = sanitizeLogLine(item.aggregated_output || "");
    const previousLength = commandOutputOffsets.get(item.id) || 0;
    if (output.length > previousLength) {
      const diff = output.slice(previousLength);
      appendWriteBookLog(session, "info", diff);
    }
    commandOutputOffsets.set(item.id, output.length);

    if (eventType === "item.completed") {
      const exit = Number.isFinite(item.exit_code) ? item.exit_code : "unknown";
      const tone = item.status === "failed" ? "error" : "info";
      appendWriteBookLog(session, tone, `[command ${item.status}] exit=${exit}`);
    }
    return;
  }

  if (eventType !== "item.completed") return;

  if (item.type === "agent_message") {
    appendWriteBookLog(session, "success", item.text || "[agent message]");
    return;
  }

  if (item.type === "file_change") {
    const files = (item.changes || []).map((change) => `${change.kind}: ${change.path}`).join("\n");
    appendWriteBookLog(
      session,
      item.status === "failed" ? "error" : "info",
      files ? `[file_change]\n${files}` : "[file_change] completed"
    );
    return;
  }

  if (item.type === "reasoning") {
    appendWriteBookLog(session, "info", `[reasoning] ${item.text || ""}`);
    return;
  }

  if (item.type === "mcp_tool_call") {
    const outcome = item.status === "failed" ? `failed: ${item.error?.message || "unknown error"}` : item.status;
    appendWriteBookLog(session, item.status === "failed" ? "error" : "info", `[mcp] ${item.server}/${item.tool}: ${outcome}`);
    return;
  }

  if (item.type === "web_search") {
    appendWriteBookLog(session, "info", `[web_search] ${item.query}`);
    return;
  }

  if (item.type === "todo_list") {
    const lines = item.items
      .map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.text}`)
      .join("\n");
    appendWriteBookLog(session, "info", lines ? `[todo]\n${lines}` : "[todo]");
    return;
  }

  if (item.type === "error") {
    appendWriteBookLog(session, "error", item.message || "Codex error item.");
  }
}

async function runCodexTurn(session, thread, prompt) {
  const commandOutputOffsets = new Map();
  const turnAbortController = new AbortController();
  session.activeAbortController = turnAbortController;

  const streamedTurn = await thread.runStreamed(prompt, { signal: turnAbortController.signal });

  try {
    for await (const event of streamedTurn.events) {
      session.updatedAt = new Date().toISOString();

      if (session.cancelRequested) {
        turnAbortController.abort();
      }

      if (event.type === "thread.started") {
        session.threadId = event.thread_id;
        appendWriteBookLog(session, "info", `Thread started: ${event.thread_id}`);
        continue;
      }

      if (event.type === "turn.started") {
        appendWriteBookLog(session, "info", "Turn started.");
        continue;
      }

      if (event.type === "turn.completed") {
        appendWriteBookLog(
          session,
          "info",
          `Turn completed. Tokens: in=${event.usage.input_tokens}, cached=${event.usage.cached_input_tokens}, out=${event.usage.output_tokens}`
        );
        continue;
      }

      if (event.type === "turn.failed") {
        throw new Error(event.error?.message || "Codex turn failed.");
      }

      if (event.type === "error") {
        throw new Error(event.message || "Codex stream error.");
      }

      if (event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed") {
        logCodexItemEvent(session, event.type, event.item, commandOutputOffsets);
      }
    }
  } finally {
    session.activeAbortController = null;
  }
}

async function runWriteBookSession(session) {
  session.status = "running";
  session.updatedAt = new Date().toISOString();
  appendWriteBookLog(session, "info", "Write Book session started.");

  try {
    const { username, bookId } = session;
    const bookRoot = getBookRoot(username, bookId);

    await assertBookExists(bookRoot, bookId);
    await ensureLatexScaffold(bookRoot);

    const checklist = await getWriteBookChecklist(username, bookId);
    const codexStatus = await checkCodexAvailability();
    if (!codexStatus.installed) {
      throw new Error(
        `${codexStatus.message}\nInstall Codex CLI first (for example: npm i -g @openai/codex) and authenticate with \`codex login\`.`
      );
    }

    appendWriteBookLog(
      session,
      codexStatus.authenticated ? "success" : "info",
      `${codexStatus.version || "codex"}\n${codexStatus.loginStatus || ""}`.trim()
    );
    const codexCommand = String(codexStatus.command || "codex").trim() || "codex";

    const profile = await readUserProfilePrivate(username);
    const apiKey = String(profile.integrations.openAIApiKey || "").trim();

    if (apiKey) {
      appendWriteBookLog(session, "info", "Using API key from local profile for Codex session.");
    } else if (!codexStatus.authenticated) {
      throw new Error("No saved API key and Codex login is not active. Run `codex login` before continuing.");
    }

    const { Codex } = await import("@openai/codex-sdk");
    const isWindowsCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(codexCommand);
    const codexOptions = {
      apiKey: apiKey || undefined
    };
    if (!isWindowsCmdShim) {
      codexOptions.codexPathOverride = codexCommand;
    } else {
      appendWriteBookLog(
        session,
        "info",
        `Detected Windows shell shim (${codexCommand}); using Codex SDK default command resolution for runtime.`
      );
    }
    const codex = new Codex(codexOptions);

    const thread = codex.startThread({
      sandboxMode: "workspace-write",
      workingDirectory: bookRoot,
      networkAccessEnabled: false,
      approvalPolicy: "never",
      skipGitRepoCheck: true
    });

    const chapterOverview = formatChapterOverview(checklist.chapters);
    const initialOutlineOverview = formatInitialOutlineOverview(checklist);
    const templates = await loadCodexPromptTemplates();

    if (checklist.chapters.length === 0) {
      throw new Error("No chapters found. Create chapter folders first.");
    }

    session.totalChapters = checklist.chapters.length;
    appendWriteBookLog(
      session,
      "info",
      `Scoped permissions: sandbox=workspace-write, workingDirectory=${bookRoot}, networkAccessEnabled=false`
    );

    for (let i = 0; i < checklist.chapters.length; i += 1) {
      if (session.cancelRequested) {
        throw new Error("Write Book session cancelled.");
      }

      const chapter = checklist.chapters[i];
      session.currentChapterIndex = chapter.index;
      session.updatedAt = new Date().toISOString();

      const prompt = buildChapterPrompt({
        isFirstChapter: i === 0,
        bookTitle: checklist.bookTitle,
        chapter,
        totalChapters: checklist.chapters.length,
        chapterOverview,
        initialOutlineOverview,
        promptTemplates: templates
      });

      appendWriteBookLog(
        session,
        "info",
        `Running Codex for Chapter ${chapter.index}/${checklist.chapters.length} -> ${chapter.texPath}`
      );
      await runCodexTurn(session, thread, prompt);

      if (thread.id) {
        session.threadId = thread.id;
      }
      appendWriteBookLog(session, "success", `Chapter ${chapter.index} turn completed.`);
    }

    appendWriteBookLog(session, "info", "Running final `main.tex` verification step.");
    const verifyMainTexPrompt = buildVerifyMainTexPrompt({
      bookTitle: checklist.bookTitle,
      totalChapters: checklist.chapters.length,
      chapterOverview,
      promptTemplates: templates
    });
    await runCodexTurn(session, thread, verifyMainTexPrompt);
    appendWriteBookLog(session, "success", "Final `main.tex` verification completed.");

    await touchBook(username, bookId);
    session.status = "completed";
    session.completedAt = new Date().toISOString();
    session.updatedAt = session.completedAt;
    appendWriteBookLog(session, "success", "Write Book process completed.");
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);

    if (session.cancelRequested || /cancelled/i.test(message)) {
      session.status = "cancelled";
      session.error = null;
      appendWriteBookLog(session, "info", "Write Book process cancelled.");
    } else {
      session.status = "failed";
      session.error = message;
      appendWriteBookLog(session, "error", message);
    }

    session.completedAt = new Date().toISOString();
    session.updatedAt = session.completedAt;
  }
}

async function startWriteBookSession(username, bookId) {
  const activeSession = [...writeBookSessions.values()].find(
    (session) =>
      session.username === username &&
      session.bookId === bookId &&
      (session.status === "queued" || session.status === "running")
  );

  if (activeSession) {
    return {
      sessionId: activeSession.id,
      startedAt: activeSession.startedAt
    };
  }

  const checklist = await getWriteBookChecklist(username, bookId);
  const now = new Date().toISOString();
  const session = {
    id: uuidv4(),
    username,
    bookId,
    status: "queued",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    error: null,
    threadId: null,
    currentChapterIndex: null,
    totalChapters: checklist.chapters.length,
    logs: [],
    nextLogIndex: 0,
    cancelRequested: false,
    activeAbortController: null
  };

  writeBookSessions.set(session.id, session);
  appendWriteBookLog(session, "info", `Queued Write Book session for "${checklist.bookTitle}".`);

  setImmediate(() => {
    runWriteBookSession(session).catch((error) => {
      const message = String(error instanceof Error ? error.message : error);
      session.status = "failed";
      session.error = message;
      session.completedAt = new Date().toISOString();
      session.updatedAt = session.completedAt;
      appendWriteBookLog(session, "error", message);
    });
  });

  return {
    sessionId: session.id,
    startedAt: session.startedAt
  };
}

function getWriteBookSession(sessionId, afterLogIndex = 0) {
  const session = writeBookSessions.get(String(sessionId || ""));
  if (!session) {
    throw new Error("Write Book session not found.");
  }

  return buildWriteBookSessionPublic(session, afterLogIndex);
}

function cancelWriteBookSession(sessionId) {
  const session = writeBookSessions.get(String(sessionId || ""));
  if (!session) {
    throw new Error("Write Book session not found.");
  }

  if (session.status === "completed" || session.status === "failed" || session.status === "cancelled") {
    return { ok: true, status: session.status };
  }

  session.cancelRequested = true;
  session.updatedAt = new Date().toISOString();
  appendWriteBookLog(session, "info", "Cancellation requested.");

  if (session.activeAbortController) {
    session.activeAbortController.abort();
  }

  return { ok: true, status: session.status };
}

async function triggerWriteMyBook(username, bookId) {
  const started = await startWriteBookSession(username, bookId);
  await touchBook(username, bookId);

  return {
    startedAt: started.startedAt,
    status: "queued",
    sessionId: started.sessionId,
    message: "Write Book session queued. Poll the write session endpoint for live output."
  };
}

function registerIpcHandlers() {
  ipcMain.handle("user:create", async (_event, username) => ensureUser(username));
  ipcMain.handle("user:listBooks", async (_event, username) => listBooks(normalizeUserName(username)));
  ipcMain.handle("user:getProfile", async (_event, username) => getUserProfile(normalizeUserName(username)));
  ipcMain.handle("user:updateProfile", async (_event, payload) =>
    updateUserProfile({ ...payload, username: normalizeUserName(payload.username) })
  );
  ipcMain.handle("user:testOpenAIKey", async (_event, payload) =>
    testOpenAIApiKey({ ...payload, username: normalizeUserName(payload.username) })
  );

  ipcMain.handle("book:create", async (_event, payload) => {
    const { username, title } = payload;
    return createBook(normalizeUserName(username), title);
  });
  ipcMain.handle("book:rename", async (_event, payload) => {
    const { username, bookId, title } = payload;
    return renameBook(normalizeUserName(username), bookId, title);
  });
  ipcMain.handle("book:getTree", async (_event, payload) => {
    const { username, bookId } = payload;
    return getBookTree(normalizeUserName(username), bookId);
  });
  ipcMain.handle("book:createChapter", async (_event, payload) => {
    const { username, bookId } = payload;
    return createChapter(normalizeUserName(username), bookId);
  });
  ipcMain.handle("book:readFile", async (_event, payload) => {
    const { username, bookId, relativePath } = payload;
    return readProjectFile(normalizeUserName(username), bookId, relativePath);
  });
  ipcMain.handle("book:readMediaDataUrl", async (_event, payload) => {
    const { username, bookId, relativePath } = payload;
    return readProjectMediaDataUrl(normalizeUserName(username), bookId, relativePath);
  });
  ipcMain.handle("book:writeFile", async (_event, payload) => {
    const { username, bookId, relativePath, content } = payload;
    return writeProjectFile(normalizeUserName(username), bookId, relativePath, content);
  });
  ipcMain.handle("book:createProjectFile", async (_event, payload) => {
    const { username, bookId, parentRelativePath, name } = payload;
    return createProjectFile(normalizeUserName(username), bookId, parentRelativePath, name);
  });
  ipcMain.handle("book:createProjectDirectory", async (_event, payload) => {
    const { username, bookId, parentRelativePath, name } = payload;
    return createProjectDirectory(normalizeUserName(username), bookId, parentRelativePath, name);
  });
  ipcMain.handle("book:renameProjectEntry", async (_event, payload) => {
    const { username, bookId, relativePath, nextName } = payload;
    return renameProjectEntry(normalizeUserName(username), bookId, relativePath, nextName);
  });
  ipcMain.handle("book:deleteProjectEntry", async (_event, payload) => {
    const { username, bookId, relativePath } = payload;
    return deleteProjectEntry(normalizeUserName(username), bookId, relativePath);
  });
  ipcMain.handle("book:writeBinaryFile", async (_event, payload) => {
    const { username, bookId, relativePath, base64Content } = payload;
    return writeProjectBinaryFile(normalizeUserName(username), bookId, relativePath, base64Content);
  });
  ipcMain.handle("book:moveProjectEntry", async (_event, payload) => {
    const { username, bookId, relativePath, targetParentRelativePath } = payload;
    return moveProjectEntry(normalizeUserName(username), bookId, relativePath, targetParentRelativePath);
  });
  ipcMain.handle("book:saveRecording", async (_event, payload) => {
    return saveRecording({ ...payload, username: normalizeUserName(payload.username) });
  });
  ipcMain.handle("book:listRecordings", async (_event, payload) => {
    const { username, bookId } = payload;
    return listRecordings(normalizeUserName(username), bookId);
  });
  ipcMain.handle("book:compileLatex", async (_event, payload) => {
    const { username, bookId, entryRelativePath } = payload;
    return compileLatex({
      username: normalizeUserName(username),
      bookId,
      entryRelativePath
    });
  });
  ipcMain.handle("book:getWriteBookChecklist", async (_event, payload) => {
    const { username, bookId } = payload;
    return getWriteBookChecklist(normalizeUserName(username), bookId);
  });
  ipcMain.handle("book:checkCodexAvailability", async () => {
    return checkCodexAvailability();
  });
  ipcMain.handle("book:startWriteBookSession", async (_event, payload) => {
    const { username, bookId } = payload;
    return startWriteBookSession(normalizeUserName(username), bookId);
  });
  ipcMain.handle("book:getWriteBookSession", async (_event, payload) => {
    const { sessionId, afterLogIndex } = payload;
    return getWriteBookSession(sessionId, afterLogIndex);
  });
  ipcMain.handle("book:cancelWriteBookSession", async (_event, payload) => {
    const { sessionId } = payload;
    return cancelWriteBookSession(sessionId);
  });
  ipcMain.handle("book:writeMyBook", async (_event, payload) => {
    const { username, bookId } = payload;
    return triggerWriteMyBook(normalizeUserName(username), bookId);
  });
}

function createWindow() {
  const appIconPath = path.join(__dirname, "..", "logo.png");

  if (process.platform === "darwin" && app.dock?.setIcon) {
    app.dock.setIcon(appIconPath);
  }

  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#08131f",
    title: "Fast Chapter",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  win.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "").toLowerCase();
    const isReloadShortcut = (input.control || input.meta) && key === "r";
    const isF5 = key === "f5";

    if (isReloadShortcut || isF5) {
      event.preventDefault();
    }
  });
}

app.whenReady().then(async () => {
  await ensureDir(getUsersRoot());
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
