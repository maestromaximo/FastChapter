import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent as ReactChangeEvent,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderPlus,
  FolderOpen,
  Github,
  KeyRound,
  LibraryBig,
  ListChecks,
  Loader2,
  Mic,
  MicOff,
  MoonStar,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Settings,
  Square,
  Sparkles,
  Sun,
  TerminalSquare,
  Upload,
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
import type {
  BookSummary,
  CodexAvailability,
  FileNode,
  LatexCompileResult,
  PromptTemplateGroup,
  PromptTemplateLibrary,
  RecordingBundle,
  SetupStatus,
  UserProfile,
  WriteBookChecklist,
  WriteBookSessionLogLine,
  WriteBookSessionSnapshot
} from "@/types/domain";

type AppScreen = "auth" | "setup" | "bookshelf" | "personalization" | "workspace" | "profile";

type Notice = {
  tone: "info" | "success" | "error";
  text: string;
};

type ExplorerContextMenuState = {
  x: number;
  y: number;
  mode: "single" | "multi";
  nodePath: string;
  nodeName: string;
  nodeType: "file" | "directory";
  bulkPaths?: string[];
};

type MenuPosition = {
  left: number;
  top: number;
};

type ExplorerEntryDialogState = {
  mode: "create-file" | "create-folder" | "rename";
  parentRelativePath?: string;
  targetPath?: string;
  targetType?: "file" | "directory";
  initialName: string;
};

type UploadCandidate = {
  relativePath: string;
  file: File;
};

type ExplorerDragState = {
  paths: string[];
};

type CapturedAudio = {
  base64: string;
  mimeType: string;
};

type WriteBookDialogStep = "checklist" | "codex" | "confirm" | "running" | "complete";
type PromptTemplateKey = "bookContext" | "firstChapter" | "nextChapter" | "verifyMainTex";

function isEditableFile(filePath: string) {
  return /\.(tex|txt|md|json|ya?ml)$/i.test(filePath);
}

function isAudioFile(filePath: string) {
  return /\.(wav|mp3|mp4|m4a|ogg|webm|flac|mpeg|mpga)$/i.test(filePath);
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

function formatDurationMs(value: number) {
  if (!value) return "0 ms";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
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

function getParentDirectoryPath(nodePath: string) {
  const clean = String(nodePath || "").replaceAll("\\", "/");
  const slash = clean.lastIndexOf("/");
  if (slash < 0) return "";
  return clean.slice(0, slash);
}

function normalizeRelativePath(value: string) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/$/, "");
}

function joinRelativePath(parent: string, child: string) {
  const a = normalizeRelativePath(parent);
  const b = normalizeRelativePath(child);
  if (!a) return b;
  if (!b) return a;
  return `${a}/${b}`;
}

function flattenVisibleNodes(nodes: FileNode[], collapsed: Record<string, boolean>): FileNode[] {
  const output: FileNode[] = [];

  const walk = (list: FileNode[]) => {
    list.forEach((node) => {
      output.push(node);
      if (node.type === "directory" && !collapsed[node.path] && node.children?.length) {
        walk(node.children);
      }
    });
  };

  walk(nodes);
  return output;
}

function buildPathTypeMap(nodes: FileNode[]) {
  const output = new Map<string, "file" | "directory">();

  const walk = (list: FileNode[]) => {
    list.forEach((node) => {
      output.set(node.path, node.type);
      if (node.children?.length) {
        walk(node.children);
      }
    });
  };

  walk(nodes);
  return output;
}

function getTopLevelPaths(paths: string[]) {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
  const output: string[] = [];

  sorted.forEach((candidate) => {
    if (!output.some((parent) => candidate.startsWith(`${parent}/`))) {
      output.push(candidate);
    }
  });

  return output;
}

