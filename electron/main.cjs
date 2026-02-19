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

const transcriptionJobs = new Map();
const latexCompileCache = new Map();
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
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
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

async function readProjectFile(username, bookId, relativePath) {
  const bookRoot = getBookRoot(username, bookId);
  const absolutePath = resolveInside(bookRoot, relativePath);

  if (!isLikelyTextFile(absolutePath)) {
    throw new Error("Only text file previews are supported in this prototype.");
  }

  return fs.readFile(absolutePath, "utf8");
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

  const hasAudioBlob = Boolean(audioBase64);
  const audioExt = mimeToExt(mimeType);
  const recordingFile = hasAudioBlob ? `${baseName}.${audioExt}` : `${baseName}.txt`;
  const recordingAbsolutePath = path.join(recordingsRoot, recordingFile);

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
  const transcriptionAbsolutePath = path.join(transcriptionsRoot, transcriptionFile);

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

  const recordingEntries = await fs.readdir(recordingsRoot, { withFileTypes: true });
  const transcriptionEntries = await fs.readdir(transcriptionsRoot, { withFileTypes: true });

  const recordings = recordingEntries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const parts = entry.name.split("-");
      const maybeTime = Number(parts[0]);
      const date = Number.isFinite(maybeTime) ? new Date(maybeTime).toISOString() : null;
      return {
        fileName: entry.name,
        path: `recordings/${entry.name}`,
        createdAt: date
      };
    })
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const transcriptions = transcriptionEntries
    .filter((entry) => entry.isFile() && !entry.name.endsWith(".meta.json"))
    .map((entry) => ({
      fileName: entry.name,
      path: `transcriptions/${entry.name}`
    }))
    .sort((a, b) => b.fileName.localeCompare(a.fileName));

  const jobs = await listTranscriptionJobs(username, bookId);

  return { recordings, transcriptions, jobs };
}

async function triggerWriteMyBook(username, bookId) {
  await touchBook(username, bookId);

  return {
    startedAt: new Date().toISOString(),
    status: "queued",
    message:
      "Placeholder execution complete. Next step: connect Codex SDK + OpenAI transcription inputs to generate LaTeX chapters."
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
  ipcMain.handle("book:writeMyBook", async (_event, payload) => {
    const { username, bookId } = payload;
    return triggerWriteMyBook(normalizeUserName(username), bookId);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#08131f",
    title: "Fast Chapter",
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
