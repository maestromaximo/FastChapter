import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  KeyRound,
  LibraryBig,
  Loader2,
  Mic,
  MicOff,
  MoonStar,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  Sparkles,
  Sun,
  UserCircle2,
  WandSparkles
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { BookSummary, FileNode, RecordingBundle, UserProfile } from "@/types/domain";

type AppScreen = "auth" | "bookshelf" | "workspace" | "profile";

type Notice = {
  tone: "info" | "success" | "error";
  text: string;
};

function isEditableFile(filePath: string) {
  return /\.(tex|txt|md|json|ya?ml)$/i.test(filePath);
}

function formatDate(value: string | null) {
  if (!value) return "unknown";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function buildInitials(username: string | null) {
  if (!username) return "U";
  return username
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function getFirstEditablePath(nodes: FileNode[]): string | null {
  for (const node of nodes) {
    if (node.type === "file" && isEditableFile(node.path)) return node.path;
    if (node.type === "directory" && node.children?.length) {
      const candidate = getFirstEditablePath(node.children);
      if (candidate) return candidate;
    }
  }
  return null;
}

function collectChapterIndexes(nodes: FileNode[]) {
  const values = new Set<number>();
  const walk = (list: FileNode[]) => {
    list.forEach((node) => {
      const match = node.path.match(/^chapters\/chapter-(\d+)/);
      if (match) values.add(Number(match[1]));
      if (node.children?.length) walk(node.children);
    });
  };
  walk(nodes);
  return [...values].sort((a, b) => a - b);
}

function renderTree(
  nodes: FileNode[],
  depth: number,
  collapsed: Record<string, boolean>,
  onToggle: (path: string) => void,
  selectedPath: string | null,
  onSelectFile: (path: string) => void
): JSX.Element[] {
  return nodes.flatMap((node) => {
    const isDir = node.type === "directory";
    const isCollapsed = Boolean(collapsed[node.path]);
    const item = (
      <button
        key={node.path}
        type="button"
        onClick={() => (isDir ? onToggle(node.path) : onSelectFile(node.path))}
        className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
          selectedPath === node.path
            ? "bg-primary/20 text-primary"
            : "text-foreground/80 hover:bg-accent/70 hover:text-foreground"
        }`}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
      >
        {isDir ? (
          <>
            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {isCollapsed ? <Folder className="h-3.5 w-3.5" /> : <FolderOpen className="h-3.5 w-3.5" />}
          </>
        ) : (
          <>
            <span className="h-3.5 w-3.5" />
            <FileText className="h-3.5 w-3.5" />
          </>
        )}
        <span className="truncate">{node.name}</span>
      </button>
    );

    if (!isDir || isCollapsed || !node.children?.length) {
      return [item];
    }

    return [item, ...renderTree(node.children, depth + 1, collapsed, onToggle, selectedPath, onSelectFile)];
  });
}

const THEME_STORAGE_KEY = "fastchapter-theme";
const LAST_USER_STORAGE_KEY = "fastchapter-last-user";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("auth");
  const [notice, setNotice] = useState<Notice | null>(null);

  const [usernameInput, setUsernameInput] = useState("");
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [userRootPath, setUserRootPath] = useState<string>("");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [openAiApiKeyInput, setOpenAiApiKeyInput] = useState("");
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [apiKeyTestMessage, setApiKeyTestMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [profileReturnScreen, setProfileReturnScreen] = useState<"bookshelf" | "workspace">("bookshelf");

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [bookTitleDraft, setBookTitleDraft] = useState("");

  const [isCreateBookOpen, setIsCreateBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");

  const [tree, setTree] = useState<FileNode[]>([]);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const [recordingData, setRecordingData] = useState<RecordingBundle>({
    recordings: [],
    transcriptions: [],
    jobs: []
  });
  const [isRecordingDialogOpen, setIsRecordingDialogOpen] = useState(false);
  const [recordingKind, setRecordingKind] = useState<"initial-outline" | "chapter-recording" | "loose-note">("initial-outline");
  const [recordingChapter, setRecordingChapter] = useState<number>(1);
  const [recordingTranscript, setRecordingTranscript] = useState("");
  const [capturedAudio, setCapturedAudio] = useState<{ base64: string; mimeType: string } | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);

  const chapterIndexes = useMemo(() => collectChapterIndexes(tree), [tree]);
  const hasRecordings = recordingData.recordings.length > 0;
  const editorDirty = editorContent !== lastSavedContent;
  const userInitials = useMemo(() => buildInitials(activeUser), [activeUser]);
  const hasSavedOpenAIKey = Boolean(userProfile?.integrations.hasOpenAIApiKey);
  const autoTranscribeEnabled = userProfile?.integrations.autoTranscribe !== false;
  const activeJobs = recordingData.jobs.filter(
    (job) => job.status === "queued" || job.status === "in_progress"
  );
  const failedJobs = recordingData.jobs.filter((job) => job.status === "failed");

  const refreshBooks = async (username: string) => {
    const result = await window.fastChapter.listBooks(username);
    setBooks(result);
  };

  const refreshProfile = async (username: string) => {
    const profile = await window.fastChapter.getUserProfile(username);
    setUserProfile(profile);
    setApiKeyTestMessage(null);
    return profile;
  };

  const refreshWorkspaceData = async (username: string, bookId: string, keepSelectedPath = true) => {
    const [nextTree, nextRecordings] = await Promise.all([
      window.fastChapter.getBookTree({ username, bookId }),
      window.fastChapter.listRecordings({ username, bookId })
    ]);

    setTree(nextTree);
    setRecordingData(nextRecordings);

    if (!keepSelectedPath) {
      const fallback = getFirstEditablePath(nextTree);
      setSelectedPath(fallback);
    }
  };

  const readAndSetFile = async (pathValue: string) => {
    if (!activeUser || !selectedBook) return;
    if (!isEditableFile(pathValue)) {
      setEditorContent("Preview not available for this file type yet.");
      setLastSavedContent("Preview not available for this file type yet.");
      return;
    }

    const content = await window.fastChapter.readProjectFile({
      username: activeUser,
      bookId: selectedBook.id,
      relativePath: pathValue
    });

    setEditorContent(content);
    setLastSavedContent(content);
  };

  useEffect(() => {
    if (!activeUser) return;
    Promise.all([refreshBooks(activeUser), refreshProfile(activeUser)])
      .then(() => setScreen("bookshelf"))
      .catch((error: unknown) => {
        setNotice({ tone: "error", text: String(error) });
      });
  }, [activeUser]);

  useEffect(() => {
    if (!activeUser || !selectedBook) return;

    setIsBusy(true);
    refreshWorkspaceData(activeUser, selectedBook.id, false)
      .then(async () => {
        setBookTitleDraft(selectedBook.title);
      })
      .catch((error: unknown) => {
        setNotice({ tone: "error", text: String(error) });
      })
      .finally(() => setIsBusy(false));
  }, [activeUser, selectedBook]);

  useEffect(() => {
    if (!selectedPath) return;
    readAndSetFile(selectedPath).catch((error: unknown) => setNotice({ tone: "error", text: String(error) }));
  }, [selectedPath]);

  useEffect(
    () => () => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    []
  );

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    const lastUser = window.localStorage.getItem(LAST_USER_STORAGE_KEY)?.trim();
    if (!lastUser || activeUser) return;

    setUsernameInput(lastUser);
    setIsBusy(true);

    window.fastChapter
      .createUser(lastUser)
      .then((profile) => {
        setActiveUser(profile.username);
        setUserRootPath(profile.rootPath);
        setUserProfile(null);
        setOpenAiApiKeyInput("");
        setApiKeyTestMessage(null);
      })
      .catch(() => {
        window.localStorage.removeItem(LAST_USER_STORAGE_KEY);
      })
      .finally(() => setIsBusy(false));
  }, [activeUser]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!activeUser) return;
    window.localStorage.setItem(LAST_USER_STORAGE_KEY, activeUser);
  }, [activeUser]);

  useEffect(() => {
    setIsProfileMenuOpen(false);
  }, [screen]);

  useEffect(() => {
    if (!activeUser || !selectedBook) return;
    if (activeJobs.length === 0) return;

    const interval = window.setInterval(() => {
      refreshWorkspaceData(activeUser, selectedBook.id).catch(() => {
        // Avoid noisy polling errors in UI; explicit actions still surface errors.
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [activeJobs.length, activeUser, selectedBook]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!isProfileMenuOpen) return;
      if (!profileMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && !profileMenuRef.current.contains(target)) {
        setIsProfileMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handleDocumentClick);
    return () => window.removeEventListener("mousedown", handleDocumentClick);
  }, [isProfileMenuOpen]);

  const handleLocalAccount = async () => {
    const username = usernameInput.trim();
    if (!username) {
      setNotice({ tone: "error", text: "Choose a local username to continue." });
      return;
    }

    try {
      setIsBusy(true);
      const profile = await window.fastChapter.createUser(username);
      setActiveUser(profile.username);
      setUserRootPath(profile.rootPath);
      setUserProfile(null);
      setOpenAiApiKeyInput("");
      setApiKeyTestMessage(null);
      setNotice({ tone: "success", text: `Local account ready: ${profile.username}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateBook = async () => {
    if (!activeUser) return;

    try {
      setIsBusy(true);
      const created = await window.fastChapter.createBook({ username: activeUser, title: newBookTitle });
      await refreshBooks(activeUser);
      setSelectedBook(created);
      setScreen("workspace");
      setIsCreateBookOpen(false);
      setNewBookTitle("");
      setNotice({ tone: "success", text: `Book created: ${created.title}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsBusy(false);
    }
  };

  const handleRenameBook = async () => {
    if (!activeUser || !selectedBook) return;

    try {
      const updated = await window.fastChapter.renameBook({
        username: activeUser,
        bookId: selectedBook.id,
        title: bookTitleDraft
      });
      setSelectedBook(updated);
      await refreshBooks(activeUser);
      setNotice({ tone: "success", text: "Book title updated." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleCreateChapter = async () => {
    if (!activeUser || !selectedBook) return;

    try {
      await window.fastChapter.createChapter({ username: activeUser, bookId: selectedBook.id });
      await refreshWorkspaceData(activeUser, selectedBook.id, false);
      await refreshBooks(activeUser);
      setNotice({ tone: "success", text: "Chapter folder created." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleSaveFile = async () => {
    if (!activeUser || !selectedBook || !selectedPath) return;

    try {
      await window.fastChapter.writeProjectFile({
        username: activeUser,
        bookId: selectedBook.id,
        relativePath: selectedPath,
        content: editorContent
      });
      setLastSavedContent(editorContent);
      await refreshBooks(activeUser);
      setNotice({ tone: "success", text: `Saved ${selectedPath}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const toggleDirectory = (pathValue: string) => {
    setCollapsedDirs((current) => ({ ...current, [pathValue]: !current[pathValue] }));
  };

  const handleStartCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          setCapturedAudio({ base64: result, mimeType: recorder.mimeType || "audio/webm" });
        };
        reader.readAsDataURL(blob);

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setIsCapturing(false);
      };

      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsCapturing(true);
      setNotice({ tone: "info", text: "Recording started." });
    } catch (error) {
      setNotice({ tone: "error", text: `Microphone access failed: ${String(error)}` });
    }
  };

  const handleStopCapture = () => {
    if (mediaRecorderRef.current && isCapturing) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setNotice({ tone: "info", text: "Recording captured." });
    }
  };

  const resetRecordingDraft = () => {
    setRecordingKind("initial-outline");
    setRecordingChapter(chapterIndexes[0] || 1);
    setRecordingTranscript("");
    setCapturedAudio(null);
    setIsCapturing(false);
  };

  const handleSaveRecording = async () => {
    if (!activeUser || !selectedBook) return;

    const kind =
      recordingKind === "chapter-recording" ? `chapter-recording` : recordingKind === "loose-note" ? "loose-note" : "initial-outline";

    try {
      const result = await window.fastChapter.saveRecording({
        username: activeUser,
        bookId: selectedBook.id,
        kind,
        chapterIndex: recordingKind === "chapter-recording" ? recordingChapter : undefined,
        transcript: recordingTranscript,
        audioBase64: capturedAudio?.base64,
        mimeType: capturedAudio?.mimeType
      });

      await refreshWorkspaceData(activeUser, selectedBook.id);
      setIsRecordingDialogOpen(false);
      resetRecordingDraft();
      if (result.transcriptionJob) {
        setNotice({
          tone: "success",
          text: "Recording saved and OpenAI transcription queued in background."
        });
      } else {
        setNotice({
          tone: hasSavedOpenAIKey ? "info" : "success",
          text: hasSavedOpenAIKey
            ? "Recording saved. Auto transcription is disabled or no audio was captured."
            : "Recording saved. Add an OpenAI API key in Profile to enable auto transcription."
        });
      }
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleStartProcess = () => {
    if (!hasRecordings) {
      setRecordingKind("initial-outline");
      setIsRecordingDialogOpen(true);
      setNotice({
        tone: "info",
        text: "No recordings found. Start by capturing your high-level chapter outline."
      });
      return;
    }

    setNotice({
      tone: "info",
      text: hasSavedOpenAIKey
        ? "Process initialized. Keep recording chapter audio and transcription jobs will run automatically."
        : "Process initialized. Add an OpenAI API key in Profile to enable automatic transcription."
    });
  };

  const handleWriteMyBook = async () => {
    if (!activeUser || !selectedBook) return;

    try {
      const result = await window.fastChapter.writeMyBook({ username: activeUser, bookId: selectedBook.id });
      setNotice({ tone: "success", text: `${result.status.toUpperCase()}: ${result.message}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleSaveApiKey = async () => {
    if (!activeUser) return;

    const trimmed = openAiApiKeyInput.trim();
    if (!trimmed) {
      setNotice({ tone: "error", text: "Paste a valid OpenAI API key first." });
      return;
    }

    try {
      setIsSavingApiKey(true);
      const updated = await window.fastChapter.updateUserProfile({
        username: activeUser,
        openAIApiKey: trimmed
      });
      setUserProfile(updated);
      setOpenAiApiKeyInput("");
      setApiKeyTestMessage(null);
      setNotice({ tone: "success", text: "OpenAI API key saved locally." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!activeUser) return;

    try {
      setIsSavingApiKey(true);
      const updated = await window.fastChapter.updateUserProfile({
        username: activeUser,
        clearOpenAIApiKey: true
      });
      setUserProfile(updated);
      setOpenAiApiKeyInput("");
      setApiKeyTestMessage(null);
      setNotice({ tone: "info", text: "OpenAI API key removed." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleTestApiKey = async () => {
    if (!activeUser) return;

    try {
      setIsTestingApiKey(true);
      const result = await window.fastChapter.testOpenAIKey({
        username: activeUser,
        apiKey: openAiApiKeyInput.trim() || undefined
      });
      setApiKeyTestMessage(`${result.message} (${formatDate(result.checkedAt)})`);
      setNotice({ tone: "success", text: "OpenAI connection test succeeded." });
    } catch (error) {
      setApiKeyTestMessage(`Test failed: ${String(error)}`);
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsTestingApiKey(false);
    }
  };

  const handleToggleAutoTranscribe = async () => {
    if (!activeUser) return;

    try {
      const updated = await window.fastChapter.updateUserProfile({
        username: activeUser,
        autoTranscribe: !autoTranscribeEnabled
      });
      setUserProfile(updated);
      setNotice({
        tone: "success",
        text: `Auto transcription ${updated.integrations.autoTranscribe ? "enabled" : "disabled"}.`
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleOpenProfile = () => {
    if (screen === "workspace") {
      setProfileReturnScreen("workspace");
    } else {
      setProfileReturnScreen("bookshelf");
    }
    setScreen("profile");
  };

  const profileLauncher = activeUser ? (
    <div ref={profileMenuRef} className="fixed bottom-5 right-5 z-[70]">
      {isProfileMenuOpen && (
        <div className="mb-2 w-64 rounded-lg border border-border bg-card/95 p-2 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={handleOpenProfile}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent/70"
          >
            <Settings className="h-4 w-4" />
            Profile & Settings
          </button>
          <button
            type="button"
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent/70"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
            Switch to {theme === "dark" ? "Light" : "Dark"} Mode
          </button>
        </div>
      )}
      <Button variant="secondary" onClick={() => setIsProfileMenuOpen((open) => !open)} className="shadow-lg">
        <UserCircle2 className="mr-2 h-4 w-4" />
        {activeUser}
      </Button>
    </div>
  ) : null;

  if (screen === "auth") {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-12">
        <div
          className={`absolute inset-0 ${
            theme === "dark"
              ? "bg-[radial-gradient(circle_at_10%_10%,rgba(255,177,85,0.22),transparent_35%),radial-gradient(circle_at_90%_30%,rgba(91,207,225,0.23),transparent_40%),linear-gradient(150deg,#06131f,#0d2235_55%,#102137)]"
              : "bg-[radial-gradient(circle_at_10%_10%,rgba(255,177,85,0.34),transparent_35%),radial-gradient(circle_at_90%_30%,rgba(91,207,225,0.27),transparent_40%),linear-gradient(150deg,#fdf4e7,#edf8fd_55%,#f6efe2)]"
          }`}
        />
        <Card className="relative z-10 w-full max-w-xl border-border bg-card/85 backdrop-blur-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-3xl">
              <img src="/logo.png" alt="Fast Chapter" className="h-12 w-12 rounded-lg object-cover" />
              Fast Chapter
            </CardTitle>
            <CardDescription>
              Voice-first book drafting. Create your local account to open your writing bench.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label htmlFor="username">
              Local username
            </Label>
            <Input
              id="username"
              value={usernameInput}
              onChange={(event) => setUsernameInput(event.target.value)}
              placeholder="author-name"
            />
            <Button onClick={handleLocalAccount} className="w-full" disabled={isBusy}>
              <LibraryBig className="mr-2 h-4 w-4" />
              Open My Bookshelf
            </Button>
            <p className="text-xs text-muted-foreground">
              Books are stored locally under your app data folder. This prototype does not sync to cloud yet.
            </p>
          </CardContent>
        </Card>
        {notice && (
          <div className={`absolute bottom-4 rounded-md border px-3 py-2 text-sm ${notice.tone === "error" ? "border-rose-500/40 bg-rose-500/20 text-rose-100" : notice.tone === "success" ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-100" : "border-sky-400/40 bg-sky-500/20 text-sky-100"}`}>
            {notice.text}
          </div>
        )}
      </main>
    );
  }

  if (screen === "bookshelf") {
    return (
      <main className="min-h-screen bg-background px-6 py-6 text-foreground">
        <section className="mx-auto flex w-full max-w-[1700px] items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/70 px-4 py-4">
          <div>
            <h1 className="font-serif text-3xl">Bookshelf</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Welcome, <span className="font-semibold text-foreground">{activeUser}</span>. Pick a manuscript or create a new one.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="rounded-md px-3 py-1 text-xs uppercase tracking-wider">
              Local account
            </Badge>
            <Button onClick={() => setIsCreateBookOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Book
            </Button>
          </div>
        </section>

        <section className="mx-auto mt-4 flex w-full max-w-[1700px] items-center gap-2 overflow-auto">
          <Button size="sm" variant="secondary" className="rounded-full">Examples</Button>
          <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground">Dashboard</Button>
          <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground">Tasks</Button>
          <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground">Playground</Button>
          <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground">Authentication</Button>
        </section>

        <section className="mx-auto mt-4 grid w-full max-w-[1700px] grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {books.map((book) => (
            <Card
              key={book.id}
              className="border-border/70 bg-card/65 transition hover:-translate-y-0.5 hover:border-foreground/20"
            >
              <CardHeader>
                <CardTitle className="line-clamp-2 text-xl">{book.title}</CardTitle>
                <CardDescription className="text-xs">Updated {formatDate(book.updatedAt)}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSelectedBook(book);
                    setScreen("workspace");
                  }}
                >
                  <BookOpen className="mr-2 h-4 w-4" />
                  Open Writing Bench
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>

        {books.length === 0 && (
          <section className="mx-auto mt-10 w-full max-w-[1700px] rounded-lg border border-dashed border-border bg-card/40 p-8 text-center">
            <p className="font-serif text-2xl">No books yet</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your first draft container. Fast Chapter will generate folders and starter chapter files.
            </p>
          </section>
        )}

        <Dialog open={isCreateBookOpen} onOpenChange={setIsCreateBookOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Book</DialogTitle>
              <DialogDescription>
                A new project folder will be created with chapters, transcriptions, recordings, and LaTeX scaffolding.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="book-title">Book title</Label>
              <Input
                id="book-title"
                value={newBookTitle}
                onChange={(event) => setNewBookTitle(event.target.value)}
                placeholder="The Last Dawn"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateBookOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateBook}>
                <Plus className="mr-2 h-4 w-4" />
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {notice && (
          <div className={`fixed bottom-5 left-5 rounded-md border px-3 py-2 text-sm shadow-lg ${notice.tone === "error" ? "border-rose-600/50 bg-rose-950/70 text-rose-100" : notice.tone === "success" ? "border-emerald-600/50 bg-emerald-900/60 text-emerald-100" : "border-sky-500/50 bg-sky-900/60 text-sky-100"}`}>
            {notice.text}
          </div>
        )}
        {profileLauncher}
      </main>
    );
  }

  if (screen === "profile") {
    return (
      <main className="min-h-screen bg-background px-6 py-6 text-foreground">
        <section className="mx-auto flex w-full max-w-[1300px] items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/70 px-4 py-3 shadow-sm">
          <div>
            <h1 className="font-serif text-3xl">Profile & Settings</h1>
            <p className="text-sm text-muted-foreground">Manage your local author profile and appearance preferences.</p>
          </div>
          <Button variant="outline" onClick={() => setScreen(profileReturnScreen)}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </section>

        <section className="mx-auto mt-4 grid w-full max-w-[1300px] grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">Author Info</CardTitle>
              <CardDescription>Stored locally in your app data folder.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/20 font-semibold text-primary">
                  {userInitials}
                </div>
                <div>
                  <p className="text-sm font-semibold">{activeUser}</p>
                  <p className="text-xs text-muted-foreground">{books.length} books in your local shelf</p>
                </div>
              </div>
              <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Local storage path</p>
                <p className="break-all font-mono text-xs text-foreground/90">{userRootPath || "Not loaded yet"}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">Appearance</CardTitle>
              <CardDescription>Switch between dark and light mode for the full app.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button variant={theme === "dark" ? "default" : "outline"} onClick={() => setTheme("dark")}>
                  <MoonStar className="mr-2 h-4 w-4" />
                  Dark
                </Button>
                <Button variant={theme === "light" ? "default" : "outline"} onClick={() => setTheme("light")}>
                  <Sun className="mr-2 h-4 w-4" />
                  Light
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Preference is saved locally and restored the next time you open Fast Chapter.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/65 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">OpenAI Transcription</CardTitle>
              <CardDescription>
                Configure your API key for background transcription using `gpt-4o-transcribe`.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={hasSavedOpenAIKey ? "success" : "secondary"}>
                  {hasSavedOpenAIKey ? "API key saved" : "No API key"}
                </Badge>
                <Badge variant={autoTranscribeEnabled ? "success" : "outline"}>
                  Auto-transcribe {autoTranscribeEnabled ? "on" : "off"}
                </Badge>
                <Button variant="outline" size="sm" onClick={handleToggleAutoTranscribe}>
                  <RefreshCcw className="mr-2 h-3.5 w-3.5" />
                  Toggle Auto-Transcribe
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <Input
                  type="password"
                  value={openAiApiKeyInput}
                  onChange={(event) => setOpenAiApiKeyInput(event.target.value)}
                  placeholder={hasSavedOpenAIKey ? "Enter new key to replace current one" : "sk-..."}
                />
                <Button onClick={handleSaveApiKey} disabled={isSavingApiKey}>
                  {isSavingApiKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  Save Key
                </Button>
                <Button variant="outline" onClick={handleTestApiKey} disabled={isTestingApiKey}>
                  {isTestingApiKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Test Key
                </Button>
                <Button variant="outline" onClick={handleClearApiKey} disabled={isSavingApiKey}>
                  Clear
                </Button>
              </div>

              {apiKeyTestMessage && (
                <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {apiKeyTestMessage}
                </p>
              )}

              <p className="text-xs text-muted-foreground">
                Notes: file transcription uploads support mp3/mp4/mpeg/mpga/m4a/wav/webm and 25 MB max per file.
                Long recordings should be split into smaller chunks if they exceed this size.
              </p>
            </CardContent>
          </Card>
        </section>

        {notice && (
          <div
            className={`fixed bottom-5 left-5 rounded-md border px-3 py-2 text-sm shadow-lg ${
              notice.tone === "error"
                ? "border-rose-600/50 bg-rose-950/70 text-rose-100"
                : notice.tone === "success"
                  ? "border-emerald-600/50 bg-emerald-900/60 text-emerald-100"
                  : "border-sky-500/50 bg-sky-900/60 text-sky-100"
            }`}
          >
            {notice.text}
          </div>
        )}
        {profileLauncher}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-4 text-foreground">
      <section className="mx-auto flex w-full max-w-[1700px] flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3 shadow-sm">
        <Button
          variant="outline"
          onClick={() => {
            setScreen("bookshelf");
            setSelectedBook(null);
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Bookshelf
        </Button>

        <Input
          value={bookTitleDraft}
          onChange={(event) => setBookTitleDraft(event.target.value)}
          className="max-w-md"
          placeholder="Book title"
        />
        <Button variant="secondary" onClick={handleRenameBook}>
          <Check className="mr-2 h-4 w-4" />
          Update Title
        </Button>

        <Separator orientation="vertical" className="mx-2 h-8" />

        <Button variant="outline" onClick={handleStartProcess}>
          <Sparkles className="mr-2 h-4 w-4" />
          Start The Process
        </Button>
        <Button onClick={handleWriteMyBook}>
          <WandSparkles className="mr-2 h-4 w-4" />
          Write My Book
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <Badge variant={hasRecordings ? "success" : "secondary"}>
            {hasRecordings ? "Process seeded" : "Needs first recording"}
          </Badge>
          <Badge variant="outline">{selectedBook?.id.slice(0, 8)}</Badge>
        </div>
      </section>

      <section className="mx-auto mt-4 grid w-full max-w-[1700px] grid-cols-1 gap-4 xl:grid-cols-[320px_1fr_350px]">
        <Card className="h-[calc(100vh-12rem)] border-border/70 bg-card/65">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Project Navigator</CardTitle>
              <Button variant="ghost" size="sm" onClick={handleCreateChapter}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Chapter
              </Button>
            </div>
            <CardDescription>
              Files mirror the real local folder structure. Add chapters and edit LaTeX directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(100%-7.4rem)] p-0">
            <ScrollArea className="h-full px-2 pb-3">
              <div className="space-y-0.5 py-1">
                {renderTree(tree, 0, collapsedDirs, toggleDirectory, selectedPath, (filePath) => {
                  setSelectedPath(filePath);
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="h-[calc(100vh-12rem)] border-border/70 bg-card/65">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Writing Bench</CardTitle>
              <Button variant="secondary" size="sm" onClick={handleSaveFile} disabled={!editorDirty || !selectedPath || isBusy}>
                <Save className="mr-2 h-3.5 w-3.5" />
                Save File
              </Button>
            </div>
            <CardDescription>
              Left: editable LaTeX/source. Right: live preview placeholder for MyTeX/Overleaf-style rendering.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(100%-7.4rem)]">
            <div className="grid h-full grid-cols-1 gap-3 xl:grid-cols-2">
              <div className="flex min-h-0 flex-col gap-2">
                <Label className="text-xs text-muted-foreground">Current file</Label>
                <div className="rounded-md border border-border px-3 py-2 text-xs text-foreground/80">{selectedPath || "No file selected"}</div>
                <Textarea
                  value={editorContent}
                  onChange={(event) => setEditorContent(event.target.value)}
                  className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
                  placeholder="Select a file from the navigator..."
                />
              </div>

              <div className="flex min-h-0 flex-col rounded-lg border border-border/70 bg-muted/20 p-4">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Preview</p>
                <div className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-dashed border-border/60 bg-background/70 p-4">
                  <p className="font-serif text-lg">Live chapter render</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Connect MyTeX + PDF renderer to replace this panel with compiled chapter output.
                  </p>
                  <Separator className="my-4" />
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground/80">
                    {selectedPath && isEditableFile(selectedPath)
                      ? editorContent || "% Start writing here..."
                      : "% Select a .tex or .txt file to preview source"}
                  </pre>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="h-[calc(100vh-12rem)] border-border/70 bg-card/65">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Voice Workflow</CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setRecordingKind(hasRecordings ? "chapter-recording" : "initial-outline");
                  setIsRecordingDialogOpen(true);
                }}
              >
                <Mic className="mr-2 h-3.5 w-3.5" />
                Record
              </Button>
            </div>
            <CardDescription>
              Capture your outline and chapter narration. Transcriptions are saved into the project folder.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[calc(100%-7.4rem)] p-0">
            <ScrollArea className="h-full px-4 pb-4">
              <div className="space-y-4 py-1">
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Pipeline</p>
                  <div className="mt-2 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>Initial outline</span>
                      <Badge variant={hasRecordings ? "success" : "secondary"}>{hasRecordings ? "ready" : "pending"}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Chapter recordings</span>
                      <span className="text-muted-foreground">{recordingData.recordings.length} files</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Transcriptions</span>
                      <span className="text-muted-foreground">{recordingData.transcriptions.length} files</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Jobs in progress</span>
                      <span className="text-muted-foreground">{activeJobs.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Failed jobs</span>
                      <span className="text-muted-foreground">{failedJobs.length}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Recordings</p>
                  <div className="mt-2 space-y-2">
                    {recordingData.recordings.map((recording) => (
                      <div key={recording.path} className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs">
                        <p className="truncate font-medium">{recording.fileName}</p>
                        <p className="text-muted-foreground">{formatDate(recording.createdAt)}</p>
                      </div>
                    ))}
                    {recordingData.recordings.length === 0 && (
                      <p className="text-xs text-muted-foreground">No recordings yet. Start with your high-level outline.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Transcriptions</p>
                  <div className="mt-2 space-y-2">
                    {recordingData.transcriptions.map((transcription) => (
                      <div key={transcription.path} className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs">
                        <p className="truncate">{transcription.fileName}</p>
                      </div>
                    ))}
                    {recordingData.transcriptions.length === 0 && (
                      <p className="text-xs text-muted-foreground">Transcriptions will appear here after each recording save.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Transcription Jobs</p>
                  <div className="mt-2 space-y-2">
                    {recordingData.jobs.map((job) => (
                      <div key={job.id} className="rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate font-medium">{job.baseName}</p>
                          <Badge
                            variant={job.status === "completed" ? "success" : "secondary"}
                            className={`text-[10px] uppercase ${
                              job.status === "failed" ? "bg-rose-500/80 text-rose-950" : ""
                            }`}
                          >
                            {job.status === "in_progress" ? "running" : job.status}
                          </Badge>
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {formatBytes(job.fileSizeBytes)} · {formatDate(job.updatedAt)}
                        </p>
                        {job.error && <p className="mt-1 text-rose-300">{job.error}</p>}
                      </div>
                    ))}
                    {recordingData.jobs.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No background transcription jobs yet. Save a recording with an OpenAI key configured.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </section>

      <Dialog
        open={isRecordingDialogOpen}
        onOpenChange={(open) => {
          setIsRecordingDialogOpen(open);
          if (!open) {
            handleStopCapture();
            resetRecordingDraft();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Audio</DialogTitle>
            <DialogDescription>
              Save audio into `recordings/` and transcription text into `transcriptions/`. With an API key saved, OpenAI runs in the background.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid gap-2">
              <Label>Recording type</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  variant={recordingKind === "initial-outline" ? "default" : "outline"}
                  onClick={() => setRecordingKind("initial-outline")}
                >
                  Initial Outline
                </Button>
                <Button
                  type="button"
                  variant={recordingKind === "chapter-recording" ? "default" : "outline"}
                  onClick={() => setRecordingKind("chapter-recording")}
                >
                  Chapter
                </Button>
                <Button
                  type="button"
                  variant={recordingKind === "loose-note" ? "default" : "outline"}
                  onClick={() => setRecordingKind("loose-note")}
                >
                  Loose Note
                </Button>
              </div>
            </div>

            {recordingKind === "chapter-recording" && (
              <div className="space-y-2">
                <Label htmlFor="chapter-index">Chapter</Label>
                <Input
                  id="chapter-index"
                  type="number"
                  min={1}
                  max={Math.max(1, chapterIndexes.length || 1)}
                  value={recordingChapter}
                  onChange={(event) => setRecordingChapter(Number(event.target.value) || 1)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="recording-transcript">Transcript (manual placeholder)</Label>
              <Textarea
                id="recording-transcript"
                value={recordingTranscript}
                onChange={(event) => setRecordingTranscript(event.target.value)}
                placeholder="Speak your chapter summary and paste/clean transcript here..."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isCapturing ? (
                <Button type="button" variant="secondary" onClick={handleStartCapture}>
                  <Mic className="mr-2 h-4 w-4" />
                  Start Mic Capture
                </Button>
              ) : (
                <Button type="button" variant="destructive" onClick={handleStopCapture}>
                  <MicOff className="mr-2 h-4 w-4" />
                  Stop Capture
                </Button>
              )}

              {capturedAudio && (
                <Badge variant="success" className="animate-fade-in">
                  Audio attached
                </Badge>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsRecordingDialogOpen(false);
                resetRecordingDraft();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveRecording}>Save Recording</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {notice && (
        <div className={`fixed bottom-5 left-5 rounded-md border px-3 py-2 text-sm shadow-lg ${notice.tone === "error" ? "border-rose-600/50 bg-rose-950/70 text-rose-100" : notice.tone === "success" ? "border-emerald-600/50 bg-emerald-900/60 text-emerald-100" : "border-sky-500/50 bg-sky-900/60 text-sky-100"}`}>
          {notice.text}
        </div>
      )}

      {isBusy && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-black/20">
          <div className="rounded-md border border-border bg-card px-4 py-2 text-sm shadow-lg">Working...</div>
        </div>
      )}
      {profileLauncher}
    </main>
  );
}
