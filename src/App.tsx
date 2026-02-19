import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
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
import type { BookSummary, FileNode, LatexCompileResult, RecordingBundle, UserProfile } from "@/types/domain";

type AppScreen = "auth" | "bookshelf" | "workspace" | "profile";

type Notice = {
  tone: "info" | "success" | "error";
  text: string;
};

type ExplorerContextMenuState = {
  x: number;
  y: number;
  nodePath: string;
  nodeName: string;
  nodeType: "file" | "directory";
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

function renderTree(
  nodes: FileNode[],
  depth: number,
  collapsed: Record<string, boolean>,
  onToggle: (path: string) => void,
  selectedPath: string | null,
  onSelectFile: (path: string) => void,
  onRightClick: (event: ReactMouseEvent<HTMLButtonElement>, node: FileNode) => void
): JSX.Element[] {
  return nodes.flatMap((node) => {
    const isDir = node.type === "directory";
    const isCollapsed = Boolean(collapsed[node.path]);
    const item = (
      <button
        key={node.path}
        type="button"
        data-tree-node="true"
        onClick={() => (isDir ? onToggle(node.path) : onSelectFile(node.path))}
        onContextMenu={(event) => onRightClick(event, node)}
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

    return [item, ...renderTree(node.children, depth + 1, collapsed, onToggle, selectedPath, onSelectFile, onRightClick)];
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
  const [explorerContextMenu, setExplorerContextMenu] = useState<ExplorerContextMenuState | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [lastSavedContent, setLastSavedContent] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isCompilingLatex, setIsCompilingLatex] = useState(false);
  const [autoCompileOnSave, setAutoCompileOnSave] = useState(true);
  const [latexPreviewUrl, setLatexPreviewUrl] = useState<string | null>(null);
  const [lastLatexCompile, setLastLatexCompile] = useState<LatexCompileResult | null>(null);
  const [latexCompileError, setLatexCompileError] = useState<string | null>(null);
  const [isVoicePaneOpen, setIsVoicePaneOpen] = useState(true);

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
  const explorerMenuRef = useRef<HTMLDivElement | null>(null);

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

  const openExplorerContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, node: FileNode) => {
    event.preventDefault();
    event.stopPropagation();
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodePath: node.path,
      nodeName: node.name,
      nodeType: node.type
    });
  };

  const openExplorerRootContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-tree-node='true']")) return;
    event.preventDefault();
    setExplorerContextMenu({
      x: event.clientX,
      y: event.clientY,
      nodePath: "",
      nodeName: "Project",
      nodeType: "directory"
    });
  };

  const handleExplorerCreateEntry = async (kind: "file" | "directory") => {
    if (!activeUser || !selectedBook || !explorerContextMenu) return;

    const parentRelativePath =
      explorerContextMenu.nodeType === "directory"
        ? explorerContextMenu.nodePath
        : getParentDirectoryPath(explorerContextMenu.nodePath);
    const defaultName = kind === "file" ? "new-file.tex" : "new-folder";
    const input = window.prompt(
      kind === "file" ? "New file name:" : "New folder name:",
      defaultName
    );
    const name = String(input || "").trim();

    setExplorerContextMenu(null);

    if (!name) return;

    try {
      const created =
        kind === "file"
          ? await window.fastChapter.createProjectFile({
              username: activeUser,
              bookId: selectedBook.id,
              parentRelativePath,
              name
            })
          : await window.fastChapter.createProjectDirectory({
              username: activeUser,
              bookId: selectedBook.id,
              parentRelativePath,
              name
            });

      await refreshWorkspaceData(activeUser, selectedBook.id, true);
      await refreshBooks(activeUser);

      if (kind === "file" && isEditableFile(created.path)) {
        setSelectedPath(created.path);
      }

      setNotice({
        tone: "success",
        text: kind === "file" ? `Created ${created.path}` : `Created folder ${created.path}`
      });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleExplorerRenameEntry = async () => {
    if (!activeUser || !selectedBook || !explorerContextMenu) return;

    const nextNameInput = window.prompt("Rename to:", explorerContextMenu.nodeName);
    const nextName = String(nextNameInput || "").trim();
    const previousPath = explorerContextMenu.nodePath;
    const previousType = explorerContextMenu.nodeType;

    setExplorerContextMenu(null);

    if (!nextName || nextName === explorerContextMenu.nodeName) return;

    try {
      const renamed = await window.fastChapter.renameProjectEntry({
        username: activeUser,
        bookId: selectedBook.id,
        relativePath: previousPath,
        nextName
      });

      if (selectedPath) {
        if (selectedPath === previousPath) {
          setSelectedPath(renamed.path);
        } else if (
          previousType === "directory" &&
          selectedPath.startsWith(`${previousPath}/`)
        ) {
          setSelectedPath(`${renamed.path}${selectedPath.slice(previousPath.length)}`);
        }
      }

      await refreshWorkspaceData(activeUser, selectedBook.id, true);
      await refreshBooks(activeUser);
      setNotice({ tone: "success", text: `Renamed to ${renamed.path}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
  };

  const handleExplorerDeleteEntry = async () => {
    if (!activeUser || !selectedBook || !explorerContextMenu) return;

    const noun = explorerContextMenu.nodeType === "directory" ? "folder" : "file";
    const shouldDelete = window.confirm(`Delete ${noun} "${explorerContextMenu.nodeName}"?`);
    const targetPath = explorerContextMenu.nodePath;
    const targetType = explorerContextMenu.nodeType;
    const targetName = explorerContextMenu.nodeName;

    setExplorerContextMenu(null);

    if (!shouldDelete) return;

    try {
      await window.fastChapter.deleteProjectEntry({
        username: activeUser,
        bookId: selectedBook.id,
        relativePath: targetPath
      });

      const selectionWasDeleted =
        selectedPath === targetPath ||
        (targetType === "directory" && Boolean(selectedPath?.startsWith(`${targetPath}/`)));

      await refreshWorkspaceData(activeUser, selectedBook.id, !selectionWasDeleted);
      await refreshBooks(activeUser);

      setNotice({ tone: "success", text: `Deleted ${targetName}` });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    }
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
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCreateChapter}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-auto" onContextMenu={openExplorerRootContextMenu}>
            <div className="p-2 space-y-0.5">
              {renderTree(
                tree,
                0,
                collapsedDirs,
                toggleDirectory,
                selectedPath,
                (filePath) => {
                  setSelectedPath(filePath);
                },
                openExplorerContextMenu
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
              <Textarea
                value={editorContent}
                onChange={(event) => setEditorContent(event.target.value)}
                className="flex-1 resize-none rounded-none border-0 bg-transparent p-4 font-mono text-[13px] leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder="Select a file from the navigator..."
              />
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
          style={{ left: explorerContextMenu.x, top: explorerContextMenu.y }}
        >
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
        </div>
      )}

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
