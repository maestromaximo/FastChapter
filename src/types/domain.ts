export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

export type BookSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type UserProfile = {
  username: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  integrations: {
    hasOpenAIApiKey: boolean;
    autoTranscribe: boolean;
  };
};

export type TranscriptionJob = {
  id: string;
  baseName: string;
  model: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  recordingPath: string;
  transcriptionPath: string;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  fileSizeBytes: number;
};

export type RecordingBundle = {
  recordings: Array<{
    fileName: string;
    path: string;
    createdAt: string | null;
  }>;
  transcriptions: Array<{
    fileName: string;
    path: string;
  }>;
  jobs: TranscriptionJob[];
};

export type SaveRecordingResult = {
  name: string;
  kind: string;
  chapterIndex: number | null;
  createdAt: string;
  recordingPath: string;
  transcriptionPath: string;
  transcriptionJob: TranscriptionJob | null;
};

export type WriteResult = {
  startedAt: string;
  status: string;
  message: string;
  sessionId?: string;
};

export type WriteBookChecklistCheck = {
  id: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  details: string;
};

export type WriteBookChecklistChapter = {
  index: number;
  texPath: string;
  hasSeedText: boolean;
  recordingCount: number;
  transcriptionCount: number;
  hasVoiceMaterial: boolean;
  recordingPaths: string[];
  transcriptionPaths: string[];
};

export type WriteBookChecklist = {
  generatedAt: string;
  bookTitle: string;
  checks: WriteBookChecklistCheck[];
  minimumRecommendedReady: boolean;
  initialOutlineRecordingPaths: string[];
  initialOutlineTranscriptionPaths: string[];
  chapters: WriteBookChecklistChapter[];
};

export type CodexAvailability = {
  checkedAt: string;
  installed: boolean;
  authenticated: boolean;
  command?: string;
  version: string | null;
  helpPreview: string;
  loginStatus: string;
  message: string;
};

export type SetupStatus = {
  checkedAt: string;
  ready: boolean;
  checks: {
    openai: {
      ok: boolean;
      hasSavedKey: boolean;
      message: string;
    };
    codex: {
      ok: boolean;
      installed: boolean;
      authenticated: boolean;
      version: string | null;
      message: string;
    };
    npm: {
      ok: boolean;
      installed: boolean;
      version: string | null;
      message: string;
    };
    latex: {
      ok: boolean;
      available: boolean;
      preferredCompiler: "latexmk" | "pdflatex" | null;
      latexmkInstalled: boolean;
      pdflatexInstalled: boolean;
      message: string;
    };
  };
};

export type PromptTemplateSource = "default" | "custom";

export type PromptTemplate = {
  id: string;
  name: string;
  source: PromptTemplateSource;
  content: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PromptTemplateGroup = {
  promptKey: "bookContext" | "firstChapter" | "nextChapter" | "verifyMainTex";
  label: string;
  activeTemplateId: string;
  templates: PromptTemplate[];
};

export type PromptTemplateLibrary = {
  generatedAt: string;
  prompts: PromptTemplateGroup[];
};

export type WriteBookSessionStart = {
  sessionId: string;
  startedAt: string;
};

export type WriteBookSessionLogLine = {
  index: number;
  at: string;
  tone: "info" | "success" | "error";
  text: string;
};

export type WriteBookSessionSnapshot = {
  sessionId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  threadId: string | null;
  currentChapterIndex: number | null;
  totalChapters: number;
  error: string | null;
  logs: WriteBookSessionLogLine[];
  nextLogIndex: number;
  hasMoreLogs: boolean;
};

export type ExportBookArchiveResult = {
  cancelled: boolean;
  outputPath: string | null;
  includedRecordings: boolean;
  includedTranscriptions: boolean;
  fileCount: number;
};

export type LatexCompileResult = {
  ok: true;
  cached: boolean;
  compiler: "latexmk" | "pdflatex";
  entryRelativePath: string;
  outputRelativePath: string;
  durationMs: number;
  generatedAt: string;
  logTail: string;
  pdfDataUrl: string;
};
