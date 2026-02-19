import type {
  BookSummary,
  FileNode,
  RecordingBundle,
  SaveRecordingResult,
  UserProfile,
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
      writeProjectFile: (payload: {
        username: string;
        bookId: string;
        relativePath: string;
        content: string;
      }) => Promise<{ ok: true }>;
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
      writeMyBook: (payload: { username: string; bookId: string }) => Promise<WriteResult>;
    };
  }
}

export {};