function renderTree(
  nodes: FileNode[],
  depth: number,
  collapsed: Record<string, boolean>,
  selectedPathSet: Set<string>,
  onNodeClick: (event: ReactMouseEvent<HTMLButtonElement>, node: FileNode) => void,
  onRightClick: (event: ReactMouseEvent<HTMLButtonElement>, node: FileNode) => void,
  dragState: ExplorerDragState | null,
  dropTargetDirectory: string | null,
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>, node: FileNode) => void,
  onDragEnd: () => void,
  onDragOverNode: (event: ReactDragEvent<HTMLButtonElement>, node: FileNode) => void,
  onDropOnNode: (event: ReactDragEvent<HTMLButtonElement>, node: FileNode) => void
): JSX.Element[] {
  return nodes.flatMap((node) => {
    const isDir = node.type === "directory";
    const isCollapsed = Boolean(collapsed[node.path]);
    const isDropTarget = isDir && dropTargetDirectory === node.path;
    const isBeingDragged = dragState?.paths.includes(node.path);
    const item = (
      <button
        key={node.path}
        type="button"
        draggable
        data-tree-node="true"
        onClick={(event) => onNodeClick(event, node)}
        onContextMenu={(event) => onRightClick(event, node)}
        onDragStart={(event) => onDragStart(event, node)}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOverNode(event, node)}
        onDrop={(event) => onDropOnNode(event, node)}
        className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
          selectedPathSet.has(node.path)
            ? "bg-primary/20 text-primary"
            : "text-foreground/80 hover:bg-accent/70 hover:text-foreground"
        } ${isDropTarget ? "ring-1 ring-primary/70 bg-primary/10" : ""} ${isBeingDragged ? "opacity-50" : ""}`}
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

    return [
      item,
      ...renderTree(
        node.children,
        depth + 1,
        collapsed,
        selectedPathSet,
        onNodeClick,
        onRightClick,
        dragState,
        dropTargetDirectory,
        onDragStart,
        onDragEnd,
        onDragOverNode,
        onDropOnNode
      )
    ];
  });
}

const THEME_STORAGE_KEY = "fastchapter-theme";
const LAST_USER_STORAGE_KEY = "fastchapter-last-user";

export default function App() {
  const [screen, setScreen] = useState<AppScreen>("auth");
  const [notice, setNotice] = useState<Notice | null>(null);

  const [usernameInput, setUsernameInput] = useState("");
  const [activeUser, setActiveUser] = useState<string | null>(null);
  const [workingDirectoryPath, setWorkingDirectoryPath] = useState<string>("");
  const [userRootPath, setUserRootPath] = useState<string>("");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [openAiApiKeyInput, setOpenAiApiKeyInput] = useState("");
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [isLoadingSetupStatus, setIsLoadingSetupStatus] = useState(false);
  const [promptLibrary, setPromptLibrary] = useState<PromptTemplateLibrary | null>(null);
  const [isLoadingPromptLibrary, setIsLoadingPromptLibrary] = useState(false);
  const [selectedPromptKey, setSelectedPromptKey] = useState<PromptTemplateKey>("bookContext");
  const [newPromptVariantName, setNewPromptVariantName] = useState("");
  const [newPromptVariantContent, setNewPromptVariantContent] = useState("");
  const [isCreatingPromptVariant, setIsCreatingPromptVariant] = useState(false);
  const [isApplyingPromptVariant, setIsApplyingPromptVariant] = useState(false);
  const [isDeletingPromptVariant, setIsDeletingPromptVariant] = useState(false);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [isChoosingWorkingDirectory, setIsChoosingWorkingDirectory] = useState(false);
  const [apiKeyTestMessage, setApiKeyTestMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [profileReturnScreen, setProfileReturnScreen] = useState<"bookshelf" | "workspace" | "setup" | "personalization">("bookshelf");

  const [books, setBooks] = useState<BookSummary[]>([]);
  const [selectedBook, setSelectedBook] = useState<BookSummary | null>(null);
  const [bookTitleDraft, setBookTitleDraft] = useState("");

  const [isCreateBookOpen, setIsCreateBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState("");

  const [tree, setTree] = useState<FileNode[]>([]);
  const [collapsedDirs, setCollapsedDirs] = useState<Record<string, boolean>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedExplorerPaths, setSelectedExplorerPaths] = useState<string[]>([]);
  const [explorerSelectionAnchorPath, setExplorerSelectionAnchorPath] = useState<string | null>(null);
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenuState | null>(null);
  const [explorerContextMenuPosition, setExplorerContextMenuPosition] = useState<MenuPosition>({ left: 0, top: 0 });
  const [explorerEntryDialog, setExplorerEntryDialog] = useState<ExplorerEntryDialogState | null>(null);
  const [explorerEntryNameInput, setExplorerEntryNameInput] = useState("");
  const [draggedExplorerNode, setDraggedExplorerNode] = useState<ExplorerDragState | null>(null);
  const [explorerDropTargetDirectory, setExplorerDropTargetDirectory] = useState<string | null>(null);
  const [isExplorerDropZoneActive, setIsExplorerDropZoneActive] = useState(false);
  const [audioPreviewDataUrl, setAudioPreviewDataUrl] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isCompilingLatex, setIsCompilingLatex] = useState(false);
  const [autoCompileOnSave, setAutoCompileOnSave] = useState(true);
  const [latexPreviewUrl, setLatexPreviewUrl] = useState<string | null>(null);
  const [lastLatexCompile, setLastLatexCompile] = useState<LatexCompileResult | null>(null);
  const [latexCompileError, setLatexCompileError] = useState<string | null>(null);
  const [isVoicePaneOpen, setIsVoicePaneOpen] = useState(true);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportIncludeTranscriptions, setExportIncludeTranscriptions] = useState(false);
  const [exportIncludeRecordings, setExportIncludeRecordings] = useState(false);
  const [isExportingBook, setIsExportingBook] = useState(false);

  const [recordingData, setRecordingData] = useState<RecordingBundle>({
    recordings: [],
    transcriptions: [],
    jobs: []
  });
  const [isRecordingDialogOpen, setIsRecordingDialogOpen] = useState(false);
  const [recordingKind, setRecordingKind] = useState<"initial-outline" | "chapter-recording" | "loose-note">("initial-outline");
  const [recordingChapter, setRecordingChapter] = useState<number>(1);
  const [recordingTranscript, setRecordingTranscript] = useState("");
  const [capturedAudio, setCapturedAudio] = useState<CapturedAudio | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isWriteBookDialogOpen, setIsWriteBookDialogOpen] = useState(false);
  const [writeBookStep, setWriteBookStep] = useState<WriteBookDialogStep>("checklist");
  const [writeBookChecklist, setWriteBookChecklist] = useState<WriteBookChecklist | null>(null);
  const [isLoadingWriteBookChecklist, setIsLoadingWriteBookChecklist] = useState(false);
  const [codexAvailability, setCodexAvailability] = useState<CodexAvailability | null>(null);
  const [isCheckingCodexAvailability, setIsCheckingCodexAvailability] = useState(false);
  const [isStartingWriteBookSession, setIsStartingWriteBookSession] = useState(false);
  const [isCancellingWriteBookSession, setIsCancellingWriteBookSession] = useState(false);
  const [writeBookSession, setWriteBookSession] = useState<WriteBookSessionSnapshot | null>(null);
  const [writeBookSessionLogs, setWriteBookSessionLogs] = useState<WriteBookSessionLogLine[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const explorerMenuRef = useRef<HTMLDivElement | null>(null);
  const uploadFilesInputRef = useRef<HTMLInputElement | null>(null);
  const uploadFolderInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetPathRef = useRef<string>("");
  const pendingCaptureResolveRef = useRef<((value: CapturedAudio | null) => void) | null>(null);
  const discardCapturedAudioOnStopRef = useRef(false);
  const writeBookTerminalRef = useRef<HTMLDivElement | null>(null);
  const writeBookSessionIdRef = useRef<string | null>(null);
  const writeBookLogCursorRef = useRef(0);

  const chapterIndexes = useMemo(() => collectChapterIndexes(tree), [tree]);
  const explorerPathTypeMap = useMemo(() => buildPathTypeMap(tree), [tree]);
  const visibleExplorerNodes = useMemo(
    () => flattenVisibleNodes(tree, collapsedDirs),
    [tree, collapsedDirs]
  );
  const visibleExplorerPaths = useMemo(
    () => visibleExplorerNodes.map((node) => node.path),
    [visibleExplorerNodes]
  );
  const selectedExplorerPathSet = useMemo(
    () => new Set(selectedExplorerPaths),
    [selectedExplorerPaths]
  );
  const selectedPromptGroup = useMemo(
    () =>
      promptLibrary?.prompts.find((group) => group.promptKey === selectedPromptKey) ||
      null,
    [promptLibrary, selectedPromptKey]
  );
  const hasRecordings = recordingData.recordings.length > 0;
  const editorDirty = editorContent !== lastSavedContent;
  const userInitials = useMemo(() => buildInitials(activeUser), [activeUser]);
  const hasSavedOpenAIKey = Boolean(userProfile?.integrations.hasOpenAIApiKey);
  const autoTranscribeEnabled = userProfile?.integrations.autoTranscribe !== false;
  const activeJobs = recordingData.jobs.filter(
    (job) => job.status === "queued" || job.status === "in_progress"
  );
  const failedJobs = recordingData.jobs.filter((job) => job.status === "failed");
  const isWriteBookRunning =
    writeBookSession?.status === "queued" || writeBookSession?.status === "running";
  const folderUploadInputProps = { webkitdirectory: "", directory: "" } as any;

  const refreshBooks = async (username: string) => {
    const result = await window.fastChapter.listBooks(username);
    setBooks(result);
  };

  const refreshWorkingDirectory = async () => {
    const result = await window.fastChapter.getWorkingDirectory();
    setWorkingDirectoryPath(result.path);
    return result;
  };

  const refreshProfile = async (username: string) => {
    const profile = await window.fastChapter.getUserProfile(username);
    setUserRootPath(profile.rootPath);
    setUserProfile(profile);
    setApiKeyTestMessage(null);
    return profile;
  };

  const refreshSetupStatus = async (
    usernameOverride?: string,
    options?: { silent?: boolean }
  ) => {
    const username = usernameOverride || activeUser;
    if (!username) return null;

    const silent = options?.silent === true;
    try {
      if (!silent) setIsLoadingSetupStatus(true);
      const status = await window.fastChapter.getSetupStatus({ username });
      setSetupStatus(status);
      return status;
    } finally {
      if (!silent) setIsLoadingSetupStatus(false);
    }
  };

  const refreshPromptLibrary = async (
    usernameOverride?: string,
    options?: { silent?: boolean }
  ) => {
    const username = usernameOverride || activeUser;
    if (!username) return null;

    const silent = options?.silent === true;
    try {
      if (!silent) setIsLoadingPromptLibrary(true);
      const library = await window.fastChapter.listPromptTemplates({ username });
      setPromptLibrary(library);
      return library;
    } finally {
      if (!silent) setIsLoadingPromptLibrary(false);
    }
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
      setSelectedExplorerPaths(fallback ? [fallback] : []);
      setExplorerSelectionAnchorPath(fallback || null);
    }
  };

  const readAndSetFile = async (pathValue: string) => {
    if (!activeUser || !selectedBook) return;
    if (isAudioFile(pathValue)) {
      const mediaDataUrl = await window.fastChapter.readProjectMediaDataUrl({
        username: activeUser,
        bookId: selectedBook.id,
        relativePath: pathValue
      });
      setAudioPreviewDataUrl(mediaDataUrl);
      setEditorContent("Audio preview loaded.");
      setLastSavedContent("Audio preview loaded.");
      return;
    }

    setAudioPreviewDataUrl(null);

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
    let cancelled = false;

    Promise.all([
      refreshWorkingDirectory(),
      refreshBooks(activeUser),
      refreshProfile(activeUser),
      refreshSetupStatus(activeUser, { silent: true }),
      refreshPromptLibrary(activeUser, { silent: true })
    ])
      .then(([, , , setup]) => {
        if (cancelled) return;
        setScreen(setup?.ready ? "bookshelf" : "setup");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice({ tone: "error", text: String(error) });
      });

    return () => {
      cancelled = true;
    };
  }, [activeUser]);

  useEffect(() => {
    if (!promptLibrary?.prompts?.length) return;
    const exists = promptLibrary.prompts.some((group) => group.promptKey === selectedPromptKey);
    if (exists) return;

    const firstGroup = promptLibrary.prompts[0];
    setSelectedPromptKey(firstGroup.promptKey as PromptTemplateKey);
  }, [promptLibrary, selectedPromptKey]);

  useEffect(() => {
    if (!selectedPromptGroup) return;
    if (newPromptVariantContent.trim().length > 0) return;

    const defaultTemplate = selectedPromptGroup.templates.find((template) => template.source === "default");
    setNewPromptVariantContent(defaultTemplate?.content || "");
  }, [selectedPromptGroup, newPromptVariantContent]);

  useEffect(() => {
    if (!activeUser || !selectedBook) return;
    let cancelled = false;

    setIsBusy(true);
    setLatexPreviewUrl(null);
    setLastLatexCompile(null);
    setLatexCompileError(null);

    refreshWorkspaceData(activeUser, selectedBook.id, false)
      .then(() => {
        setBookTitleDraft(selectedBook.title);

        setIsCompilingLatex(true);
        window.fastChapter
          .compileLatex({
            username: activeUser,
            bookId: selectedBook.id,
            entryRelativePath: "main.tex"
          })
          .then((compileResult) => {
            if (cancelled) return;
            setLastLatexCompile(compileResult);
            setLatexPreviewUrl(compileResult.pdfDataUrl);
            setLatexCompileError(null);
          })
          .catch((error: unknown) => {
            if (cancelled) return;
            const message = String(error);
            setLatexCompileError(message);
            setNotice({ tone: "error", text: message.split("\n")[0] || message });
          })
          .finally(() => {
            if (!cancelled) setIsCompilingLatex(false);
          });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setNotice({ tone: "error", text: String(error) });
      })
      .finally(() => {
        if (!cancelled) setIsBusy(false);
      });

    return () => {
      cancelled = true;
    };
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
    refreshWorkingDirectory().catch(() => {
      // Keep auth/setup usable even if reading the path fails temporarily.
    });
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
    setSelectedExplorerPaths((current) => current.filter((itemPath) => explorerPathTypeMap.has(itemPath)));
    setExplorerSelectionAnchorPath((current) =>
      current && explorerPathTypeMap.has(current) ? current : null
    );
  }, [explorerPathTypeMap]);

  useEffect(() => {
    if (!notice) return;

    const timeoutMs = notice.tone === "error" ? 10000 : 5000;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, timeoutMs);

    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setIsProfileMenuOpen(false);
    setExplorerContextMenu(null);
    setExplorerEntryDialog(null);
    setDraggedExplorerNode(null);
    setExplorerDropTargetDirectory(null);
    setIsExplorerDropZoneActive(false);
    setSelectedExplorerPaths([]);
    setExplorerSelectionAnchorPath(null);
    setIsWriteBookDialogOpen(false);
    setIsExportDialogOpen(false);
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

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!explorerContextMenu) return;
      if (!explorerMenuRef.current) return;
      const target = event.target as Node | null;
      if (target && !explorerMenuRef.current.contains(target)) {
        setExplorerContextMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExplorerContextMenu(null);
      }
    };

    window.addEventListener("mousedown", handleDocumentClick);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handleDocumentClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [explorerContextMenu]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const withModifier = event.ctrlKey || event.metaKey;

      if (!withModifier || key !== "l") return;
      if (screen !== "workspace") return;

      event.preventDefault();
      setIsVoicePaneOpen((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [screen]);

  useEffect(() => {
    if (!isWriteBookDialogOpen) return;
    if (!writeBookSessionIdRef.current) return;
    if (writeBookSession && !["queued", "running"].includes(writeBookSession.status)) return;

    const tick = () => {
      pollWriteBookSession().catch(() => {
        // Errors are surfaced in notice from pollWriteBookSession.
      });
    };

    tick();
    const interval = window.setInterval(tick, 1200);
    return () => window.clearInterval(interval);
  }, [isWriteBookDialogOpen, writeBookSession?.status]);

  useEffect(() => {
    if (!isWriteBookDialogOpen) return;
    const container = writeBookTerminalRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [isWriteBookDialogOpen, writeBookSessionLogs.length, writeBookStep]);

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

  const handleChooseWorkingDirectory = async () => {
    try {
      setIsChoosingWorkingDirectory(true);
      const result = await window.fastChapter.chooseWorkingDirectory();
      setWorkingDirectoryPath(result.path);

      if (result.cancelled) {
        return;
      }

      if (activeUser) {
        const profile = await window.fastChapter.createUser(activeUser);
        setUserRootPath(profile.rootPath);
        setSelectedBook(null);
        setTree([]);
        setSelectedPath(null);
        setSelectedExplorerPaths([]);
        setExplorerSelectionAnchorPath(null);
        setRecordingData({
          recordings: [],
          transcriptions: [],
          jobs: []
        });
        setEditorContent("");
        setLastSavedContent("");
        setAudioPreviewDataUrl(null);

        await Promise.all([
          refreshBooks(activeUser),
          refreshProfile(activeUser),
          refreshSetupStatus(activeUser, { silent: true }),
          refreshPromptLibrary(activeUser, { silent: true })
        ]);

        if (screen === "workspace") {
          setScreen("bookshelf");
        }
      }

      setNotice({ tone: "success", text: `Working directory updated: ${result.path}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsChoosingWorkingDirectory(false);
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

  const handleCompileLatex = async (options?: { silentSuccess?: boolean }) => {
    if (!activeUser || !selectedBook) return;

    try {
      setIsCompilingLatex(true);
      const compileResult = await window.fastChapter.compileLatex({
        username: activeUser,
        bookId: selectedBook.id,
        entryRelativePath: "main.tex"
      });
      setLastLatexCompile(compileResult);
      setLatexPreviewUrl(compileResult.pdfDataUrl);
      setLatexCompileError(null);

      if (!options?.silentSuccess) {
        setNotice({
          tone: "success",
          text: compileResult.cached
            ? "LaTeX preview is up to date."
            : `Compiled with ${compileResult.compiler} in ${formatDurationMs(compileResult.durationMs)}.`
        });
      }
    } catch (error) {
      const message = String(error);
      setLatexCompileError(message);
      setNotice({ tone: "error", text: message.split("\n")[0] || message });
    } finally {
      setIsCompilingLatex(false);
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

      if (autoCompileOnSave && /\.tex$/i.test(selectedPath)) {
        handleCompileLatex({ silentSuccess: true }).catch(() => {
          // Errors are surfaced by handleCompileLatex notice handling.
        });
      }
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleOpenExportDialog = () => {
    setExportIncludeTranscriptions(false);
    setExportIncludeRecordings(false);
    setIsExportDialogOpen(true);
  };

  const handleExportBookArchive = async () => {
    if (!activeUser || !selectedBook) return;

    try {
      setIsExportingBook(true);
      const result = await window.fastChapter.exportBookArchive({
        username: activeUser,
        bookId: selectedBook.id,
        includeRecordings: exportIncludeRecordings,
        includeTranscriptions: exportIncludeTranscriptions
      });

      if (result.cancelled) {
        setNotice({ tone: "info", text: "Export cancelled." });
        return;
      }

      setNotice({
        tone: "success",
        text: `Exported ${result.fileCount} file(s) to ${result.outputPath || "selected path"}.`
      });
      setIsExportDialogOpen(false);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsExportingBook(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const withModifier = event.ctrlKey || event.metaKey;

      if (!withModifier || key !== "s") return;
      if (screen !== "workspace") return;

      event.preventDefault();

      if (!editorDirty || !selectedPath || isBusy) return;
      handleSaveFile().catch(() => {
        // Save errors are surfaced by handleSaveFile notice handling.
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorDirty, handleSaveFile, isBusy, screen, selectedPath]);

  const toggleDirectory = (pathValue: string) => {
    setCollapsedDirs((current) => ({ ...current, [pathValue]: !current[pathValue] }));
  };

  const remapPathValueAfterPathChange = (
    currentPath: string,
    sourcePath: string,
    destinationPath: string,
    entryType: "file" | "directory"
  ) => {
    if (currentPath === sourcePath) return destinationPath;
    if (entryType === "directory" && currentPath.startsWith(`${sourcePath}/`)) {
      return `${destinationPath}${currentPath.slice(sourcePath.length)}`;
    }
    return currentPath;
  };

  const remapSelectedPathAfterPathChange = (
    sourcePath: string,
    destinationPath: string,
    entryType: "file" | "directory"
  ) => {
    setSelectedPath((current) => {
      if (!current) return current;
      return remapPathValueAfterPathChange(current, sourcePath, destinationPath, entryType);
    });
    setSelectedExplorerPaths((current) => {
      const remapped = current.map((pathValue) =>
        remapPathValueAfterPathChange(pathValue, sourcePath, destinationPath, entryType)
      );
      return [...new Set(remapped)];
    });
    setExplorerSelectionAnchorPath((current) => {
      if (!current) return current;
      return remapPathValueAfterPathChange(current, sourcePath, destinationPath, entryType);
    });
  };

  const handleExplorerNodeClick = (event: ReactMouseEvent<HTMLButtonElement>, node: FileNode) => {
    const withRange = event.shiftKey;
    const withAdditive = event.ctrlKey || event.metaKey;

    if (withRange) {
      const anchorPath = explorerSelectionAnchorPath || selectedExplorerPaths[0] || node.path;
      const anchorIndex = visibleExplorerPaths.indexOf(anchorPath);
      const targetIndex = visibleExplorerPaths.indexOf(node.path);

      if (anchorIndex < 0 || targetIndex < 0) {
        setSelectedExplorerPaths([node.path]);
        setExplorerSelectionAnchorPath(node.path);
      } else {
        const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedExplorerPaths(visibleExplorerPaths.slice(start, end + 1));
      }

      if (node.type === "file") {
        setSelectedPath(node.path);
      }
      return;
    }

    if (withAdditive) {
      setSelectedExplorerPaths((current) => {
        const next = new Set(current);
        if (next.has(node.path)) {
          next.delete(node.path);
        } else {
          next.add(node.path);
        }
        return [...next];
      });
      setExplorerSelectionAnchorPath(node.path);
      if (node.type === "file") {
        setSelectedPath(node.path);
      }
      return;
    }

    setSelectedExplorerPaths([node.path]);
    setExplorerSelectionAnchorPath(node.path);
    if (node.type === "directory") {
      toggleDirectory(node.path);
    } else {
      setSelectedPath(node.path);
    }
  };

  const openExplorerContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    setExplorerContextMenuPosition({ left: event.clientX, top: event.clientY });

    const isBulkSelection = selectedExplorerPathSet.has(node.path) && selectedExplorerPaths.length > 1;

    if (!isBulkSelection) {
      setSelectedExplorerPaths([node.path]);
      setExplorerSelectionAnchorPath(node.path);
    }

    const bulkPaths = isBulkSelection ? getTopLevelPaths(selectedExplorerPaths) : undefined;

    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      mode: isBulkSelection ? "multi" : "single",
      nodePath: node.path,
      nodeName: node.name,
      nodeType: node.type,
      bulkPaths
    });
  };

  const openExplorerRootContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-tree-node='true']")) return;
    event.preventDefault();
    setExplorerContextMenuPosition({ left: event.clientX, top: event.clientY });
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      mode: "single",
      nodePath: "",
      nodeName: "Project",
      nodeType: "directory"
    });
  };

  useEffect(() => {
    if (!explorerContextMenu || !explorerMenuRef.current) return;

    const margin = 8;
    const rect = explorerMenuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const left = Math.min(Math.max(explorerContextMenu.x, margin), maxLeft);
    const top = Math.min(Math.max(explorerContextMenu.y, margin), maxTop);

    setExplorerContextMenuPosition((current) =>
      current.left === left && current.top === top ? current : { left, top }
    );
  }, [explorerContextMenu]);

  const openUploadFilesPicker = (targetParentRelativePath = "") => {
    uploadTargetPathRef.current = normalizeRelativePath(targetParentRelativePath);
    uploadFilesInputRef.current?.click();
  };

  const openUploadFolderPicker = (targetParentRelativePath = "") => {
    uploadTargetPathRef.current = normalizeRelativePath(targetParentRelativePath);
    uploadFolderInputRef.current?.click();
  };

  const handleExplorerCreateEntry = (kind: "file" | "directory") => {
    if (!explorerContextMenu || explorerContextMenu.mode === "multi") return;
    const parentRelativePath =
      explorerContextMenu.nodeType === "directory"
        ? explorerContextMenu.nodePath
        : getParentDirectoryPath(explorerContextMenu.nodePath);
    setExplorerEntryDialog({
      mode: kind === "file" ? "create-file" : "create-folder",
      parentRelativePath,
      initialName: kind === "file" ? "new-file.tex" : "new-folder"
    });
    setExplorerEntryNameInput(kind === "file" ? "new-file.tex" : "new-folder");
    setExplorerContextMenu(null);
  };

  const handleExplorerRenameEntry = () => {
    if (!explorerContextMenu || explorerContextMenu.mode !== "single" || !explorerContextMenu.nodePath) return;
    setExplorerEntryDialog({
      mode: "rename",
      targetPath: explorerContextMenu.nodePath,
      targetType: explorerContextMenu.nodeType,
      initialName: explorerContextMenu.nodeName
    });
    setExplorerEntryNameInput(explorerContextMenu.nodeName);
    setExplorerContextMenu(null);
  };

  const handleExplorerUploadFilesAction = () => {
    if (!explorerContextMenu || explorerContextMenu.mode === "multi") return;
    const targetParent =
      explorerContextMenu.nodeType === "directory"
        ? explorerContextMenu.nodePath
        : getParentDirectoryPath(explorerContextMenu.nodePath);
    setExplorerContextMenu(null);
    openUploadFilesPicker(targetParent);
  };

  const handleExplorerUploadFolderAction = () => {
    if (!explorerContextMenu || explorerContextMenu.mode === "multi") return;
    const targetParent =
      explorerContextMenu.nodeType === "directory"
        ? explorerContextMenu.nodePath
        : getParentDirectoryPath(explorerContextMenu.nodePath);
    setExplorerContextMenu(null);
    openUploadFolderPicker(targetParent);
  };

  const handleSubmitExplorerEntryDialog = async () => {
    if (!activeUser || !selectedBook || !explorerEntryDialog) return;
    const name = explorerEntryNameInput.trim();
    if (!name) {
      setNotice({ tone: "error", text: "Name cannot be empty." });
      return;
    }

    const dialog = explorerEntryDialog;
    setExplorerEntryDialog(null);

    try {
      if (dialog.mode === "create-file") {
        const created = await window.fastChapter.createProjectFile({
          username: activeUser,
          bookId: selectedBook.id,
          parentRelativePath: dialog.parentRelativePath || "",
          name
        });

        await refreshWorkspaceData(activeUser, selectedBook.id, true);
        await refreshBooks(activeUser);
        setSelectedExplorerPaths([created.path]);
        setExplorerSelectionAnchorPath(created.path);
        if (isEditableFile(created.path)) {
          setSelectedPath(created.path);
        }
        setNotice({ tone: "success", text: `Created ${created.path}` });
        return;
      }

      if (dialog.mode === "create-folder") {
        const created = await window.fastChapter.createProjectDirectory({
          username: activeUser,
          bookId: selectedBook.id,
          parentRelativePath: dialog.parentRelativePath || "",
          name
        });

        await refreshWorkspaceData(activeUser, selectedBook.id, true);
        await refreshBooks(activeUser);
        setSelectedExplorerPaths([created.path]);
        setExplorerSelectionAnchorPath(created.path);
        setNotice({ tone: "success", text: `Created folder ${created.path}` });
        return;
      }

      const previousPath = dialog.targetPath || "";
      if (!previousPath) {
        setNotice({ tone: "error", text: "Missing target path to rename." });
        return;
      }

      const renamed = await window.fastChapter.renameProjectEntry({
        username: activeUser,
        bookId: selectedBook.id,
        relativePath: previousPath,
        nextName: name
      });

      remapSelectedPathAfterPathChange(previousPath, renamed.path, dialog.targetType || "file");
      await refreshWorkspaceData(activeUser, selectedBook.id, true);
      await refreshBooks(activeUser);
      setSelectedExplorerPaths([renamed.path]);
      setExplorerSelectionAnchorPath(renamed.path);
      setNotice({ tone: "success", text: `Renamed to ${renamed.path}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleExplorerDeleteEntry = async () => {
    if (!activeUser || !selectedBook || !explorerContextMenu) return;
    const isBulkDelete = explorerContextMenu.mode === "multi";
    const targetPaths = isBulkDelete
      ? getTopLevelPaths(explorerContextMenu.bulkPaths || selectedExplorerPaths)
      : [explorerContextMenu.nodePath];
    setExplorerContextMenu(null);

    if (targetPaths.length === 0) return;

    const shouldDelete = isBulkDelete
      ? window.confirm(`Delete ${targetPaths.length} selected items?`)
      : window.confirm(
          `Delete ${explorerContextMenu.nodeType === "directory" ? "folder" : "file"} "${explorerContextMenu.nodeName}"?`
        );

    if (!shouldDelete) return;

    try {
      for (const targetPath of [...targetPaths].sort((a, b) => b.length - a.length)) {
        await window.fastChapter.deleteProjectEntry({
          username: activeUser,
          bookId: selectedBook.id,
          relativePath: targetPath
        });
      }

      const selectionWasDeleted = targetPaths.some((targetPath) => {
        const targetType = explorerPathTypeMap.get(targetPath) || "file";
        return (
          selectedPath === targetPath ||
          (targetType === "directory" && Boolean(selectedPath?.startsWith(`${targetPath}/`)))
        );
      });

      await refreshWorkspaceData(activeUser, selectedBook.id, !selectionWasDeleted);
      await refreshBooks(activeUser);
      setSelectedExplorerPaths([]);
      setExplorerSelectionAnchorPath(null);
      setNotice({
        tone: "success",
        text: isBulkDelete
          ? `Deleted ${targetPaths.length} item${targetPaths.length === 1 ? "" : "s"}`
          : `Deleted ${explorerContextMenu.nodeName}`
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error("Failed reading file."));
      reader.onload = () => {
        const value = typeof reader.result === "string" ? reader.result : "";
        const commaIndex = value.indexOf(",");
        resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
      };
      reader.readAsDataURL(file);
    });

  const uploadCandidatesToProject = async (candidates: UploadCandidate[], targetParentRelativePath = "") => {
    if (!activeUser || !selectedBook) return;
    if (candidates.length === 0) return;

    try {
      setIsBusy(true);
      const normalizedTargetParent = normalizeRelativePath(targetParentRelativePath);

      for (const candidate of candidates) {
        const relativePath = joinRelativePath(normalizedTargetParent, candidate.relativePath);
        if (!relativePath) continue;
        const base64Content = await readFileAsBase64(candidate.file);
        await window.fastChapter.writeProjectBinaryFile({
          username: activeUser,
          bookId: selectedBook.id,
          relativePath,
          base64Content
        });
      }

      await refreshWorkspaceData(activeUser, selectedBook.id, true);
      await refreshBooks(activeUser);
      setNotice({
        tone: "success",
        text: `Uploaded ${candidates.length} item${candidates.length === 1 ? "" : "s"}.`
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsBusy(false);
    }
  };

  const handleUploadFilesInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    const candidates: UploadCandidate[] = files.map((file) => ({
      relativePath: file.name,
      file
    }));
    void uploadCandidatesToProject(candidates, uploadTargetPathRef.current);
  };

  const handleUploadFolderInputChange = (event: ReactChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    const candidates: UploadCandidate[] = files.map((file) => {
      const withRelative = file as File & { webkitRelativePath?: string };
      return {
        relativePath: normalizeRelativePath(withRelative.webkitRelativePath || file.name),
        file
      };
    });
    void uploadCandidatesToProject(candidates, uploadTargetPathRef.current);
  };

  const collectDroppedCandidates = async (dataTransfer: DataTransfer) => {
    const items = Array.from(dataTransfer.items || []);
    const output: UploadCandidate[] = [];
    let consumedEntries = false;

    const walkEntry = async (entry: any, parentRelativePath: string) => {
      if (entry?.isFile) {
        const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
        output.push({
          relativePath: joinRelativePath(parentRelativePath, entry.name || file.name),
          file
        });
        return;
      }

      if (!entry?.isDirectory) return;

      const folderRelativePath = joinRelativePath(parentRelativePath, entry.name);
      const reader = entry.createReader();

      while (true) {
        const children: any[] = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (children.length === 0) break;

        for (const child of children) {
          await walkEntry(child, folderRelativePath);
        }
      }
    };

    for (const item of items) {
      const maybeEntry = (item as DataTransferItem & { webkitGetAsEntry?: () => any }).webkitGetAsEntry?.();
      if (!maybeEntry) continue;
      consumedEntries = true;
      await walkEntry(maybeEntry, "");
    }

    if (!consumedEntries) {
      const fallbackFiles = Array.from(dataTransfer.files || []);
      fallbackFiles.forEach((file) => {
        const withRelative = file as File & { webkitRelativePath?: string };
        output.push({
          relativePath: normalizeRelativePath(withRelative.webkitRelativePath || file.name),
          file
        });
      });
    }

    return output;
  };

  const canMovePathToDirectory = (
    sourcePath: string,
    sourceType: "file" | "directory",
    targetDirectoryPath: string
  ) => {
    const sourceParentPath = getParentDirectoryPath(sourcePath);
    if (sourceParentPath === targetDirectoryPath) return false;
    if (sourceType === "directory") {
      if (targetDirectoryPath === sourcePath) return false;
      if (targetDirectoryPath.startsWith(`${sourcePath}/`)) return false;
    }
    return true;
  };

  const canMoveSelectionToDirectory = (dragState: ExplorerDragState, targetDirectoryPath: string) => {
    let hasMovableItem = false;

    for (const sourcePath of dragState.paths) {
      const sourceType = explorerPathTypeMap.get(sourcePath) || "file";
      if (!canMovePathToDirectory(sourcePath, sourceType, targetDirectoryPath)) {
        if (sourceType === "directory" && (targetDirectoryPath === sourcePath || targetDirectoryPath.startsWith(`${sourcePath}/`))) {
          return false;
        }
        continue;
      }
      hasMovableItem = true;
    }

    return hasMovableItem;
  };

  const handleMoveExplorerEntry = async (targetDirectoryPath: string) => {
    if (!activeUser || !selectedBook || !draggedExplorerNode) return;
    const dragState = draggedExplorerNode;
    const normalizedTargetDirectory = normalizeRelativePath(targetDirectoryPath);

    if (!canMoveSelectionToDirectory(dragState, normalizedTargetDirectory)) {
      setDraggedExplorerNode(null);
      setExplorerDropTargetDirectory(null);
      return;
    }

    try {
      const movedEntries: Array<{ sourcePath: string; destinationPath: string; sourceType: "file" | "directory" }> = [];

      for (const sourcePath of dragState.paths) {
        const sourceType = explorerPathTypeMap.get(sourcePath) || "file";
        if (!canMovePathToDirectory(sourcePath, sourceType, normalizedTargetDirectory)) {
          continue;
        }

        const moved = await window.fastChapter.moveProjectEntry({
          username: activeUser,
          bookId: selectedBook.id,
          relativePath: sourcePath,
          targetParentRelativePath: normalizedTargetDirectory
        });
        movedEntries.push({
          sourcePath,
          destinationPath: moved.path,
          sourceType
        });
      }

      const applyAllRemaps = (pathValue: string) =>
        movedEntries.reduce(
          (current, entry) =>
            remapPathValueAfterPathChange(current, entry.sourcePath, entry.destinationPath, entry.sourceType),
          pathValue
        );

      setSelectedPath((current) => (current ? applyAllRemaps(current) : current));
      setSelectedExplorerPaths((current) => {
        const base = current.length > 0 ? current : dragState.paths;
        return [...new Set(base.map((pathValue) => applyAllRemaps(pathValue)))];
      });
      setExplorerSelectionAnchorPath((current) => (current ? applyAllRemaps(current) : current));

      await refreshWorkspaceData(activeUser, selectedBook.id, true);
      await refreshBooks(activeUser);
      setNotice({
        tone: "success",
        text: movedEntries.length === 1
          ? `Moved to ${movedEntries[0].destinationPath}`
          : `Moved ${movedEntries.length} items`
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setDraggedExplorerNode(null);
      setExplorerDropTargetDirectory(null);
    }
  };

  const handleExplorerNodeDragStart = (event: ReactDragEvent<HTMLButtonElement>, node: FileNode) => {
    const selectedTopLevelPaths = getTopLevelPaths(selectedExplorerPaths);
    const useBulkSelection =
      selectedExplorerPathSet.has(node.path) && selectedTopLevelPaths.length > 1;
    const dragPaths = useBulkSelection ? selectedTopLevelPaths : [node.path];

    if (!useBulkSelection) {
      setSelectedExplorerPaths([node.path]);
      setExplorerSelectionAnchorPath(node.path);
    }

    setDraggedExplorerNode({ paths: dragPaths });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", dragPaths.join("\n"));
  };

  const handleExplorerNodeDragEnd = () => {
    setDraggedExplorerNode(null);
    setExplorerDropTargetDirectory(null);
    setIsExplorerDropZoneActive(false);
  };

  const handleExplorerNodeDragOver = (event: ReactDragEvent<HTMLButtonElement>, node: FileNode) => {
    const types = Array.from(event.dataTransfer.types || []);
    const hasExternalFiles = types.includes("Files");

    if (draggedExplorerNode) {
      const targetDirectoryPath = node.type === "directory" ? node.path : getParentDirectoryPath(node.path);
      if (!canMoveSelectionToDirectory(draggedExplorerNode, targetDirectoryPath)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setExplorerDropTargetDirectory(targetDirectoryPath);
      setIsExplorerDropZoneActive(false);
      return;
    }

    if (hasExternalFiles) {
      const targetDirectoryPath = node.type === "directory" ? node.path : getParentDirectoryPath(node.path);
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      setExplorerDropTargetDirectory(targetDirectoryPath);
      setIsExplorerDropZoneActive(true);
    }
  };

  const handleUploadFromDataTransfer = async (dataTransfer: DataTransfer, targetDirectoryPath: string) => {
    const candidates = await collectDroppedCandidates(dataTransfer);
    if (candidates.length === 0) return;
    await uploadCandidatesToProject(candidates, targetDirectoryPath);
  };

  const handleExplorerNodeDrop = (event: ReactDragEvent<HTMLButtonElement>, node: FileNode) => {
    const targetDirectoryPath = node.type === "directory" ? node.path : getParentDirectoryPath(node.path);
    event.preventDefault();
    event.stopPropagation();
    setIsExplorerDropZoneActive(false);

    if (draggedExplorerNode) {
      void handleMoveExplorerEntry(targetDirectoryPath);
      return;
    }

    void handleUploadFromDataTransfer(event.dataTransfer, targetDirectoryPath).finally(() => {
      setExplorerDropTargetDirectory(null);
    });
  };

  const handleExplorerContainerDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer.types || []);
    const hasExternalFiles = types.includes("Files");
    if (!draggedExplorerNode && !hasExternalFiles) return;

    event.preventDefault();

    if (draggedExplorerNode) {
      if (!canMoveSelectionToDirectory(draggedExplorerNode, "")) return;
      event.dataTransfer.dropEffect = "move";
      setExplorerDropTargetDirectory("");
      return;
    }

    event.dataTransfer.dropEffect = "copy";
    setIsExplorerDropZoneActive(true);
    setExplorerDropTargetDirectory("");
  };

  const handleExplorerContainerDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    if (!draggedExplorerNode) {
      setExplorerDropTargetDirectory(null);
    }
    setIsExplorerDropZoneActive(false);
  };

  const handleExplorerContainerDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsExplorerDropZoneActive(false);
    if (draggedExplorerNode) {
      void handleMoveExplorerEntry("");
      return;
    }

    void handleUploadFromDataTransfer(event.dataTransfer, "").finally(() => {
      setExplorerDropTargetDirectory(null);
    });
  };

  const stopCaptureAndFinalize = async (options?: { discard?: boolean; showNotice?: boolean }) => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") {
      return capturedAudio;
    }

    const shouldDiscard = options?.discard === true;
    discardCapturedAudioOnStopRef.current = shouldDiscard;

    const result = await new Promise<CapturedAudio | null>((resolve) => {
      pendingCaptureResolveRef.current = resolve;
      mediaRecorderRef.current?.stop();
      mediaRecorderRef.current = null;
    });

    if (options?.showNotice !== false) {
      setNotice({
        tone: "info",
        text: shouldDiscard ? "Recording discarded." : "Recording captured."
      });
    }

    return result;
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
        reader.onerror = () => {
          pendingCaptureResolveRef.current?.(null);
          pendingCaptureResolveRef.current = null;
          discardCapturedAudioOnStopRef.current = false;
        };
        reader.onloadend = () => {
          const result = typeof reader.result === "string" ? reader.result : "";
          const payload: CapturedAudio = { base64: result, mimeType: recorder.mimeType || "audio/webm" };
          const shouldDiscard = discardCapturedAudioOnStopRef.current;
          setCapturedAudio(shouldDiscard ? null : payload);
          pendingCaptureResolveRef.current?.(shouldDiscard ? null : payload);
          pendingCaptureResolveRef.current = null;
          discardCapturedAudioOnStopRef.current = false;
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
    if (!isCapturing) return;
    stopCaptureAndFinalize({ discard: false, showNotice: true }).catch(() => {
      setNotice({ tone: "error", text: "Failed to finalize recording." });
    });
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
      const finalizedAudio = isCapturing ? await stopCaptureAndFinalize({ discard: false, showNotice: false }) : capturedAudio;
      const result = await window.fastChapter.saveRecording({
        username: activeUser,
        bookId: selectedBook.id,
        kind,
        chapterIndex: recordingKind === "chapter-recording" ? recordingChapter : undefined,
        transcript: recordingTranscript,
        audioBase64: finalizedAudio?.base64,
        mimeType: finalizedAudio?.mimeType
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

  const resetWriteBookFlowState = () => {
    setWriteBookStep("checklist");
    setWriteBookChecklist(null);
    setCodexAvailability(null);
    setWriteBookSession(null);
    setWriteBookSessionLogs([]);
    writeBookSessionIdRef.current = null;
    writeBookLogCursorRef.current = 0;
  };

  const loadWriteBookChecklist = async () => {
    if (!activeUser || !selectedBook) return;

    try {
      setIsLoadingWriteBookChecklist(true);
      const checklist = await window.fastChapter.getWriteBookChecklist({
        username: activeUser,
        bookId: selectedBook.id
      });
      setWriteBookChecklist(checklist);
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsLoadingWriteBookChecklist(false);
    }
  };

  const checkCodexAvailability = async () => {
    try {
      setIsCheckingCodexAvailability(true);
      const result = await window.fastChapter.checkCodexAvailability();
      setCodexAvailability(result);
      if (result.installed) {
        setNotice({
          tone: result.authenticated ? "success" : "info",
          text: result.message
        });
      } else {
        setNotice({ tone: "error", text: result.message });
      }
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsCheckingCodexAvailability(false);
    }
  };

  const pollWriteBookSession = async (sessionIdOverride?: string) => {
    const sessionId = sessionIdOverride || writeBookSessionIdRef.current;
    if (!sessionId) return;

    try {
      const snapshot = await window.fastChapter.getWriteBookSession({
        sessionId,
        afterLogIndex: writeBookLogCursorRef.current
      });

      setWriteBookSession(snapshot);
      writeBookSessionIdRef.current = snapshot.sessionId;
      writeBookLogCursorRef.current = snapshot.nextLogIndex;
      if (snapshot.logs.length > 0) {
        setWriteBookSessionLogs((current) => [...current, ...snapshot.logs]);
      }

      if (
        snapshot.status === "completed" ||
        snapshot.status === "failed" ||
        snapshot.status === "cancelled"
      ) {
        setWriteBookStep("complete");
      } else {
        setWriteBookStep("running");
      }
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleOpenWriteBookDialog = () => {
    if (!activeUser || !selectedBook) return;

    if (isWriteBookRunning && writeBookSessionIdRef.current) {
      setIsWriteBookDialogOpen(true);
      setWriteBookStep("running");
      void pollWriteBookSession(writeBookSessionIdRef.current);
      return;
    }

    resetWriteBookFlowState();
    setIsWriteBookDialogOpen(true);
    void loadWriteBookChecklist();
  };

  const handleWriteBookNextFromChecklist = () => {
    setWriteBookStep("codex");
    void checkCodexAvailability();
  };

  const handleStartWriteBookSession = async () => {
    if (!activeUser || !selectedBook) return;

    try {
      setIsStartingWriteBookSession(true);
      const started = await window.fastChapter.startWriteBookSession({
        username: activeUser,
        bookId: selectedBook.id
      });

      writeBookSessionIdRef.current = started.sessionId;
      writeBookLogCursorRef.current = 0;
      setWriteBookSessionLogs([]);
      setWriteBookStep("running");
      await pollWriteBookSession(started.sessionId);
      setNotice({ tone: "info", text: "Write Book session started." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsStartingWriteBookSession(false);
    }
  };

  const handleCancelWriteBookSession = async () => {
    if (!writeBookSessionIdRef.current) return;

    try {
      setIsCancellingWriteBookSession(true);
      await window.fastChapter.cancelWriteBookSession({
        sessionId: writeBookSessionIdRef.current
      });
      setNotice({ tone: "info", text: "Cancellation requested for Write Book." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsCancellingWriteBookSession(false);
    }
  };

  const handleWriteMyBook = () => {
    handleOpenWriteBookDialog();
  };

  const handleOpenSetup = () => {
    setScreen("setup");
    void refreshSetupStatus(undefined, { silent: true });
  };

  const handleOpenPersonalization = () => {
    setScreen("personalization");
    void refreshPromptLibrary(undefined, { silent: false });
  };

  const handleSelectPromptKey = (promptKey: PromptTemplateKey) => {
    setSelectedPromptKey(promptKey);
    const group = promptLibrary?.prompts.find((item) => item.promptKey === promptKey);
    const defaultTemplate = group?.templates.find((template) => template.source === "default");
    setNewPromptVariantName("");
    setNewPromptVariantContent(defaultTemplate?.content || "");
  };

  const handleCreatePromptVariant = async () => {
    if (!activeUser || !selectedPromptGroup) return;

    const name = newPromptVariantName.trim();
    const content = newPromptVariantContent.trim();
    if (!name) {
      setNotice({ tone: "error", text: "Enter a name for the prompt variant." });
      return;
    }
    if (!content) {
      setNotice({ tone: "error", text: "Prompt content cannot be empty." });
      return;
    }

    try {
      setIsCreatingPromptVariant(true);
      await window.fastChapter.createPromptTemplateVariant({
        username: activeUser,
        promptKey: selectedPromptGroup.promptKey,
        name,
        content
      });
      await refreshPromptLibrary(activeUser, { silent: true });
      setNewPromptVariantName("");
      setNotice({ tone: "success", text: "Prompt variant created." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsCreatingPromptVariant(false);
    }
  };

  const handleSetActivePromptTemplate = async (group: PromptTemplateGroup, templateId: string) => {
    if (!activeUser) return;

    try {
      setIsApplyingPromptVariant(true);
      await window.fastChapter.setActivePromptTemplate({
        username: activeUser,
        promptKey: group.promptKey,
        templateId
      });
      await refreshPromptLibrary(activeUser, { silent: true });
      setNotice({ tone: "success", text: `${group.label} active template updated.` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsApplyingPromptVariant(false);
    }
  };

  const handleDeletePromptVariant = async (group: PromptTemplateGroup, templateId: string) => {
    if (!activeUser) return;

    try {
      setIsDeletingPromptVariant(true);
      await window.fastChapter.deletePromptTemplateVariant({
        username: activeUser,
        promptKey: group.promptKey,
        templateId
      });
      await refreshPromptLibrary(activeUser, { silent: true });
      setNotice({ tone: "info", text: "Prompt variant deleted." });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setIsDeletingPromptVariant(false);
    }
  };

  const handleOpenExternalUrl = async (url: string) => {
    try {
      await window.fastChapter.openExternalUrl({ url });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleRefreshSetupStatus = async () => {
    if (!activeUser) return;

    try {
      const status = await refreshSetupStatus(activeUser);
      if (status?.ready) {
        setNotice({ tone: "success", text: "Setup checks passed. You can continue to your bookshelf." });
      } else {
        setNotice({ tone: "info", text: "Setup checks refreshed." });
      }
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
      await refreshSetupStatus(activeUser, { silent: true });
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
      await refreshSetupStatus(activeUser, { silent: true });
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
    } else if (screen === "personalization") {
      setProfileReturnScreen("personalization");
    } else if (screen === "setup") {
      setProfileReturnScreen("setup");
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
            onClick={handleOpenSetup}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent/70"
          >
            <ListChecks className="h-4 w-4" />
            Setup
          </button>
          <button
            type="button"
            onClick={handleOpenPersonalization}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-accent/70"
          >
            <FileText className="h-4 w-4" />
            Personalization
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
              <img src="/logo_no_background.svg" alt="Fast Chapter" className="h-12 w-12 object-contain" />
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
              Books stay local in your configured working directory. You can change it anytime in Setup or Profile.
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

  if (screen === "setup") {
    const setupChecks = setupStatus?.checks;
    const isWindows = /windows/i.test(window.navigator.userAgent);

    return (
      <main className="min-h-screen bg-background px-6 py-6 text-foreground">
        <section className="mx-auto flex w-full max-w-[1300px] flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/70 px-4 py-4">
          <div>
            <h1 className="font-serif text-3xl">Setup</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm required tools and credentials before continuing to your bookshelf.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRefreshSetupStatus} disabled={isLoadingSetupStatus}>
              {isLoadingSetupStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              Recheck
            </Button>
            <Button variant={setupStatus?.ready ? "default" : "secondary"} onClick={() => setScreen("bookshelf")}>
              Open Bookshelf
            </Button>
          </div>
        </section>

        <section className="mx-auto mt-4 grid w-full max-w-[1300px] grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">Working Directory</CardTitle>
              <CardDescription>
                Choose where Fast Chapter stores your local bookshelf, users, and project data.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current path</p>
                <p className="break-all font-mono text-xs text-foreground/90">{workingDirectoryPath || "Loading..."}</p>
              </div>
              <Button variant="outline" onClick={handleChooseWorkingDirectory} disabled={isChoosingWorkingDirectory}>
                {isChoosingWorkingDirectory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
                Choose Directory
              </Button>
              <p className="text-xs text-muted-foreground">
                If you pick a folder not named `FastChapterCWD`, Fast Chapter will create and use a `FastChapterCWD` folder inside it.
                Existing data is not moved automatically.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">OpenAI Key</CardTitle>
              <CardDescription>Needed for transcription and as fallback auth for Codex sessions.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={setupChecks?.openai.ok ? "success" : "secondary"}>
                {setupChecks?.openai.ok ? "Configured" : "Not configured"}
              </Badge>
              <p className="text-xs text-muted-foreground">{setupChecks?.openai.message || "Checking setup..."}</p>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                <Input
                  type="password"
                  value={openAiApiKeyInput}
                  onChange={(event) => setOpenAiApiKeyInput(event.target.value)}
                  placeholder={setupChecks?.openai.hasSavedKey ? "Enter new key to replace current one" : "sk-..."}
                />
                <Button onClick={handleSaveApiKey} disabled={isSavingApiKey}>
                  {isSavingApiKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                  Save
                </Button>
                <Button variant="outline" onClick={handleTestApiKey} disabled={isTestingApiKey}>
                  {isTestingApiKey ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Test
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
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">Codex CLI</CardTitle>
              <CardDescription>Required for Write Book generation flows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={setupChecks?.codex.ok ? "success" : "secondary"}>
                {setupChecks?.codex.ok ? "Ready" : "Needs setup"}
              </Badge>
              <p className="text-xs text-muted-foreground">{setupChecks?.codex.message || "Checking setup..."}</p>
              {setupChecks?.codex.version ? (
                <p className="text-xs text-muted-foreground">Version: {setupChecks.codex.version}</p>
              ) : null}
              {!setupChecks?.codex.installed ? (
                <div className="space-y-2">
                  <p className="rounded-md border border-border bg-muted/20 px-2 py-1 font-mono text-[11px]">
                    npm i -g @openai/codex
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenExternalUrl("https://www.npmjs.com/package/@openai/codex")}
                  >
                    Open Install Page
                  </Button>
                </div>
              ) : !setupChecks?.codex.authenticated ? (
                <div className="space-y-2">
                  <p className="rounded-md border border-border bg-muted/20 px-2 py-1 font-mono text-[11px]">
                    codex login
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenExternalUrl("https://www.npmjs.com/package/@openai/codex")}
                  >
                    Open Codex CLI Guide
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">LaTeX Toolchain</CardTitle>
              <CardDescription>Needed for PDF preview and compile actions (`latexmk` or `pdflatex`).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={setupChecks?.latex.ok ? "success" : "secondary"}>
                {setupChecks?.latex.ok ? "Ready" : "Needs setup"}
              </Badge>
              <p className="text-xs text-muted-foreground">{setupChecks?.latex.message || "Checking setup..."}</p>
              {setupChecks?.latex.available ? (
                <p className="text-xs text-muted-foreground">
                  Detected: {setupChecks.latex.latexmkInstalled ? "latexmk" : ""}{" "}
                  {setupChecks.latex.pdflatexInstalled ? "pdflatex" : ""}
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleOpenExternalUrl(
                        isWindows ? "https://miktex.org/download" : "https://www.tug.org/texlive/"
                      )
                    }
                  >
                    Open {isWindows ? "MiKTeX" : "TeX Live"} Installer
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">Node/npm</CardTitle>
              <CardDescription>Needed for project tooling and local command workflows.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={setupChecks?.npm.ok ? "success" : "secondary"}>
                {setupChecks?.npm.ok ? "Ready" : "Needs setup"}
              </Badge>
              <p className="text-xs text-muted-foreground">{setupChecks?.npm.message || "Checking setup..."}</p>
              {!setupChecks?.npm.installed ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenExternalUrl("https://nodejs.org/en/download")}
                >
                  Open Node.js Download
                </Button>
              ) : null}
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

  if (screen === "personalization") {
    const promptGroups = promptLibrary?.prompts || [];
    const activeGroup = selectedPromptGroup || promptGroups[0] || null;
    const defaultTemplate = activeGroup?.templates.find((template) => template.source === "default") || null;

    return (
      <main className="min-h-screen bg-background px-6 py-6 text-foreground">
        <section className="mx-auto flex w-full max-w-[1300px] items-center justify-between gap-4 rounded-xl border border-border/60 bg-card/70 px-4 py-3 shadow-sm">
          <div>
            <h1 className="font-serif text-3xl">Personalization</h1>
            <p className="text-sm text-muted-foreground">
              Create your own prompt variants, keep defaults read-only, and choose which version is active.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void refreshPromptLibrary();
              }}
              disabled={isLoadingPromptLibrary}
            >
              {isLoadingPromptLibrary ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
            <Button variant="outline" onClick={() => setScreen("bookshelf")}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        </section>

        <section className="mx-auto mt-4 grid w-full max-w-[1300px] grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="border-border/70 bg-card/65">
            <CardHeader>
              <CardTitle className="text-base">Prompt Groups</CardTitle>
              <CardDescription>Select a prompt file to manage variants.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {promptGroups.map((group) => {
                const activeTemplate = group.templates.find((template) => template.id === group.activeTemplateId);
                return (
                  <button
                    key={group.promptKey}
                    type="button"
                    onClick={() => handleSelectPromptKey(group.promptKey)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-xs ${
                      selectedPromptKey === group.promptKey
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/70 bg-background/40 hover:bg-accent/60"
                    }`}
                  >
                    <p className="font-medium">{group.label}</p>
                    <p className="mt-1 text-muted-foreground">Active: {activeTemplate?.name || "Default"}</p>
                  </button>
                );
              })}
              {promptGroups.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {isLoadingPromptLibrary ? "Loading prompts..." : "No prompt metadata found."}
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-border/70 bg-card/65">
              <CardHeader>
                <CardTitle className="text-base">Default Template</CardTitle>
                <CardDescription>
                  This is the built-in prompt and cannot be edited or deleted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-56 rounded-md border border-border/70 bg-background/40 p-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
                    {defaultTemplate?.content || "Select a prompt group to view the default template."}
                  </pre>
                </ScrollArea>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/65">
              <CardHeader>
                <CardTitle className="text-base">Available Variants</CardTitle>
                <CardDescription>Choose an active prompt variant for this group.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {activeGroup?.templates.map((template) => {
                  const isActive = activeGroup.activeTemplateId === template.id;
                  return (
                    <div key={template.id} className="rounded-md border border-border/70 bg-background/40 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{template.name}</p>
                          <Badge variant={template.source === "default" ? "secondary" : "outline"}>
                            {template.source}
                          </Badge>
                          {isActive ? <Badge variant="success">active</Badge> : null}
                        </div>
                        <div className="flex items-center gap-1">
                          {!isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={isApplyingPromptVariant}
                              onClick={() => void handleSetActivePromptTemplate(activeGroup, template.id)}
                            >
                              Use
                            </Button>
                          )}
                          {template.source === "custom" && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs text-rose-300 hover:bg-rose-500/20"
                              disabled={isDeletingPromptVariant}
                              onClick={() => void handleDeletePromptVariant(activeGroup, template.id)}
                            >
                              Delete
                            </Button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 line-clamp-2 text-muted-foreground">
                        {template.content.slice(0, 180) || "(empty)"}
                      </p>
                    </div>
                  );
                })}
                {!activeGroup && (
                  <p className="text-xs text-muted-foreground">
                    {isLoadingPromptLibrary ? "Loading variants..." : "No prompt group selected."}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/65">
              <CardHeader>
                <CardTitle className="text-base">Create Variant</CardTitle>
                <CardDescription>Create a custom version based on the selected prompt group.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="prompt-variant-name">Variant name</Label>
                  <Input
                    id="prompt-variant-name"
                    value={newPromptVariantName}
                    onChange={(event) => setNewPromptVariantName(event.target.value)}
                    placeholder="My concise style"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prompt-variant-content">Prompt content</Label>
                  <Textarea
                    id="prompt-variant-content"
                    value={newPromptVariantContent}
                    onChange={(event) => setNewPromptVariantContent(event.target.value)}
                    className="min-h-52 font-mono text-[12px]"
                    placeholder="Write your custom prompt variant..."
                  />
                </div>
                <div className="flex items-center justify-end">
                  <Button onClick={() => void handleCreatePromptVariant()} disabled={!activeGroup || isCreatingPromptVariant}>
                    {isCreatingPromptVariant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Save Variant
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
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
            <Button variant="outline" onClick={handleOpenSetup}>
              <Settings className="mr-2 h-4 w-4" />
              Setup
            </Button>
            <Button variant="outline" onClick={handleOpenPersonalization}>
              <FileText className="mr-2 h-4 w-4" />
              Personalization
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleOpenExternalUrl("https://github.com/maestromaximo/FastChapter")}
              title="Open Fast Chapter on GitHub"
              aria-label="Open Fast Chapter on GitHub"
            >
              <Github className="h-4 w-4" />
            </Button>
            <Button onClick={() => setIsCreateBookOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Book
            </Button>
          </div>
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
              <CardDescription>Stored locally on this machine.</CardDescription>
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
              <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Working directory</p>
                <p className="break-all font-mono text-xs text-foreground/90">{workingDirectoryPath || "Not loaded yet"}</p>
              </div>
              <Button variant="outline" onClick={handleChooseWorkingDirectory} disabled={isChoosingWorkingDirectory}>
                {isChoosingWorkingDirectory ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
                Choose Working Directory
              </Button>
              <p className="text-xs text-muted-foreground">
                If the selected folder is not named `FastChapterCWD`, the app creates `FastChapterCWD` inside it.
                Existing data is not moved automatically.
              </p>
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
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex w-full shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card/50 px-4 py-2 shadow-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setScreen("bookshelf");
            setSelectedBook(null);
          }}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Bookshelf
        </Button>

        <div className="flex items-center">
          <Input
            value={bookTitleDraft}
            onChange={(event) => setBookTitleDraft(event.target.value)}
            className="h-8 w-[200px] border-transparent bg-transparent px-2 font-medium hover:border-border focus:border-border"
            placeholder="Book title"
          />
          <Button variant="ghost" size="sm" onClick={handleRenameBook}>
            <Check className="h-4 w-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Button variant="ghost" size="sm" onClick={handleStartProcess}>
          <Sparkles className="mr-2 h-4 w-4" />
          Start Process
        </Button>
        <Button variant="secondary" size="sm" onClick={handleWriteMyBook}>
          <WandSparkles className="mr-2 h-4 w-4" />
          Write Book
        </Button>
        <Button variant={isVoicePaneOpen ? "outline" : "ghost"} size="sm" onClick={() => setIsVoicePaneOpen((current) => !current)}>
          Voice Pane ({isVoicePaneOpen ? "On" : "Off"})
        </Button>
        <Button variant="ghost" size="sm" onClick={handleOpenExportDialog}>
          <Download className="mr-2 h-4 w-4" />
          Export
        </Button>

        <div className="ml-auto flex items-center gap-2 text-xs">
          <Badge variant={hasRecordings ? "success" : "secondary"} className="text-[10px] uppercase">
            {hasRecordings ? "Seeded" : "Needs recording"}
          </Badge>
          <span className="font-mono text-muted-foreground">{selectedBook?.id.slice(0, 8)}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">Ctrl+L</span>
        </div>
      </header>

      <section
        className={`flex-1 grid min-h-0 w-full grid-cols-1 divide-x divide-border ${
          isVoicePaneOpen ? "xl:grid-cols-[260px_1fr_320px]" : "xl:grid-cols-[260px_1fr]"
        }`}
      >
        <div className="flex h-full min-h-0 flex-col bg-card/30">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold tracking-tight">Project Navigator</h2>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCreateChapter} title="Create Chapter">
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openUploadFilesPicker("")} title="Upload Files">
                <Upload className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openUploadFolderPicker("")} title="Upload Folder">
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div
            className={`flex-1 overflow-auto ${
              isExplorerDropZoneActive || (draggedExplorerNode && explorerDropTargetDirectory === "")
                ? "bg-primary/5 ring-inset ring-1 ring-primary/60"
                : ""
            }`}
            onContextMenu={openExplorerRootContextMenu}
            onDragOver={handleExplorerContainerDragOver}
            onDragLeave={handleExplorerContainerDragLeave}
            onDrop={handleExplorerContainerDrop}
          >
            <div className="p-2 space-y-0.5">
              {renderTree(
                tree,
                0,
                collapsedDirs,
                selectedExplorerPathSet,
                handleExplorerNodeClick,
                openExplorerContextMenu,
                draggedExplorerNode,
                explorerDropTargetDirectory,
                handleExplorerNodeDragStart,
                handleExplorerNodeDragEnd,
                handleExplorerNodeDragOver,
                handleExplorerNodeDrop
              )}
            </div>
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col bg-background min-w-0">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2 bg-card/30">
            <h2 className="text-sm font-semibold tracking-tight">Writing Bench</h2>
            <div className="flex items-center gap-2">
              <Button
                variant={autoCompileOnSave ? "secondary" : "ghost"}
                size="sm"
                className="h-8 text-xs"
                onClick={() => setAutoCompileOnSave((current) => !current)}
              >
                Auto Compile: {autoCompileOnSave ? "On" : "Off"}
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => handleCompileLatex()} disabled={isCompilingLatex || isBusy}>
                {isCompilingLatex ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Compile
              </Button>
              <Button variant="default" size="sm" className="h-8 text-xs" onClick={handleSaveFile} disabled={!editorDirty || !selectedPath || isBusy}>
                <Save className="mr-1.5 h-3.5 w-3.5" />
                Save File
              </Button>
            </div>
          </div>
          
          <div className="flex-1 grid min-h-0 grid-cols-1 divide-x divide-border xl:grid-cols-2">
            <div className="flex flex-col min-h-0">
              <div className="flex shrink-0 items-center border-b border-border bg-muted/20 px-4 py-2">
                <span className="font-mono text-xs text-muted-foreground">{selectedPath || "No file selected"}</span>
              </div>
              {audioPreviewDataUrl ? (
                <div className="flex-1 p-4">
                  <div className="rounded-md border border-border/60 bg-card/40 p-3">
                    <p className="mb-2 text-xs text-muted-foreground">Audio Preview</p>
                    <audio controls src={audioPreviewDataUrl} className="w-full">
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                </div>
              ) : (
                <Textarea
                  value={editorContent}
                  onChange={(event) => setEditorContent(event.target.value)}
                  className="flex-1 resize-none rounded-none border-0 bg-transparent p-4 font-mono text-[13px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
                  placeholder="Select a file from the navigator..."
                />
              )}
            </div>

            <div className="flex flex-col min-h-0 bg-muted/10">
              <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/20 px-4 py-2">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Preview</span>
                <Badge variant={latexPreviewUrl ? "success" : "secondary"} className="h-5 px-1.5 text-[10px]">
                  {latexPreviewUrl ? "Compiled PDF ready" : "No compiled PDF"}
                </Badge>
                {lastLatexCompile && (
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {lastLatexCompile.compiler}
                    {lastLatexCompile.cached ? " (cached)" : ""}
                  </Badge>
                )}
              </div>
              <div className="flex-1 flex flex-col min-h-0 overflow-auto p-4">
                {isCompilingLatex && (
                  <div className="grid h-full place-items-center text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Compiling LaTeX...
                    </span>
                  </div>
                )}

                {!isCompilingLatex && latexPreviewUrl && (
                  <iframe
                    title="LaTeX PDF Preview"
                    src={`${latexPreviewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                    className="h-full w-full rounded-md border border-border/60 bg-white shadow-sm"
                  />
                )}

                {!isCompilingLatex && !latexPreviewUrl && (
                  <div className="grid h-full place-items-center text-center">
                    <div>
                      <p className="font-serif text-lg">No PDF preview yet</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Click Compile to render `main.tex` with your installed LaTeX toolchain.
                      </p>
                      {latexCompileError && (
                        <p className="mt-2 max-w-xl rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-left text-xs text-rose-200">
                          {latexCompileError}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {lastLatexCompile && (
                  <div className="mt-4 shrink-0">
                    <p className="text-[11px] text-muted-foreground">
                      Last compile: {formatDate(lastLatexCompile.generatedAt)} · {formatDurationMs(lastLatexCompile.durationMs)}
                    </p>
                    {lastLatexCompile.logTail && (
                      <details className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
                        <summary className="cursor-pointer text-muted-foreground">Compiler log tail</summary>
                        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-foreground/80">
                          {lastLatexCompile.logTail}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {isVoicePaneOpen && (
        <div className="flex h-full min-h-0 flex-col bg-card/30">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold tracking-tight">Voice Workflow</h2>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                setRecordingKind(hasRecordings ? "chapter-recording" : "initial-outline");
                setIsRecordingDialogOpen(true);
              }}
            >
              <Mic className="mr-1.5 h-3.5 w-3.5" />
              Record
            </Button>
          </div>
          <div className="flex-1 overflow-auto">
            <div className="p-4 space-y-4">
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
            </div>
          </div>
        )}
      </section>

      {explorerContextMenu && (
        <div
          ref={explorerMenuRef}
          className="fixed z-[90] min-w-[180px] rounded-md border border-border/80 bg-card/95 p-1 shadow-xl backdrop-blur"
          style={{ left: explorerContextMenuPosition.left, top: explorerContextMenuPosition.top }}
        >
          {explorerContextMenu.mode === "multi" ? (
            <button
              type="button"
              className="flex w-full rounded px-2 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-500/20"
              onClick={handleExplorerDeleteEntry}
            >
              Delete selected ({(explorerContextMenu.bulkPaths || []).length})
            </button>
          ) : (
            <>
              <button
                type="button"
                className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => handleExplorerCreateEntry("file")}
              >
                New file
              </button>
              <button
                type="button"
                className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => handleExplorerCreateEntry("directory")}
              >
                New folder
              </button>
              <div className="my-1 h-px bg-border/80" />
              <button
                type="button"
                className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={handleExplorerUploadFilesAction}
              >
                Upload files
              </button>
              <button
                type="button"
                className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={handleExplorerUploadFolderAction}
              >
                Upload folder
              </button>

              {explorerContextMenu.nodePath && (
                <>
                  <div className="my-1 h-px bg-border/80" />
                  <button
                    type="button"
                    className="flex w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={handleExplorerRenameEntry}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="flex w-full rounded px-2 py-1.5 text-left text-xs text-rose-300 hover:bg-rose-500/20"
                    onClick={handleExplorerDeleteEntry}
                  >
                    Delete
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      <input
        ref={uploadFilesInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleUploadFilesInputChange}
      />
      <input
        ref={uploadFolderInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleUploadFolderInputChange}
        {...folderUploadInputProps}
      />

      <Dialog
        open={Boolean(explorerEntryDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setExplorerEntryDialog(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {explorerEntryDialog?.mode === "rename"
                ? "Rename Entry"
                : explorerEntryDialog?.mode === "create-file"
                  ? "Create File"
                  : "Create Folder"}
            </DialogTitle>
            <DialogDescription>
              {explorerEntryDialog?.mode === "rename"
                ? "Choose a new name for the selected item."
                : "Enter a name for the new explorer item."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="explorer-entry-name">Name</Label>
            <Input
              id="explorer-entry-name"
              value={explorerEntryNameInput}
              onChange={(event) => setExplorerEntryNameInput(event.target.value)}
              placeholder={explorerEntryDialog?.initialName || "name"}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExplorerEntryDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmitExplorerEntryDialog}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isExportDialogOpen}
        onOpenChange={(open) => {
          if (!isExportingBook) {
            setIsExportDialogOpen(open);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Book ZIP
            </DialogTitle>
            <DialogDescription>
              Choose optional folders to include before selecting where to save the archive.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={exportIncludeTranscriptions}
                onChange={(event) => setExportIncludeTranscriptions(event.target.checked)}
                className="h-4 w-4 rounded border-border bg-background"
              />
              Include `transcriptions/`
            </label>
            <label className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={exportIncludeRecordings}
                onChange={(event) => setExportIncludeRecordings(event.target.checked)}
                className="h-4 w-4 rounded border-border bg-background"
              />
              Include `recordings/`
            </label>
            <p className="text-xs text-muted-foreground">
              Both options are off by default. If left unchecked, those folders are excluded from the ZIP.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsExportDialogOpen(false)} disabled={isExportingBook}>
              Cancel
            </Button>
            <Button onClick={handleExportBookArchive} disabled={isExportingBook}>
              {isExportingBook ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Export ZIP
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isWriteBookDialogOpen}
        onOpenChange={(open) => {
          setIsWriteBookDialogOpen(open);
          if (!open && !isWriteBookRunning) {
            resetWriteBookFlowState();
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WandSparkles className="h-4 w-4" />
              Write Book
            </DialogTitle>
            <DialogDescription>
              Validate your project inputs, verify Codex availability, then run chapter-by-chapter generation in one thread.
            </DialogDescription>
          </DialogHeader>

          {writeBookStep === "checklist" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <ListChecks className="h-3.5 w-3.5" />
                  Project Checklist
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    void loadWriteBookChecklist();
                  }}
                  disabled={isLoadingWriteBookChecklist}
                >
                  {isLoadingWriteBookChecklist ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Refresh
                </Button>
              </div>

              {writeBookChecklist ? (
                <>
                  <div className="space-y-2">
                    {writeBookChecklist.checks.map((checkItem) => (
                      <div
                        key={checkItem.id}
                        className={`rounded-md border px-3 py-2 text-xs ${
                          checkItem.ok
                            ? "border-emerald-500/40 bg-emerald-500/5"
                            : "border-amber-500/40 bg-amber-500/5"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {checkItem.ok ? (
                            <Check className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <CircleAlert className="h-3.5 w-3.5 text-amber-300" />
                          )}
                          <span className="font-medium">{checkItem.label}</span>
                        </div>
                        <p className="mt-1 text-muted-foreground">{checkItem.details}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-md border border-border/70 bg-background/40 p-3">
                    <p className="text-xs font-medium">Chapter coverage</p>
                    <ScrollArea className="mt-2 h-36 pr-2">
                      <div className="space-y-1.5">
                        {writeBookChecklist.chapters.map((chapter) => (
                          <div key={chapter.index} className="rounded border border-border/60 bg-background/70 px-2 py-1.5 text-xs">
                            <p className="font-medium">
                              Chapter {chapter.index} · <span className="font-mono">{chapter.texPath}</span>
                            </p>
                            <p className="text-muted-foreground">
                              recordings: {chapter.recordingCount} · transcriptions: {chapter.transcriptionCount} · seed text:{" "}
                              {chapter.hasSeedText ? "yes" : "no"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    This check is advisory, not a hard stop. You can continue even with warnings.
                  </p>
                </>
              ) : (
                <div className="rounded-md border border-border/70 bg-background/30 p-4 text-xs text-muted-foreground">
                  {isLoadingWriteBookChecklist ? "Loading checklist..." : "Checklist not loaded yet."}
                </div>
              )}
            </div>
          )}

          {writeBookStep === "codex" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <TerminalSquare className="h-3.5 w-3.5" />
                  Codex Environment Check
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    void checkCodexAvailability();
                  }}
                  disabled={isCheckingCodexAvailability}
                >
                  {isCheckingCodexAvailability ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Check
                </Button>
              </div>

              {codexAvailability ? (
                <div className="space-y-2">
                  <div
                    className={`rounded-md border px-3 py-2 text-xs ${
                      codexAvailability.installed
                        ? codexAvailability.authenticated
                          ? "border-emerald-500/40 bg-emerald-500/5"
                          : "border-amber-500/40 bg-amber-500/5"
                        : "border-rose-500/50 bg-rose-500/5"
                    }`}
                  >
                    <p className="font-medium">{codexAvailability.message}</p>
                    {codexAvailability.version ? (
                      <p className="mt-1 text-muted-foreground">Version: {codexAvailability.version}</p>
                    ) : null}
                    {codexAvailability.loginStatus ? (
                      <p className="mt-1 text-muted-foreground">Login: {codexAvailability.loginStatus}</p>
                    ) : null}
                  </div>

                  {codexAvailability.helpPreview ? (
                    <pre className="max-h-44 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/80">
                      {codexAvailability.helpPreview}
                    </pre>
                  ) : null}

                  {!codexAvailability.installed && (
                    <p className="text-xs text-muted-foreground">
                      Install and authenticate with: `npm i -g @openai/codex`, then `codex login`.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Run the check to verify `codex --help` and `codex login status`.
                </p>
              )}
            </div>
          )}

          {writeBookStep === "confirm" && (
            <div className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
              <p>
                This will start Codex chapter generation in the background and stream terminal events here.
              </p>
              <p className="text-xs text-muted-foreground">
                Runtime permissions are scoped to the current book folder (`workspace-write`) with command network access disabled.
              </p>
            </div>
          )}

          {(writeBookStep === "running" || writeBookStep === "complete") && (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs">
                <span>
                  Status:{" "}
                  <span className="font-medium">
                    {writeBookSession?.status || "queued"}
                    {writeBookSession?.currentChapterIndex
                      ? ` · chapter ${writeBookSession.currentChapterIndex}/${writeBookSession.totalChapters || 0}`
                      : ""}
                  </span>
                </span>
                {writeBookSession?.threadId ? (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    thread: {writeBookSession.threadId.slice(0, 12)}
                  </span>
                ) : null}
              </div>

              <div
                ref={writeBookTerminalRef}
                className="h-64 overflow-auto rounded-md border border-border/70 bg-background/80 p-2 font-mono text-[11px] leading-relaxed"
              >
                {writeBookSessionLogs.length === 0 ? (
                  <p className="text-muted-foreground">Waiting for logs...</p>
                ) : (
                  writeBookSessionLogs.map((log) => (
                    <p
                      key={log.index}
                      className={
                        log.tone === "error"
                          ? "text-rose-300"
                          : log.tone === "success"
                            ? "text-emerald-300"
                            : "text-foreground/90"
                      }
                    >
                      [{new Date(log.at).toLocaleTimeString()}] {log.text}
                    </p>
                  ))
                )}
              </div>

              {writeBookSession?.error ? (
                <p className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {writeBookSession.error}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter>
            {writeBookStep === "checklist" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsWriteBookDialogOpen(false);
                  }}
                >
                  Close
                </Button>
                <Button onClick={handleWriteBookNextFromChecklist} disabled={isLoadingWriteBookChecklist}>
                  Next
                </Button>
              </>
            )}

            {writeBookStep === "codex" && (
              <>
                <Button variant="outline" onClick={() => setWriteBookStep("checklist")}>
                  Back
                </Button>
                <Button
                  onClick={() => setWriteBookStep("confirm")}
                  disabled={!codexAvailability?.installed || !codexAvailability?.authenticated || isCheckingCodexAvailability}
                >
                  Next
                </Button>
              </>
            )}

            {writeBookStep === "confirm" && (
              <>
                <Button variant="outline" onClick={() => setWriteBookStep("codex")}>
                  Back
                </Button>
                <Button onClick={handleStartWriteBookSession} disabled={isStartingWriteBookSession}>
                  {isStartingWriteBookSession ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  Start
                </Button>
              </>
            )}

            {(writeBookStep === "running" || writeBookStep === "complete") && (
              <>
                {isWriteBookRunning ? (
                  <Button
                    variant="destructive"
                    onClick={handleCancelWriteBookSession}
                    disabled={isCancellingWriteBookSession}
                  >
                    {isCancellingWriteBookSession ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Square className="mr-2 h-4 w-4" />
                    )}
                    Stop
                  </Button>
                ) : null}

                <Button
                  variant="outline"
                  onClick={() => {
                    setIsWriteBookDialogOpen(false);
                  }}
                >
                  Close
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isRecordingDialogOpen}
        onOpenChange={(open) => {
          setIsRecordingDialogOpen(open);
          if (!open) {
            if (isCapturing) {
              stopCaptureAndFinalize({ discard: true, showNotice: false }).catch(() => {
                // Ignore close-time capture finalization errors.
              });
            }
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
                if (isCapturing) {
                  stopCaptureAndFinalize({ discard: true, showNotice: false }).catch(() => {
                    // Ignore close-time capture finalization errors.
                  });
                }
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
