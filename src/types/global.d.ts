import type {
  BookSummary,
  CodexAvailability,
  FileNode,
  LatexCompileResult,
  RecordingBundle,
  SaveRecordingResult,
  UserProfile,
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
