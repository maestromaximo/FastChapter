import type {
  BookSummary,
  CodexAvailability,
  ExportBookArchiveResult,
  FileNode,
  LatexCompileResult,
  PromptTemplateLibrary,
  RecordingBundle,
  SaveRecordingResult,
  SetupStatus,
  UserProfile,
  WorkingDirectoryInfo,
  WorkingDirectorySelectionResult,
  WriteBookChecklist,
  WriteBookSessionSnapshot,
  WriteBookSessionStart,
  WriteResult
} from "@/types/domain";

declare global {
  interface Window {
    fastChapter: {
      createUser: (username: string) => Promise<{ username: string; rootPath: string }>;
      listBooks: (username: string) => Promise<BookSummary[]>;
      getUserProfile: (username: string) => Promise<UserProfile>;
      updateUserProfile: (payload: {
        username: string;
        displayName?: string;
        openAIApiKey?: string;
        clearOpenAIApiKey?: boolean;
        autoTranscribe?: boolean;
      }) => Promise<UserProfile>;
      testOpenAIKey: (payload: { username: string; apiKey?: string }) => Promise<{
        ok: true;
        checkedAt: string;
        message: string;
      }>;
      getSetupStatus: (payload: { username: string }) => Promise<SetupStatus>;
      listPromptTemplates: (payload: { username: string }) => Promise<PromptTemplateLibrary>;
      createPromptTemplateVariant: (payload: {
        username: string;
        promptKey: "bookContext" | "firstChapter" | "nextChapter" | "verifyMainTex";
        name: string;
        content: string;
      }) => Promise<{
        promptKey: string;
        template: {
          id: string;
          name: string;
          source: "custom";
          content: string;
          createdAt: string;
          updatedAt: string;
        };
      }>;
      deletePromptTemplateVariant: (payload: {
        username: string;
        promptKey: "bookContext" | "firstChapter" | "nextChapter" | "verifyMainTex";
        templateId: string;
      }) => Promise<{ ok: true; promptKey: string; activeTemplateId: string }>;
      setActivePromptTemplate: (payload: {
        username: string;
        promptKey: "bookContext" | "firstChapter" | "nextChapter" | "verifyMainTex";
        templateId: string;
      }) => Promise<{ ok: true; promptKey: string; activeTemplateId: string }>;
      getWorkingDirectory: () => Promise<WorkingDirectoryInfo>;
      chooseWorkingDirectory: () => Promise<WorkingDirectorySelectionResult>;
      openExternalUrl: (payload: { url: string }) => Promise<{ ok: true }>;

      createBook: (payload: { username: string; title: string }) => Promise<BookSummary>;
      renameBook: (payload: { username: string; bookId: string; title: string }) => Promise<BookSummary>;
      getBookTree: (payload: { username: string; bookId: string }) => Promise<FileNode[]>;
      createChapter: (payload: { username: string; bookId: string }) => Promise<{ chapterIndex: number; chapterPath: string }>;
      readProjectFile: (payload: { username: string; bookId: string; relativePath: string }) => Promise<string>;
      readProjectMediaDataUrl: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
      }) => Promise<string>;
      writeProjectFile: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
        content: string;
      }) => Promise<{ ok: true }>;
      createProjectFile: (payload: {
        username: string;
        bookId: string;
        parentRelativePath?: string;
        name: string;
      }) => Promise<{ ok: true; path: string; type: "file" }>;
      createProjectDirectory: (payload: {
        username: string;
        bookId: string;
        parentRelativePath?: string;
        name: string;
      }) => Promise<{ ok: true; path: string; type: "directory" }>;
      renameProjectEntry: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
        nextName: string;
      }) => Promise<{ ok: true; path: string }>;
      deleteProjectEntry: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
      }) => Promise<{ ok: true }>;
      writeProjectBinaryFile: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
        base64Content: string;
      }) => Promise<{ ok: true; path: string }>;
      moveProjectEntry: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
        targetParentRelativePath?: string;
      }) => Promise<{ ok: true; path: string }>;
      compileLatex: (payload: {
        username: string;
        bookId: string;
        entryRelativePath?: string;
      }) => Promise<LatexCompileResult>;
      exportBookArchive: (payload: {
        username: string;
        bookId: string;
        includeRecordings?: boolean;
        includeTranscriptions?: boolean;
      }) => Promise<ExportBookArchiveResult>;
      saveRecording: (payload: {
        username: string;
        bookId: string;
        kind: string;
        chapterIndex?: number;
        transcript?: string;
        audioBase64?: string;
        mimeType?: string;
      }) => Promise<SaveRecordingResult>;
      listRecordings: (payload: { username: string; bookId: string }) => Promise<RecordingBundle>;
      getWriteBookChecklist: (payload: { username: string; bookId: string }) => Promise<WriteBookChecklist>;
      checkCodexAvailability: () => Promise<CodexAvailability>;
      startWriteBookSession: (payload: { username: string; bookId: string }) => Promise<WriteBookSessionStart>;
      getWriteBookSession: (payload: {
        sessionId: string;
        afterLogIndex?: number;
      }) => Promise<WriteBookSessionSnapshot>;
      cancelWriteBookSession: (payload: { sessionId: string }) => Promise<{ ok: true; status: string }>;
      writeMyBook: (payload: { username: string; bookId: string }) => Promise<WriteResult>;
    };
  }
}

export {};
