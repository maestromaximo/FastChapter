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
};
