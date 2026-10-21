import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { MathView, QuestionVisual } from "./question-content";
import "katex/dist/katex.min.css";
import "./style.css";
import "./management-pages.css";
import "./workbench-theme.css";
import { GlideSelect } from "./glide-select";
import { knowledgeOptions } from "./knowledge-options";
import { DocumentPreview } from "./document-preview";
import { HoldButton } from "./hold-button";
import { ImportDropZone } from "./import-drop-zone";
import { ApiGuide, QuickHelp } from "./api-guide";
import { guideValues } from "../shared/guide";
import { SwipeToast } from "./swipe-toast";
import { answerSpaceMm } from "../domain/paper";
import { KnowledgePage } from "./knowledge-page";
import { TasksPage } from "./tasks-page";
import { colorThemes } from "../shared/color-themes";
import { hasQuestionContent } from "../domain/manual-question";
import LatticeLoader from "./lattice-loader";
import {
  FigureImage,
  FigureSizeControl,
  OptionFigureSizeControl,
} from "./figure-image";
import {
  figurePlacementOptions,
  type FigurePlacement,
} from "../domain/figures";
import { HistoryPage, RecentHistory } from "./history-panel";
import { MasonryCards } from "./masonry-cards";
import { SourceViewer } from "./source-viewer";
import { NavIcon, type NavIconName } from "./nav-icon";
import { QuickIcon } from "./quick-icon";
import { MobileImportDialog } from "./mobile-import";
import { ManualSaveDialog, type ManualSaveChoice } from "./manual-save-dialog";
import { KnowledgeTree } from "./knowledge-tree";
import type {
  State,
  Question,
  Collection,
  Filter,
  BackupPreview,
  SettingsInput,
} from "../shared/types";
import { newQuestion, newCollection } from "../shared/types";
import {
  grades,
  kinds,
  difficulties,
  groups,
  decodeKnowledge,
  filterQuestion,
} from "../domain/catalog";
import { readableSolution } from "../domain/math";
const api = window.matheca;
class ManualSaveCancelled extends Error {
  constructor() {
    super("已取消保存");
    this.name = "ManualSaveCancelled";
  }
}
const recordQuery = (title: string, detail = "") => {
  void api
    .recordHistory(title.slice(0, 160), detail.slice(0, 200))
    .catch(() => {});
};
const emptyFilter: Filter = {
  keyword: "",
  grade: "",
  kind: "",
  difficulty: "",
  knowledge: "",
  reviewed: "all",
  favorite: false,
};
function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">全部</option>
        {options.map((v) => (
          <option key={v}>{v}</option>
        ))}
      </select>
    </label>
  );
}
function App() {
  const filterHistoryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pickerHistoryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(filterHistoryTimer.current);
      clearTimeout(pickerHistoryTimer.current);
    },
    [],
  );
  const [page, setPage] = useState(0);
  const [state, setState] = useState<State>(),
    [section, setSection] = useState("library"),
    [filter, setFilter] = useState<Filter>(emptyFilter),
    [active, setActive] = useState<string>(),
    [collectionActive, setCollectionActive] = useState<{
      collectionId: string;
      questionId: string;
    }>(),
    [draft, setDraft] = useState<Question>(),
    [dirty, setDirty] = useState(false),
    [collectionId, setCollectionId] = useState<string>(),
    [paper, setPaper] = useState<Collection>(),
    [settings, setSettings] = useState<SettingsInput>(),
    [error, setError] = useState(""),
    [notice, setNoticeState] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<BackupPreview>(),
    [guideOpen, setGuideOpen] = useState(false),
    [mobileOpen, setMobileOpen] = useState(false),
    [collectionDialog, setCollectionDialog] = useState(false),
    [joinQuestionId, setJoinQuestionId] = useState<string>(),
    [joinTitle, setJoinTitle] = useState(""),
    [collectionPickerOpen, setCollectionPickerOpen] = useState(false),
    [pickerView, setPickerView] = useState<"library" | "selected">("library"),
    [documentPreview, setDocumentPreview] = useState<{
      data: number[];
      format: "pdf" | "docx";
      id: string;
      title: string;
    }>(),
    [pickerFilter, setPickerFilter] = useState<Filter>(emptyFilter),
    [pickerLimit, setPickerLimit] = useState(100),
    [pendingKnowledge, setPendingKnowledge] = useState<string>(),
    [knowledgeConfirmationReady, setKnowledgeConfirmationReady] =
      useState(false),
    [newTitle, setNewTitle] = useState(""),
    [pointGroup, setPointGroup] = useState(Object.keys(groups)[0]),
    [pointName, setPointName] = useState(""),
    [editorWidth, setEditorWidth] = useState(470),
    [editorOpen, setEditorOpen] = useState(false),
    [resumeEditor, setResumeEditor] = useState(false),
    [editorResizing, setEditorResizing] = useState(false),
    [lastExport, setLastExport] = useState<string>(),
    [sourceZoom, setSourceZoom] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [fabOpen, setFabOpen] = useState(false),
    [knowledgeOpen, setKnowledgeOpen] = useState(false),
    [knowledgeHover, setKnowledgeHover] = useState(false);
  const [undoReview, setUndoReview] = useState<Question>();
  const [undoDelete, setUndoDelete] = useState<string>();
  const [undoAdd, setUndoAdd] = useState<string>();
  const [toastId, setToastId] = useState(0);
  const setNotice = (text: string) => {
    setNoticeState(text);
    setUndoReview(undefined);
    setUndoDelete(undefined);
    setUndoAdd(undefined);
    setToastId((id) => id + 1);
  };
  const deletedNotice = (message: string, token: string) => {
    setNotice(message);
    setUndoDelete(token);
  };
  const addToCollection = async (
    id: string,
    questionIds: string[],
    message?: string,
  ) => {
    const result = await api.addQuestionsWithUndo(id, questionIds);
    const title = state?.collections.find((c) => c.id === id)?.title ?? "题集";
    setNotice(
      result.count ? (message ?? `已加入“${title}”`) : `此题已在“${title}”中`,
    );
    setUndoAdd(result.token);
  };
  const [knowledgeMode, setKnowledgeMode] = useState<"docked" | "floating">(
    "docked",
  );
  useEffect(() => {
    setKnowledgeConfirmationReady(false);
    if (pendingKnowledge === undefined) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() =>
        setKnowledgeConfirmationReady(true),
      );
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [pendingKnowledge]);
  const knowledgePanelRef = useRef<HTMLDivElement>(null);
  const pickerPanelRef = useRef<HTMLDivElement>(null);
  const pickerSearchRef = useRef<HTMLInputElement>(null);
  const exportTriggerRef = useRef<HTMLElement | null>(null);
  const closeDocumentPreview = () => {
    setDocumentPreview(undefined);
    requestAnimationFrame(() => exportTriggerRef.current?.focus());
  };
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const closeCollectionPicker = () => {
    setCollectionPickerOpen(false);
    requestAnimationFrame(() => pickerTriggerRef.current?.focus());
  };
  useEffect(() => {
    if (collectionPickerOpen) pickerSearchRef.current?.focus();
  }, [collectionPickerOpen]);
  useEffect(() => {
    setCollectionPickerOpen(false);
  }, [section, collectionId]);
  const knowledgeMotion = useRef<Animation | undefined>(undefined);
  const workspaceMotion = useRef<Animation | undefined>(undefined);
  const workspaceRef = useRef<HTMLElement>(null);
  const previousSidebarWidth = useRef(0);
  useLayoutEffect(() => {
    const panel = knowledgePanelRef.current;
    const previous = knowledgeMotion.current;
    const interrupted = previous?.playState === "running";
    const current = panel ? getComputedStyle(panel).transform : "none";
    previous?.cancel();
    const workspace = workspaceRef.current;
    const width =
      document.querySelector<HTMLElement>(".knowledge-slot")?.offsetWidth ?? 0;
    const motion = workspaceMotion.current;
    const offset =
      workspace && motion?.playState === "running"
        ? new DOMMatrixReadOnly(getComputedStyle(workspace).transform).m41
        : 0;
    motion?.cancel();
    const shift = previousSidebarWidth.current - width + offset;
    previousSidebarWidth.current = width;
    if (!panel || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    if (workspace && Math.abs(shift) > 0.5) {
      const animation = workspace.animate(
        [
          { transform: `translateX(${shift}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: 260, easing: "cubic-bezier(.22,1,.36,1)" },
      );
      workspaceMotion.current = animation;
    }
    if (knowledgeMode === "floating") {
      if (knowledgeHover)
        knowledgeMotion.current = panel.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 180, easing: "ease" },
        );
      return;
    }
    const open = knowledgeOpen && section === "library";
    knowledgeMotion.current = panel.animate(
      [
        {
          transform: interrupted
            ? current
            : open
              ? "translateX(-100%)"
              : "translateX(0)",
        },
        { transform: open ? "translateX(0)" : "translateX(-100%)" },
      ],
      { duration: 300, easing: "cubic-bezier(.4,0,.2,1)" },
    );
  }, [knowledgeOpen, knowledgeMode, knowledgeHover, section]);
  const [navigation, setNavigation] = useState({
    entries: ["library"],
    index: 0,
  });
  const visitSection = (target: string) => {
    if (target === "library" && section !== "library" && editorOpen)
      setResumeEditor(true);
    setNavigation((current) => {
      if (current.entries[current.index] === target) return current;
      const entries = [...current.entries.slice(0, current.index + 1), target];
      return { entries, index: entries.length - 1 };
    });
    setSection(target);
  };
  const knowledgeHoverTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(knowledgeHoverTimer.current);
    setKnowledgeHover(false);
    return () => window.clearTimeout(knowledgeHoverTimer.current);
  }, [knowledgeOpen, section]);
  const selectionRequest = useRef(0);
  const manualDraftId = useRef<string | undefined>(undefined);
  const [manualSavePrompt, setManualSavePrompt] = useState<{
    hasContent: boolean;
  }>();
  const manualSaveRequest = useRef<
    | {
        promise: Promise<ManualSaveChoice>;
        resolve: (choice: ManualSaveChoice) => void;
      }
    | undefined
  >(undefined);
  const libraryReviewOrigin = useRef<
    { questionId: string; scrollTop: number; scrollLeft: number } | undefined
  >(undefined);
  const collectionReviewOrigin = useRef<
    | {
        collectionId: string;
        questionId: string;
        scrollTop: number;
      }
    | undefined
  >(undefined);
  const draftRef = useRef(draft),
    dirtyRef = useRef(dirty),
    saveRef = useRef<() => Promise<void>>(async () => {}),
    searchRef = useRef<HTMLInputElement>(null),
    paperRef = useRef(paper),
    paperDirty = useRef(false),
    settingsDirty = useRef(false);
  draftRef.current = draft;
  dirtyRef.current = dirty;
  paperRef.current = paper;
  const refresh = useCallback(async () => {
    const s = await api.state();
    setState(s);
    setSettings((old) =>
      settingsDirty.current ? old : { ...s.settings, apiKey: "" },
    );
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    return api.onChanged(
      () => void refresh().catch((e) => setError(e.message)),
    );
  }, [refresh]);
  useEffect(() => {
    document.documentElement.dataset.theme = "light";
  }, []);
  useEffect(() => {
    document.documentElement.dataset.colorTheme =
      state?.settings.colorTheme ?? "GRAPHITE";
  }, [state?.settings.colorTheme]);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError("");
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof ManualSaveCancelled))
        setError(e instanceof Error ? e.message : "操作失败");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = async (confirm = false) => {
    const q = draftRef.current;
    const manual = q && manualDraftId.current === q.id;
    if (manual) {
      const hasContent = hasQuestionContent(q);
      let request = manualSaveRequest.current;
      if (!request) {
        let resolve!: (choice: ManualSaveChoice) => void;
        const promise = new Promise<ManualSaveChoice>((done) => {
          resolve = done;
        });
        request = { promise, resolve };
        await api.setManualPromptOpen(true);
        manualSaveRequest.current = request;
        setManualSavePrompt({ hasContent });
      }
      const choice = await request.promise;
      manualSaveRequest.current = undefined;
      setManualSavePrompt(undefined);
      await api.setManualPromptOpen(false);
      if (choice === "cancel") throw new ManualSaveCancelled();
      if (choice === "discard" || !hasContent) {
        if (state?.questions.some((question) => question.id === q.id))
          await api.deleteQuestion(q.id);
        manualDraftId.current = undefined;
        draftRef.current = undefined;
        dirtyRef.current = false;
        setDraft(undefined);
        setDirty(false);
        setEditorOpen(false);
        setNotice(
          choice === "discard" ? "已放弃这次录入" : "空白题目未加入题库",
        );
        return;
      }
    }
    if (q && (dirtyRef.current || confirm || manual)) {
      const saved = await api.saveQuestion(q, confirm && !manual);
      if (manual) manualDraftId.current = undefined;
      draftRef.current = saved;
      dirtyRef.current = false;
      setDraft(saved);
      setDirty(false);
    }
    if (paperDirty.current && paperRef.current) {
      const saving = paperRef.current;
      await api.saveCollection(saving);
      if (paperRef.current === saving) paperDirty.current = false;
    }
  };
  saveRef.current = () => saveDraft();
  useEffect(
    () =>
      api.onBeforeClose(async () => {
        try {
          await saveRef.current();
        } catch (e) {
          if (!(e instanceof ManualSaveCancelled))
            setError(e instanceof Error ? e.message : "草稿保存失败");
          throw e;
        }
      }),
    [],
  );
  const finishEditorClose = () => {
    setSourceZoom(false);
    setDraft(undefined);
  };
  const closeEditor = () => {
    const origin = collectionReviewOrigin.current;
    collectionReviewOrigin.current = undefined;
    const collection = state?.collections.find(
      (item) => item.id === origin?.collectionId,
    );
    if (!origin || !collection) {
      setEditorOpen(false);
      finishEditorClose();
      const libraryOrigin = libraryReviewOrigin.current;
      libraryReviewOrigin.current = undefined;
      if (libraryOrigin)
        requestAnimationFrame(() => {
          const list = document.querySelector<HTMLElement>(
            ".library-list > .cards",
          );
          if (!list) return;
          list.scrollTop = libraryOrigin.scrollTop;
          list.scrollLeft = libraryOrigin.scrollLeft;
          Array.from(list.querySelectorAll<HTMLElement>(".question-card"))
            .find(
              (card) => card.dataset.questionId === libraryOrigin.questionId,
            )
            ?.querySelector<HTMLButtonElement>(".card-review")
            ?.focus({ preventScroll: true });
        });
      return;
    }
    // Keep the editor covering the library until the collection is committed.
    flushSync(() => {
      finishEditorClose();
      setCollectionId(collection.id);
      setPaper(collection);
      visitSection("collections");
      setEditorOpen(false);
    });
    requestAnimationFrame(() => {
      const list = document.querySelector<HTMLElement>(
        ".collection-question-list",
      );
      if (!list) return;
      list.scrollTop = origin.scrollTop;
      Array.from(list.querySelectorAll<HTMLElement>(".question-card"))
        .find((card) => card.dataset.questionId === origin.questionId)
        ?.querySelector<HTMLButtonElement>(".card-review")
        ?.focus({ preventScroll: true });
    });
  };
  const confirmReview = async () => {
    if (!draftRef.current || !editorOpen) return;
    const wasManual = manualDraftId.current === draftRef.current.id;
    const before = state?.questions.find((q) => q.id === draftRef.current?.id);
    await saveDraft(true);
    const after = draftRef.current;
    if (!after) return;
    const changed =
      after &&
      (
        [
          "title",
          "body",
          "latex",
          "grade",
          "kind",
          "difficulty",
          "knowledge",
          "figures",
          "figureWidths",
          "figurePlacements",
          "reviewed",
          "favorite",
          "autoSolve",
        ] as const
      ).some(
        (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after[key]),
      );
    setNotice(wasManual ? "题目已保存" : "题目已确认校对");
    setUndoReview(
      !wasManual && after && (changed || undoReview?.id === after.id)
        ? after
        : undefined,
    );
    closeEditor();
  };
  const selectQuestion = async (q: Question, toggleCurrent = false) => {
    const request = ++selectionRequest.current;
    const closeCurrent =
      toggleCurrent && editorOpen && draftRef.current?.id === q.id;
    await saveDraft();
    if (request !== selectionRequest.current) return;
    if (closeCurrent) {
      closeEditor();
      return;
    }
    setResumeEditor(false);
    setActive(q.id);
    setDraft(q);
    setEditorOpen(true);
    setDirty(false);
  };
  const addQuestion = async () => {
    await saveDraft();
    collectionReviewOrigin.current = undefined;
    const q = newQuestion(crypto.randomUUID());
    manualDraftId.current = q.id;
    visitSection("library");
    setResumeEditor(false);
    setActive(q.id);
    setDraft(q);
    setEditorOpen(true);
    setDirty(false);
  };
  useEffect(() => {
    if (searchOpen && section === "library") searchRef.current?.focus();
  }, [searchOpen, section]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (
        manualSavePrompt ||
        pendingKnowledge !== undefined ||
        joinQuestionId ||
        documentPreview
      )
        return;
      if (collectionPickerOpen) {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          closeCollectionPicker();
        }
        return;
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setFabOpen(false);
      }
      if (e.ctrlKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        visitSection("library");
        setSearchOpen(true);
      }
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void run(() => saveRef.current());
      }
      if (e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void run(addQuestion);
      }
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        void run(confirmReview);
      }
      if (
        e.ctrlKey &&
        e.key.toLowerCase() === "v" &&
        !(
          e.target instanceof HTMLElement &&
          e.target.closest("input,textarea,[contenteditable]")
        )
      ) {
        e.preventDefault();
        void run(() => api.pasteImage());
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  });
  const update = (patch: Partial<Question>) => {
    setDraft((q) => (q ? { ...q, ...patch } : q));
    setDirty(true);
  };
  const nav = async (s: string) => {
    await saveDraft();
    visitSection(s);
    window.clearTimeout(knowledgeHoverTimer.current);
    setKnowledgeHover(false);
    setKnowledgeOpen(false);
  };
  const traverseNavigation = async (direction: -1 | 1) => {
    const index = navigation.index + direction;
    if (index < 0 || index >= navigation.entries.length) return;
    await saveDraft();
    const target = navigation.entries[index];
    setNavigation((current) => ({ ...current, index }));
    if (target === "library" && section !== "library" && editorOpen)
      setResumeEditor(true);
    setSection(target);
    setKnowledgeOpen(false);
    setKnowledgeHover(false);
    setSearchOpen(false);
    setFabOpen(false);
  };
  const setF = (patch: Partial<Filter>) => {
    clearTimeout(filterHistoryTimer.current);
    const labels: Record<string, string> = {
      keyword: "搜索",
      grade: "年级",
      kind: "题型",
      difficulty: "难度",
      knowledge: "知识点",
      reviewed: "校对状态",
      favorite: "仅收藏",
    };
    const detail = Object.entries(patch)
      .map(
        ([key, value]) =>
          `${labels[key]}：${value === "" ? "全部" : typeof value === "boolean" ? (value ? "开启" : "关闭") : value === "all" ? "全部" : value === "pending" ? "待校对" : value === "reviewed" ? "已校对" : value}`,
      )
      .join("；");
    filterHistoryTimer.current = setTimeout(
      () => recordQuery("筛选题库", detail),
      350,
    );
    setPage(0);
    setFilter((f) => ({ ...f, ...patch }));
  };
  const visible =
    state?.questions.filter((q) =>
      filterQuestion(q, filter, state.customKnowledge),
    ) ?? [];
  const filterActive =
    filter.keyword !== "" ||
    filter.grade !== "" ||
    filter.kind !== "" ||
    filter.difficulty !== "" ||
    filter.knowledge !== "" ||
    filter.reviewed !== "all" ||
    filter.favorite;
  const solutionJob = state?.jobs
    .filter((job) => job.type === "solution" && job.questionId === draft?.id)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0];
  const solutionPending =
    solutionJob?.status === "processing" || solutionJob?.status === "queued";
  const currentCollection = state?.collections.find(
    (c) => c.id === collectionId,
  );
  const collectionQuestions =
    state?.items
      .filter((i) => i.collectionId === collectionId)
      .sort((a, b) => a.position - b.position)
      .map((i) => state.questions.find((q) => q.id === i.questionId)!)
      .filter(Boolean) ?? [];
  const pickerQuestions =
    pickerView === "selected"
      ? collectionQuestions
      : (state?.questions.filter((q) =>
          filterQuestion(q, pickerFilter, state.customKnowledge),
        ) ?? []);
  const setPickerF = (patch: Partial<Filter>) => {
    clearTimeout(pickerHistoryTimer.current);
    pickerHistoryTimer.current = setTimeout(
      () =>
        recordQuery(
          "筛选题集添加面板",
          Object.entries(patch)
            .filter(([key]) => key !== "keyword")
            .map(
              ([key, value]) =>
                `${({ grade: "年级", kind: "题型", difficulty: "难度", knowledge: "知识点", reviewed: "校对状态", favorite: "仅收藏" } as Record<string, string>)[key]}：${value || "全部"}`,
            )
            .join("；") || "更新搜索条件",
        ),
      350,
    );
    setPickerLimit(100);
    setPickerFilter((current) => ({ ...current, ...patch }));
  };
  const changePaper = (patch: Partial<Collection>) => {
    if (!paperRef.current) return;
    const next = { ...paperRef.current, ...patch };
    paperRef.current = next;
    setPaper(next);
    paperDirty.current = true;
  };
  const changeSettings = (patch: Partial<SettingsInput>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    settingsDirty.current = true;
  };
  const openCollection = async (c: Collection) => {
    await saveDraft();
    setCollectionId(c.id);
    setPaper(c);
    paperDirty.current = false;
  };
  const doExport = async (format: "pdf" | "docx") => {
    exportTriggerRef.current = document.activeElement as HTMLElement;
    await saveDraft();
    const id = collectionId!;
    const data = await api.previewCollection(id);
    setDocumentPreview({ data, format, id, title: currentCollection!.title });
  };
  const confirmDocumentExport = async () => {
    if (!documentPreview) return;
    const r = await api.exportCollection(
      documentPreview.id,
      documentPreview.format,
    );
    if (r) {
      closeDocumentPreview();
      setLastExport(r.path);
      setNotice("文档已保存，可点击打开查看。");
    }
  };
  const inspect = async () => {
    const p = await api.inspectBackup();
    if (p) setPreview(p);
  };
  const resize = (event: React.PointerEvent) => {
    setEditorResizing(true);
    const start = event.clientX,
      width = editorWidth;
    const move = (e: PointerEvent) =>
      setEditorWidth(Math.max(360, Math.min(800, width + start - e.clientX)));
    const end = () => {
      setEditorResizing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };
  if (!state)
    return (
      <div className="loading">正在打开本机题库…{error && <p>{error}</p>}</div>
    );
  const moveCollectionQuestion = async (index: number, direction: -1 | 1) => {
    const ids = collectionQuestions.map((q) => q.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    await api.reorder(collectionId!, ids);
  };
  const openCard = async (
    q: Question,
    toggleCurrent = false,
    fromCollection = false,
  ) => {
    const origin =
      fromCollection && collectionId
        ? {
            collectionId,
            questionId: q.id,
            scrollTop:
              document.querySelector<HTMLElement>(".collection-question-list")
                ?.scrollTop ?? 0,
          }
        : undefined;
    if (origin) {
      const request = ++selectionRequest.current;
      await saveDraft();
      if (request !== selectionRequest.current) return;
      collectionReviewOrigin.current = origin;
      window.clearTimeout(knowledgeHoverTimer.current);
      // Mount the destination with its question already visible, in one commit.
      flushSync(() => {
        visitSection("library");
        setActive(q.id);
        setDraft(q);
        setDirty(false);
        setResumeEditor(true);
        setEditorOpen(true);
        setKnowledgeHover(false);
        setKnowledgeOpen(false);
      });
      return;
    }
    if (section === "library" && !editorOpen) {
      const list = document.querySelector<HTMLElement>(
        ".library-list > .cards",
      );
      libraryReviewOrigin.current = list
        ? {
            questionId: q.id,
            scrollTop: list.scrollTop,
            scrollLeft: list.scrollLeft,
          }
        : undefined;
    }
    if (section !== "library") await nav("library");
    collectionReviewOrigin.current = origin;
    await selectQuestion(q, toggleCurrent);
  };
  const filterCard = (patch: Partial<Filter>) => {
    setF(patch);
    if (section !== "library") void run(() => nav("library"));
  };
  const renderCard = (
    q: Question,
    number: number,
    inCollection = false,
    inPicker = false,
  ) => {
    const renderTag = (
      value: string,
      className: string,
      label: string,
      pressed: boolean,
      patch: Partial<Filter>,
    ) =>
      inCollection ? (
        <span key={label} className={className}>
          {value}
        </span>
      ) : (
        <button
          key={label}
          type="button"
          className={className}
          aria-label={label}
          aria-pressed={pressed}
          onClick={(event) => {
            event.stopPropagation();
            applyFilter(patch);
          }}
        >
          {value}
        </button>
      );
    const alreadyAdded = collectionQuestions.some((item) => item.id === q.id);
    const cardFilter = inPicker ? pickerFilter : filter;
    const cardActive = inPicker
      ? alreadyAdded
      : inCollection
        ? collectionActive?.collectionId === collectionId &&
          collectionActive?.questionId === q.id
        : active === q.id;
    const highlightCollectionCard = () => {
      if (inCollection && !inPicker && collectionId) {
        setCollectionActive({ collectionId, questionId: q.id });
      }
    };
    const reviewLabel = q.reviewed ? "修改" : "校对";
    const applyFilter = inPicker ? setPickerF : filterCard;
    const activate = () =>
      inCollection
        ? highlightCollectionCard()
        : inPicker
          ? !alreadyAdded &&
            !busy &&
            void run(() => addToCollection(collectionId!, [q.id]))
          : void run(() => openCard(q, true));
    return (
      <div
        className={
          "question-card " +
          (inCollection ? "collection-question-card " : "") +
          (cardActive ? "active" : "")
        }
        key={q.id}
        data-question-id={q.id}
        tabIndex={0}
        aria-label={`${inCollection ? "题目" : inPicker ? (alreadyAdded ? "已加入" : "添加") : "校对"} ${q.title}`}
        aria-current={!inPicker && cardActive ? "true" : undefined}
        onClickCapture={(event) => {
          if (!(
            event.target instanceof HTMLElement &&
            event.target.closest(".question-layout-controls")
          ))
            highlightCollectionCard();
        }}
        onClick={inCollection ? undefined : activate}
        onKeyDown={(event) => {
          if (
            event.target === event.currentTarget &&
            (event.key === "Enter" || event.key === " ")
          ) {
            event.preventDefault();
            activate();
          }
        }}
      >
        <div className="card-top">
          <div className="tags">
            {q.grade &&
              renderTag(
                q.grade,
                "tag blue",
                `按年级筛选：${q.grade}`,
                cardFilter.grade === q.grade,
                { grade: q.grade },
              )}
            {renderTag(
              q.difficulty,
              "tag " +
                (
                  { 基础: "green", 进阶: "orange", 挑战: "red" } as Record<
                    string,
                    string
                  >
                )[q.difficulty],
              `按难度筛选：${q.difficulty}`,
              cardFilter.difficulty === q.difficulty,
              { difficulty: q.difficulty },
            )}
            {decodeKnowledge(q.knowledge, state.customKnowledge).map((point) =>
              renderTag(
                point,
                "tag purple",
                `按知识点筛选：${point}`,
                cardFilter.knowledge === point,
                { knowledge: point },
              ),
            )}
          </div>
          <span className="card-kind">{q.kind}</span>
        </div>
        <div className="card-preview">
          <span className="question-number" aria-hidden="true">
            {number}.
          </span>
          <QuestionVisual question={q} lazy />
        </div>
        {inCollection && paper && (
          <div className="question-layout-controls">
            <label>
              <span>解答空间</span>
              <input
                aria-label={`第 ${number} 题解答空间`}
                type="number"
                min={0}
                max={160}
                step={1}
                placeholder="自动"
                value={paper.questionLayout?.[q.id]?.answerSpaceMm ?? ""}
                onChange={(event) =>
                  changePaper({
                    questionLayout: {
                      ...paper.questionLayout,
                      [q.id]: {
                        ...paper.questionLayout?.[q.id],
                        answerSpaceMm:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      },
                    },
                  })
                }
                onBlur={() => void run(() => saveDraft())}
              />
              <span>mm</span>
            </label>
            <span className="layout-auto-hint">自动 {answerSpaceMm(q)}mm</span>
            <label className="layout-page-break">
              <input
                type="checkbox"
                checked={paper.questionLayout?.[q.id]?.pageBreakBefore ?? false}
                onChange={(event) =>
                  changePaper({
                    questionLayout: {
                      ...paper.questionLayout,
                      [q.id]: {
                        ...paper.questionLayout?.[q.id],
                        pageBreakBefore: event.target.checked,
                      },
                    },
                  })
                }
              />
              <span>另起一页</span>
            </label>
          </div>
        )}
        <div className="card-footer">
          <div className="card-meta">
            <span className={q.reviewed ? "" : "pending"}>
              {q.reviewed ? "已校对" : "待校对"}
            </span>
            {q.favorite && <span>★ 收藏</span>}
            {q.example && <span>示例</span>}
          </div>
          <div className="card-actions">
            {inCollection && (
              <>
                <button
                  className="order-icon-button"
                  aria-label="上移"
                  title="上移"
                  disabled={busy || number === 1}
                  onClick={(event) => {
                    event.stopPropagation();
                    void run(() => moveCollectionQuestion(number - 1, -1));
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 19V5m-6 6 6-6 6 6" />
                  </svg>
                </button>
                <button
                  className="order-icon-button"
                  aria-label="下移"
                  title="下移"
                  disabled={busy || number === collectionQuestions.length}
                  onClick={(event) => {
                    event.stopPropagation();
                    void run(() => moveCollectionQuestion(number - 1, 1));
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 5v14m-6-6 6 6 6-6" />
                  </svg>
                </button>
              </>
            )}
            {!inCollection && !inPicker && (
              <HoldButton
                label="长按删除"
                ariaLabel="从题库中长按删除"
                className="library-remove"
                disabled={busy}
                onComplete={() =>
                  void run(async () => {
                    const token = await api.deleteQuestion(q.id);
                    if (active === q.id) setActive(undefined);
                    deletedNotice("题目已从题库删除", token);
                  })
                }
              />
            )}
            {inCollection || (inPicker && alreadyAdded) ? (
              <HoldButton
                label="长按删去"
                ariaLabel="从题集中删去"
                className="collection-remove"
                disabled={busy}
                onComplete={() =>
                  void run(async () => {
                    const token = await api.removeQuestion(collectionId!, q.id);
                    deletedNotice(
                      "题目已从题集中删去，题库中的原题仍保留",
                      token,
                    );
                  })
                }
              />
            ) : (
              <button
                className={
                  inPicker
                    ? "primary card-add-collection"
                    : "card-add-collection"
                }
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  if (inPicker)
                    void run(() => addToCollection(collectionId!, [q.id]));
                  else {
                    setJoinTitle("");
                    setJoinQuestionId(q.id);
                  }
                }}
              >
                加入题集
              </button>
            )}
            {!inPicker && (
              <button
                className="primary card-review"
                aria-label={reviewLabel + "题目 " + q.title}
                onClick={(event) => {
                  event.stopPropagation();
                  void run(() => openCard(q, false, inCollection));
                }}
              >
                {reviewLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div className="app">
      {mobileOpen && (
        <MobileImportDialog
          exportPath={lastExport || undefined}
          onClose={() => setMobileOpen(false)}
          onTasks={() => {
            setMobileOpen(false);
            void run(() => nav("tasks"));
          }}
        />
      )}
      <ImportDropZone
        busy={
          busy ||
          guideOpen ||
          !!preview ||
          !!documentPreview ||
          !!joinQuestionId ||
          pendingKnowledge !== undefined ||
          collectionDialog
        }
        onBlocked={() => setNotice("请先完成或关闭当前操作，再拖入文件")}
        onImport={(files) =>
          void run(async () => {
            await saveDraft();
            const result = await api.importDropped(files);
            setFabOpen(false);
            if (result) setPreview(result);
            else {
              visitSection("tasks");
              setNotice(`已导入 ${files.length} 个文件，正在识别题目`);
            }
          })
        }
      />
      <header
        className="window-titlebar"
        aria-label="窗口标题栏"
        inert={
          pendingKnowledge !== undefined ||
          !!joinQuestionId ||
          !!documentPreview
        }
      >
        <div className="titlebar-navigation" role="group" aria-label="页面导航">
          {([-1, 1] as const).map((direction) => (
            <button
              key={direction}
              className="titlebar-history-button"
              aria-label={direction === -1 ? "后退" : "前进"}
              title={direction === -1 ? "后退" : "前进"}
              disabled={
                busy ||
                (direction === -1
                  ? navigation.index === 0
                  : navigation.index === navigation.entries.length - 1)
              }
              onClick={() => void run(() => traverseNavigation(direction))}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path
                  d={
                    direction === -1
                      ? "M19 12H5m7-7-7 7 7 7"
                      : "M5 12h14m-7-7 7 7-7 7"
                  }
                />
              </svg>
            </button>
          ))}
          {section === "library" && (
            <button
              className="library-sidebar-toggle"
              aria-label={knowledgeOpen ? "隐藏侧边栏" : "显示侧边栏"}
              title={knowledgeOpen ? "隐藏侧边栏" : "显示侧边栏"}
              aria-expanded={knowledgeOpen}
              aria-controls="library-knowledge-navigation"
              onClick={() => {
                setKnowledgeHover(false);
                setKnowledgeMode("docked");
                setKnowledgeOpen((open) => !open);
              }}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="16" rx="3" />
                <path d="M9 4v16" />
                <path d={knowledgeOpen ? "m15 9-3 3 3 3" : "m13 9 3 3-3 3"} />
              </svg>
            </button>
          )}
          <RecentHistory onViewAll={() => void run(() => nav("history"))} />
        </div>
        <div className="workbench-wordmark">Matheca</div>
      </header>
      <aside
        className="sidebar icon-rail"
        inert={
          pendingKnowledge !== undefined ||
          !!joinQuestionId ||
          !!documentPreview
        }
      >
        <nav id="main-navigation" aria-label="主菜单">
          {[
            ["library", "database", "题库"],
            ["collections", "folder-open", "题集"],
            ["knowledge", "bulb", "知识点"],
            ["tasks", "file-done", "任务"],
            ["history", "history", "历史记录"],
          ].map(([key, icon, label]) => (
            <button
              className={section === key ? "nav-active" : ""}
              key={key}
              aria-label={label}
              title={label}
              aria-current={section === key ? "page" : undefined}
              aria-expanded={key === "library" ? knowledgeOpen : undefined}
              aria-controls={
                key === "library" ? "library-knowledge-navigation" : undefined
              }
              onClick={() => void run(() => nav(key))}
            >
              <span aria-hidden="true">
                <NavIcon
                  name={icon as NavIconName}
                  selected={section === key}
                />
              </span>
              {key === "tasks" &&
                state.jobs.some((j) => j.status === "processing") && (
                  <b className="dot" />
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={
              "nav-settings " + (section === "settings" ? "nav-active" : "")
            }
            aria-label="设置与备份"
            title="设置与备份"
            aria-current={section === "settings" ? "page" : undefined}
            onClick={() => void run(() => nav("settings"))}
          >
            <span aria-hidden="true">
              <NavIcon name="setting" selected={section === "settings"} />
            </span>
          </button>
        </div>
      </aside>
      <div
        className="content-shell"
        inert={
          pendingKnowledge !== undefined ||
          !!joinQuestionId ||
          !!documentPreview
        }
      >
        <div
          className={
            "knowledge-slot" +
            (knowledgeOpen && section === "library" ? " open" : "")
          }
          aria-hidden="true"
        />
        <div
          ref={knowledgePanelRef}
          id="library-knowledge-navigation"
          className={
            "knowledge-reveal" +
            (knowledgeOpen && section === "library" ? " open" : "") +
            (knowledgeMode === "floating" ? " floating" : " docked") +
            (!(knowledgeOpen && section === "library") && knowledgeHover
              ? " hover-preview"
              : "")
          }
          inert={!(knowledgeOpen && section === "library") && !knowledgeHover}
          aria-hidden={
            !(knowledgeOpen && section === "library") && !knowledgeHover
          }
        >
          <KnowledgeTree
            custom={state.customKnowledge}
            selected={filter.knowledge}
            onSelect={(knowledge) => {
              if (draftRef.current && editorOpen) {
                window.clearTimeout(knowledgeHoverTimer.current);
                setKnowledgeHover(false);
                setKnowledgeOpen(false);
                visitSection("library");
                setPendingKnowledge(knowledge);
                return;
              }
              if (section !== "library") {
                void run(async () => {
                  await saveDraft();
                  visitSection("library");
                });
              }
              setF({ knowledge });
              if (window.matchMedia("(max-width: 900px)").matches)
                setKnowledgeOpen(false);
            }}
            onClose={() => {
              setKnowledgeHover(false);
              window.clearTimeout(knowledgeHoverTimer.current);
              setKnowledgeOpen(false);
              document
                .querySelector<HTMLButtonElement>(
                  '.library-sidebar-toggle, #main-navigation button[aria-label="题库"]',
                )
                ?.focus();
            }}
          />
        </div>
        <main className="workspace" ref={workspaceRef}>
          <header className="topbar">
            <div>
              <div className="title-line">
                <h1>
                  {
                    {
                      library: "题库",
                      collections: "题集",
                      knowledge: "知识点",
                      tasks: "任务",
                      settings: "设置与备份",
                      history: "历史记录",
                    }[section]
                  }
                </h1>
                {section === "library" && (
                  <div className="title-search">
                    <button
                      className={"icon-button " + (searchOpen ? "on" : "")}
                      aria-label="搜索题目"
                      aria-expanded={searchOpen}
                      aria-controls="question-search"
                      onClick={() => {
                        setSearchOpen((open) => !open);
                      }}
                    >
                      <svg
                        width="17"
                        height="17"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.6-3.6" />
                      </svg>
                    </button>
                    <div
                      id="question-search"
                      className={"search-reveal" + (searchOpen ? " open" : "")}
                      inert={!searchOpen}
                      aria-hidden={!searchOpen}
                    >
                      <input
                        ref={searchRef}
                        className="search inline-search"
                        aria-label="搜索题干、公式或知识点"
                        placeholder="搜索题干、公式或知识点…"
                        value={filter.keyword}
                        onChange={(e) => setF({ keyword: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="top-actions">
              {section === "library" && (
                <>
                  <button onClick={() => void run(inspect)}>导入题库</button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        const r = await api.exportBackup();
                        if (r)
                          setNotice(
                            `题库已保存${r.missingImages ? `，${r.missingImages} 张原图已缺失` : ""}`,
                          );
                      })
                    }
                  >
                    备份题库
                  </button>
                </>
              )}
            </div>
            {notice && (
              <SwipeToast
                key={toastId}
                message={notice}
                duration={undoReview || undoDelete || undoAdd ? 8000 : 6000}
                onDismiss={() => setNotice("")}
                busy={busy}
                actionLabel={
                  undoReview || undoDelete || undoAdd
                    ? "撤销"
                    : lastExport && notice === "文档已保存，可点击打开查看。"
                      ? "打开文档"
                      : undefined
                }
                onAction={
                  undoAdd
                    ? () =>
                        void run(async () => {
                          await api.undoAddition(undoAdd);
                          setNotice("已撤销加入题集，题库中的原题仍保留");
                        })
                    : undoDelete
                      ? () =>
                          void run(async () => {
                            const restored = await api.undoDeletion(undoDelete);
                            if (
                              restored.collection &&
                              section === "collections" &&
                              !collectionId
                            ) {
                              setCollectionId(restored.collection.id);
                              setPaper(restored.collection);
                              paperDirty.current = false;
                            }
                            setNotice("已撤销删除，内容已恢复");
                          })
                      : undoReview
                        ? () =>
                            void run(async () => {
                              if (
                                draftRef.current?.id === undoReview.id &&
                                (
                                  [
                                    "title",
                                    "body",
                                    "latex",
                                    "grade",
                                    "kind",
                                    "difficulty",
                                    "knowledge",
                                    "figures",
                                    "figureWidths",
                                    "figurePlacements",
                                    "reviewed",
                                    "favorite",
                                    "autoSolve",
                                  ] as const
                                ).some(
                                  (key) =>
                                    JSON.stringify(draftRef.current?.[key]) !==
                                    JSON.stringify(undoReview[key]),
                                )
                              )
                                throw Error(
                                  "题目又有新的编辑，请先确认新修改，再撤销对应的一步",
                                );
                              const q = await api.undoReview(undoReview);
                              if (draftRef.current?.id === q.id) {
                                draftRef.current = q;
                                dirtyRef.current = false;
                                setDraft(q);
                                setDirty(false);
                              }
                              setNotice("已撤销本次题目修改");
                            })
                        : lastExport
                          ? () => void run(() => api.openExport(lastExport))
                          : undefined
                }
              />
            )}
          </header>
          {lastExport && (
            <div className="mobile-export-action">
              <button onClick={() => setMobileOpen(true)}>发送到手机</button>
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {section === "library" && (
            <>
              <div className="stats">
                <div className="stat-counts">
                  <span>
                    <b>{state.questions.length}</b> 道题目
                  </span>
                  <span>
                    <b>{state.questions.filter((q) => !q.reviewed).length}</b>{" "}
                    待校对
                  </span>
                  <span>
                    <b>{state.collections.length}</b> 个题集
                  </span>
                </div>
                <div className="library-filters" aria-label="题库筛选条件">
                  <GlideSelect
                    label="年级"
                    value={filter.grade}
                    onChange={(grade) => setF({ grade })}
                    options={[
                      { value: "", label: "全部年级" },
                      ...grades.map((value) => ({ value, label: value })),
                    ]}
                  />
                  <GlideSelect
                    label="难度"
                    value={filter.difficulty}
                    onChange={(difficulty) => setF({ difficulty })}
                    options={[
                      { value: "", label: "全部难度" },
                      ...difficulties.map((value) => ({ value, label: value })),
                    ]}
                  />
                  <GlideSelect
                    label="题型"
                    value={filter.kind}
                    onChange={(kind) => setF({ kind })}
                    options={[
                      { value: "", label: "全部题型" },
                      ...kinds.map((value) => ({ value, label: value })),
                    ]}
                  />
                  <GlideSelect
                    label="知识点"
                    value={filter.knowledge}
                    onChange={(knowledge) => setF({ knowledge })}
                    options={knowledgeOptions(state.customKnowledge)}
                  />
                  <GlideSelect
                    label="校对状态"
                    value={filter.reviewed}
                    onChange={(reviewed) =>
                      setF({ reviewed: reviewed as Filter["reviewed"] })
                    }
                    options={[
                      { value: "all", label: "全部状态" },
                      { value: "pending", label: "待校对" },
                      { value: "reviewed", label: "已校对" },
                    ]}
                  />
                </div>
                <label className="check favorite-filter">
                  <input
                    type="checkbox"
                    checked={filter.favorite}
                    onChange={(e) => setF({ favorite: e.target.checked })}
                  />
                  仅收藏
                </label>
              </div>
              <div
                className={
                  "library-grid" +
                  (draft && editorOpen ? " expanded-layout" : "") +
                  (editorResizing ? " resizing" : "")
                }
                style={
                  {
                    "--editor-width": draft
                      ? `${sourceZoom && draft.sourcePath ? Math.max(860, editorWidth) : editorWidth}px`
                      : "0px",
                    "--minimum-list-width": "280px",
                  } as React.CSSProperties
                }
              >
                <section className="library-list" inert={!!draft && editorOpen}>
                  <div className="list-heading">
                    <span>
                      {filterActive
                        ? `${visible.length} 道筛选结果`
                        : `共 ${visible.length} 道题目`}
                    </span>
                    {filterActive && (
                      <button
                        onClick={() => {
                          setPage(0);
                          setFilter(emptyFilter);
                        }}
                      >
                        清除筛选
                      </button>
                    )}
                  </div>
                  <div className="cards">
                    <MasonryCards
                      animate={!editorResizing}
                      focusId={active}
                      settleKey={knowledgeOpen && section === "library"}
                    >
                      {visible
                        .slice(page * 100, (page + 1) * 100)
                        .map((q, index) =>
                          renderCard(q, page * 100 + index + 1),
                        )}
                    </MasonryCards>
                    {visible.length > 100 && (
                      <div className="pagination">
                        <button
                          disabled={!page}
                          onClick={() => setPage((p) => p - 1)}
                        >
                          上一页
                        </button>
                        <span>
                          第 {page + 1} / {Math.ceil(visible.length / 100)} 页
                        </span>
                        <button
                          disabled={(page + 1) * 100 >= visible.length}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          下一页
                        </button>
                      </div>
                    )}
                    {!visible.length && (
                      <div className="empty">
                        <div>∑</div>
                        <h2>
                          {state.questions.length
                            ? "没有匹配的题目"
                            : "从第一道题开始"}
                        </h2>
                        <p>
                          导入图片或 PDF，也可以手动录入。
                          <br />
                          识别结果会先保存为待校对题目。
                        </p>
                        {!state.questions.length && (
                          <button
                            onClick={() => void run(() => api.examples())}
                          >
                            先用 3 道示例题体验
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>
                {draft && (
                  <div
                    className={
                      "editor-reveal" +
                      (editorOpen &&
                      (pendingKnowledge !== undefined || resumeEditor)
                        ? " resume"
                        : "") +
                      (editorOpen ? " open" : "") +
                      (editorResizing ? " resizing" : "")
                    }
                    inert={!editorOpen}
                    aria-hidden={!editorOpen}
                  >
                    <div className="resize" onPointerDown={resize} />
                    <section className="editor" aria-label="题目校对">
                      <div className="editor-heading">
                        <div className="editor-top-tags tags">
                          {draft.grade && (
                            <span className="tag blue">{draft.grade}</span>
                          )}
                          <span
                            className={
                              "tag " +
                              (
                                {
                                  基础: "green",
                                  进阶: "orange",
                                  挑战: "red",
                                } as Record<string, string>
                              )[draft.difficulty]
                            }
                          >
                            {draft.difficulty}
                          </span>
                          {decodeKnowledge(
                            draft.knowledge,
                            state.customKnowledge,
                          ).map((point) => (
                            <span className="tag purple" key={point}>
                              {point}
                            </span>
                          ))}
                          <small className="editor-status">
                            {dirty
                              ? "未保存"
                              : draft.reviewed
                                ? "已校对"
                                : "待校对"}
                          </small>
                        </div>
                        <button
                          aria-label="关闭题目校对"
                          onClick={() =>
                            void run(async () => {
                              const request = ++selectionRequest.current;
                              await saveDraft();
                              if (request === selectionRequest.current)
                                closeEditor();
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                      <div className={"editor-body" + " expanded-content"}>
                        <div className="editor-scroll">
                          <div
                            className="preview"
                            title="再次点击题干预览可收起校对"
                            onClick={() => {
                              if (!getSelection()?.toString())
                                void run(() => selectQuestion(draft, true));
                            }}
                          >
                            <span className="eyebrow">公式与题干预览</span>
                            <QuestionVisual question={draft} />
                          </div>

                          <OptionFigureSizeControl
                            question={draft}
                            onChange={(figureWidths) =>
                              update({ figureWidths })
                            }
                          />
                          {!!draft.figures?.length && (
                            <div className="question-figures">
                              {draft.kind === "选择题" && (
                                <p className="hint choice-image-hint">
                                  图形可放入题干或
                                  A／B／C／D。图片选项导出为两列，过宽图片会等比缩小。
                                </p>
                              )}
                              {draft.figures.map((figure, index) => (
                                <figure key={index}>
                                  <FigureImage
                                    src={figure}
                                    index={index}
                                    width={draft.figureWidths?.[index]}
                                  />
                                  {draft.kind === "选择题" && (
                                    <GlideSelect
                                      label={`图形 ${index + 1} 位置`}
                                      value={
                                        draft.figurePlacements?.[index] ??
                                        "stem"
                                      }
                                      options={figurePlacementOptions}
                                      onChange={(value) =>
                                        update({
                                          figurePlacements: draft.figures!.map(
                                            (_, i) =>
                                              i === index
                                                ? (value as FigurePlacement)
                                                : (draft.figurePlacements?.[
                                                    i
                                                  ] ?? "stem"),
                                          ),
                                        })
                                      }
                                    />
                                  )}
                                  <FigureSizeControl
                                    index={index}
                                    width={draft.figureWidths?.[index] ?? 0}
                                    onChange={(width) =>
                                      update({
                                        figureWidths: draft.figures!.map(
                                          (_, i) =>
                                            i === index
                                              ? width
                                              : (draft.figureWidths?.[i] ?? 0),
                                        ),
                                      })
                                    }
                                  />
                                  <button
                                    onClick={() =>
                                      update({
                                        figureWidths:
                                          draft.figureWidths?.filter(
                                            (_, i) => i !== index,
                                          ),
                                        figurePlacements:
                                          draft.figurePlacements?.filter(
                                            (_, i) => i !== index,
                                          ),
                                        figures: draft.figures?.filter(
                                          (_, i) => i !== index,
                                        ),
                                      })
                                    }
                                  >
                                    移除图形 {index + 1}
                                  </button>
                                </figure>
                              ))}
                            </div>
                          )}
                          <label className="field">
                            <span>题干与小题</span>
                            <textarea
                              aria-label="题干与小题"
                              rows={9}
                              value={draft.body}
                              onChange={(e) => update({ body: e.target.value })}
                              placeholder={
                                "在对应文字位置写入公式，例如 \\(x^2+1\\)。"
                              }
                            />
                          </label>
                          <div className="filter-row">
                            <Select
                              label="题目年级"
                              value={draft.grade}
                              onChange={(grade) => update({ grade })}
                              options={grades}
                            />
                            <Select
                              label="题目题型"
                              value={draft.kind}
                              onChange={(kind) => update({ kind })}
                              options={kinds}
                            />
                            <Select
                              label="题目难度"
                              value={draft.difficulty}
                              onChange={(difficulty) => update({ difficulty })}
                              options={["待评估", ...difficulties]}
                            />
                          </div>
                          <div className="field knowledge-field">
                            <span>知识点（多选）</span>
                            <GlideSelect
                              label="添加知识点"
                              value=""
                              options={[
                                { value: "", label: "添加知识点" },
                                ...knowledgeOptions(
                                  state.customKnowledge,
                                ).filter((option) => option.value),
                              ]}
                              onChange={(value) => {
                                if (!value) return;
                                const values = decodeKnowledge(
                                  draft.knowledge,
                                  state.customKnowledge,
                                );
                                if (!values.includes(value))
                                  update({
                                    knowledge: [...values, value].join("、"),
                                  });
                              }}
                            />
                          </div>
                          <div className="tags">
                            {decodeKnowledge(
                              draft.knowledge,
                              state.customKnowledge,
                            ).map((p) => (
                              <button
                                className="tag purple"
                                key={p}
                                onClick={() =>
                                  update({
                                    knowledge: decodeKnowledge(
                                      draft.knowledge,
                                      state.customKnowledge,
                                    )
                                      .filter((x) => x !== p)
                                      .join("、"),
                                  })
                                }
                              >
                                {p} ×
                              </button>
                            ))}
                          </div>
                          <div className="checks">
                            <label>
                              <input
                                type="checkbox"
                                checked={draft.favorite}
                                onChange={(e) =>
                                  update({ favorite: e.target.checked })
                                }
                              />
                              收藏题目
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={draft.autoSolve}
                                onChange={(e) =>
                                  update({ autoSolve: e.target.checked })
                                }
                              />
                              此题自动解题
                            </label>
                          </div>
                          <section className="solution">
                            <div className="list-heading">
                              <b>AI 解答 · 待核对</b>
                              <button
                                className="generation-button"
                                disabled={busy || solutionPending}
                                onClick={() =>
                                  void run(async () => {
                                    await saveDraft();
                                    if (draftRef.current)
                                      await api.solveQuestion(
                                        draftRef.current.id,
                                      );
                                  })
                                }
                              >
                                生成 / 重试
                              </button>
                            </div>
                            {solutionJob && (
                              <div
                                className="solution-task-progress"
                                aria-label="此题解题进度"
                              >
                                <LatticeLoader
                                  status={
                                    solutionJob.status === "processing"
                                      ? "working"
                                      : solutionJob.status === "complete"
                                        ? "done"
                                        : solutionJob.status === "failed"
                                          ? "error"
                                          : "idle"
                                  }
                                  label={
                                    solutionJob.status === "queued"
                                      ? "排队中"
                                      : solutionJob.status === "processing"
                                        ? "正在解题"
                                        : "等待继续"
                                  }
                                  doneLabel="解题完成 · 待核对"
                                  errorLabel="解题失败"
                                  color="var(--blue)"
                                  doneColor="#16845b"
                                  errorColor="#c53750"
                                  fontSize={12}
                                  showTimer={false}
                                />
                                <span className="hint">
                                  {solutionJob.message}
                                </span>
                              </div>
                            )}
                            {state.questions.find((q) => q.id === draft.id)
                              ?.solution || draft.solution ? (
                              <MathView
                                text={readableSolution(
                                  state.questions.find((q) => q.id === draft.id)
                                    ?.solution || draft.solution,
                                )}
                              />
                            ) : (
                              <p className="hint">
                                可生成分步解答；AI 解答需要人工核对。
                              </p>
                            )}
                            {state.questions.find((q) => q.id === draft.id)
                              ?.solutionError && (
                              <p className="formula-error">
                                {
                                  state.questions.find((q) => q.id === draft.id)
                                    ?.solutionError
                                }
                              </p>
                            )}
                          </section>
                        </div>
                        {draft.sourcePath ? (
                          <SourceViewer
                            key={draft.id}
                            src={draft.sourcePath}
                            label={draft.sourceLabel}
                            expanded={true}
                            persistent={true}
                            choice={draft.kind === "选择题"}
                            onExtract={async (rect, placement) => {
                              if ((draftRef.current?.figures?.length ?? 0) >= 6)
                                throw Error("每题最多提取 6 张图形");
                              const figure = await api.cropFigure(
                                draft.id,
                                rect,
                              );
                              update({
                                figureWidths: draftRef.current?.figureWidths
                                  ? [...draftRef.current.figureWidths, 0]
                                  : undefined,
                                figurePlacements: [
                                  ...(draftRef.current?.figures ?? []).map(
                                    (_, i) =>
                                      draftRef.current?.figurePlacements?.[i] ??
                                      "stem",
                                  ),
                                  placement,
                                ],
                                figures: [
                                  ...(draftRef.current?.figures ?? []),
                                  figure,
                                ],
                              });
                            }}
                            onToggle={() => {}}
                          />
                        ) : (
                          <aside
                            className="source-pane expanded source-empty"
                            aria-label="来源原图"
                          >
                            <b>来源原图</b>
                            <p className="hint">此题暂无来源原图</p>
                          </aside>
                        )}
                      </div>
                      <footer className="editor-footer">
                        <HoldButton
                          key={draft.id}
                          label="长按删除此题"
                          className="editor-delete"
                          disabled={busy}
                          onComplete={() =>
                            void run(async () => {
                              if (manualDraftId.current === draft.id) {
                                manualDraftId.current = undefined;
                                draftRef.current = undefined;
                                dirtyRef.current = false;
                                closeEditor();
                                setDirty(false);
                                setNotice("已放弃这次录入");
                                return;
                              }
                              await saveDraft();
                              const token = await api.deleteQuestion(draft.id);
                              closeEditor();
                              setDraft(undefined);
                              setActive(undefined);
                              setDirty(false);
                              deletedNotice("题目已从题库删除", token);
                            })
                          }
                        />
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await confirmReview();
                            })
                          }
                        >
                          {manualDraftId.current === draft.id
                            ? "保存题目"
                            : "确认已校对"}
                        </button>
                      </footer>
                    </section>
                  </div>
                )}
              </div>
            </>
          )}
          {section === "history" && <HistoryPage />}
          {section === "collections" && (
            <div
              className={
                "collections-layout" +
                (!state.collections.length ? " is-empty" : "")
              }
            >
              <div className="collection-list">
                <div className="collection-list-heading">
                  <h3 className="collection-column-title">题集</h3>
                  <span>{state.collections.length}</span>
                </div>
                <div className="collection-list-items">
                  {state.collections.map((c) => (
                    <button
                      className={
                        "collection-card " +
                        (collectionId === c.id ? "active" : "")
                      }
                      key={c.id}
                      aria-current={collectionId === c.id ? "true" : undefined}
                      title={c.title}
                      onClick={() => void run(() => openCollection(c))}
                    >
                      <span className="collection-icon" aria-hidden="true">
                        <NavIcon name="folder-open" />
                      </span>
                      <span className="collection-row-copy">
                        <span className="collection-row-title">{c.title}</span>
                        <span className="collection-row-count">
                          {
                            state.items.filter((i) => i.collectionId === c.id)
                              .length
                          }{" "}
                          道题目
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="primary collection-create"
                  onClick={() => setCollectionDialog(true)}
                >
                  <QuickIcon name="plus" />
                  创建题集
                </button>
              </div>
              {!state.collections.length && (
                <div className="empty collections-empty">
                  <h2>创建你的第一份题集</h2>
                  <p>从题库选择题目，调整顺序，再导出练习。</p>
                </div>
              )}
              {currentCollection && paper && (
                <React.Fragment>
                  <section className="collection-settings">
                    <div className="detail-title">
                      <h2>{currentCollection.title}</h2>
                    </div>
                    <div className="paper-settings">
                      <h3>文档设置</h3>
                      <label className="field">
                        <span>试卷主标题（留空隐藏）</span>
                        <input
                          aria-label="试卷主标题"
                          maxLength={80}
                          value={paper.paperTitle}
                          onChange={(e) =>
                            changePaper({ paperTitle: e.target.value })
                          }
                        />
                      </label>
                      <div className="filter-row">
                        <label className="field">
                          <span>考试时间 / 分钟</span>
                          <input
                            type="number"
                            min={0}
                            max={999}
                            value={paper.examMinutes || ""}
                            onChange={(e) =>
                              changePaper({
                                examMinutes: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>满分</span>
                          <input
                            type="number"
                            min={0}
                            max={9999}
                            value={paper.totalScore || ""}
                            onChange={(e) =>
                              changePaper({
                                totalScore: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label className="field">
                        <span>考试说明</span>
                        <textarea
                          rows={2}
                          maxLength={600}
                          placeholder="选填，留空则不显示"
                          value={paper.examInstructions}
                          onChange={(e) =>
                            changePaper({ examInstructions: e.target.value })
                          }
                        />
                      </label>
                      <div className="paper-actions">
                        <button
                          className="primary paper-save"
                          disabled={busy}
                          onClick={() => void run(() => saveDraft())}
                        >
                          保存设置
                        </button>
                        <div className="paper-export-actions">
                          <button
                            disabled={busy || !collectionQuestions.length}
                            onClick={() => void run(() => doExport("pdf"))}
                          >
                            导出 PDF
                          </button>
                          <button
                            disabled={busy || !collectionQuestions.length}
                            onClick={() => void run(() => doExport("docx"))}
                          >
                            导出 Word
                          </button>
                        </div>
                        <div className="paper-danger-actions">
                          <HoldButton
                            label="长按删除题集"
                            ariaLabel="长按删除题集"
                            className="paper-delete collection-remove"
                            disabled={busy}
                            onComplete={() =>
                              void run(async () => {
                                await saveDraft();
                                const token = await api.deleteCollection(
                                  collectionId!,
                                );
                                setCollectionId(undefined);
                                setPaper(undefined);
                                paperDirty.current = false;
                                deletedNotice(
                                  "题集已删除，题库中的原题仍保留",
                                  token,
                                );
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </section>
                  <section className="collection-detail">
                    <div
                      className="collection-selected-content"
                      inert={collectionPickerOpen}
                      aria-hidden={collectionPickerOpen || undefined}
                    >
                      <div className="list-heading">
                        <div>
                          <h3>已选题目</h3>
                          <span className="hint">
                            {collectionQuestions.length} 道题 · 按此顺序导出
                          </span>
                        </div>
                        <button
                          className="primary collection-add-trigger"
                          ref={pickerTriggerRef}
                          aria-haspopup="dialog"
                          aria-expanded={collectionPickerOpen}
                          onClick={() => {
                            setPickerFilter(emptyFilter);
                            setPickerView("library");
                            setPickerLimit(100);
                            setFabOpen(false);
                            setCollectionPickerOpen(true);
                          }}
                        >
                          <QuickIcon name="plus" />
                          从题库添加
                        </button>
                      </div>
                      <div className="collection-question-list">
                        {collectionQuestions.map((q, i) =>
                          renderCard(q, i + 1, true),
                        )}
                        {!collectionQuestions.length && (
                          <div className="empty">
                            <h3>尚未加入题目</h3>
                            <p>在题库中点击“加入题集”，即可添加题目。</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {collectionPickerOpen && (
                      <div
                        className="collection-library-picker"
                        ref={pickerPanelRef}
                        role="dialog"
                        aria-label="从题库添加"
                        onKeyDown={(event) => {
                          if (
                            event.key === "Escape" &&
                            !event.defaultPrevented
                          ) {
                            event.preventDefault();
                            closeCollectionPicker();
                          }
                        }}
                      >
                        <div className="collection-picker-heading">
                          <div>
                            <h3>从题库添加</h3>
                            <p>
                              加入“{currentCollection.title}” · 已选{" "}
                              {collectionQuestions.length} 道题
                            </p>
                          </div>
                          <button
                            className="picker-close"
                            aria-label="关闭题库选择"
                            onClick={closeCollectionPicker}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              aria-hidden="true"
                            >
                              <path d="m6 6 12 12M18 6 6 18" />
                            </svg>
                          </button>
                        </div>
                        <div
                          className="collection-picker-tabs"
                          role="tablist"
                          aria-label="添加题目视图"
                        >
                          <button
                            role="tab"
                            id="picker-library-tab"
                            aria-selected={pickerView === "library"}
                            aria-controls="picker-results"
                            tabIndex={pickerView === "library" ? 0 : -1}
                            onClick={() => {
                              setPickerView("library");
                              setPickerLimit(100);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key === "ArrowRight" ||
                                event.key === "ArrowLeft"
                              ) {
                                event.preventDefault();
                                setPickerView("selected");
                                setPickerLimit(100);
                                requestAnimationFrame(() =>
                                  document
                                    .getElementById("picker-selected-tab")
                                    ?.focus(),
                                );
                              }
                            }}
                          >
                            题库
                          </button>
                          <button
                            role="tab"
                            id="picker-selected-tab"
                            aria-selected={pickerView === "selected"}
                            aria-controls="picker-results"
                            tabIndex={pickerView === "selected" ? 0 : -1}
                            onClick={() => {
                              setPickerView("selected");
                              setPickerLimit(100);
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key === "ArrowRight" ||
                                event.key === "ArrowLeft"
                              ) {
                                event.preventDefault();
                                setPickerView("library");
                                setPickerLimit(100);
                                requestAnimationFrame(() =>
                                  document
                                    .getElementById("picker-library-tab")
                                    ?.focus(),
                                );
                              }
                            }}
                          >
                            已选题目 <span>{collectionQuestions.length}</span>
                          </button>
                        </div>
                        {pickerView === "library" ? (
                          <div className="collection-picker-tools">
                            <input
                              ref={pickerSearchRef}
                              type="search"
                              aria-label="搜索添加题目"
                              placeholder="搜索题干、知识点…"
                              value={pickerFilter.keyword}
                              onChange={(event) =>
                                setPickerF({ keyword: event.target.value })
                              }
                            />
                            <div className="collection-picker-filters">
                              <GlideSelect
                                boundaryRef={pickerPanelRef}
                                label="年级"
                                value={pickerFilter.grade}
                                onChange={(grade) => setPickerF({ grade })}
                                options={[
                                  { value: "", label: "全部年级" },
                                  ...grades.map((value) => ({
                                    value,
                                    label: value,
                                  })),
                                ]}
                              />
                              <GlideSelect
                                boundaryRef={pickerPanelRef}
                                label="难度"
                                value={pickerFilter.difficulty}
                                onChange={(difficulty) =>
                                  setPickerF({ difficulty })
                                }
                                options={[
                                  { value: "", label: "全部难度" },
                                  ...["待评估", ...difficulties].map(
                                    (value) => ({
                                      value,
                                      label: value,
                                    }),
                                  ),
                                ]}
                              />
                              <GlideSelect
                                boundaryRef={pickerPanelRef}
                                label="题型"
                                value={pickerFilter.kind}
                                onChange={(kind) => setPickerF({ kind })}
                                options={[
                                  { value: "", label: "全部题型" },
                                  ...kinds.map((value) => ({
                                    value,
                                    label: value,
                                  })),
                                ]}
                              />
                              <GlideSelect
                                boundaryRef={pickerPanelRef}
                                label="知识点"
                                value={pickerFilter.knowledge}
                                onChange={(knowledge) =>
                                  setPickerF({ knowledge })
                                }
                                options={knowledgeOptions(
                                  state.customKnowledge,
                                )}
                              />
                              <GlideSelect
                                boundaryRef={pickerPanelRef}
                                label="校对状态"
                                value={pickerFilter.reviewed}
                                onChange={(reviewed) =>
                                  setPickerF({
                                    reviewed: reviewed as Filter["reviewed"],
                                  })
                                }
                                options={[
                                  { value: "all", label: "全部状态" },
                                  { value: "pending", label: "待校对" },
                                  { value: "reviewed", label: "已校对" },
                                ]}
                              />
                            </div>
                            <div className="collection-picker-summary">
                              <span>{pickerQuestions.length} 道题目</span>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={pickerFilter.favorite}
                                  onChange={(event) =>
                                    setPickerF({
                                      favorite: event.target.checked,
                                    })
                                  }
                                />
                                仅收藏
                              </label>
                              <button
                                className="ghost"
                                onClick={() => {
                                  setPickerFilter(emptyFilter);
                                  setPickerLimit(100);
                                }}
                              >
                                重置筛选
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="collection-picker-selected-hint">
                            按导出顺序显示，添加、移除与排序会实时更新。
                          </p>
                        )}
                        <div
                          className="collection-picker-results"
                          id="picker-results"
                          role="tabpanel"
                          aria-labelledby={
                            pickerView === "library"
                              ? "picker-library-tab"
                              : "picker-selected-tab"
                          }
                        >
                          {pickerQuestions
                            .slice(0, pickerLimit)
                            .map((q, index) =>
                              renderCard(
                                q,
                                index + 1,
                                pickerView === "selected",
                                true,
                              ),
                            )}
                          {!pickerQuestions.length && (
                            <div className="empty">
                              <h3>
                                {pickerView === "selected"
                                  ? "尚未加入题目"
                                  : "没有符合条件的题目"}
                              </h3>
                              <p>
                                {pickerView === "selected"
                                  ? "切换到题库，点击“加入题集”即可添加。"
                                  : "试试调整搜索内容或筛选条件。"}
                              </p>
                            </div>
                          )}
                          {pickerQuestions.length > pickerLimit && (
                            <button
                              className="picker-more"
                              onClick={() =>
                                setPickerLimit((limit) => limit + 100)
                              }
                            >
                              显示更多题目
                            </button>
                          )}
                        </div>
                        <div className="collection-picker-footer">
                          <button
                            className="picker-selection-link"
                            onClick={() => {
                              setPickerView("selected");
                              setPickerLimit(100);
                            }}
                            aria-label="查看已选题目"
                          >
                            <span aria-live="polite">
                              已选 {collectionQuestions.length} 道题
                            </span>
                          </button>
                          <button
                            className="primary"
                            onClick={closeCollectionPicker}
                          >
                            完成添加
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </React.Fragment>
              )}
              {!!state.collections.length && !currentCollection && (
                <div className="empty collection-unselected">
                  <h3>选择一份题集</h3>
                  <p>查看文档设置和已选题目。</p>
                </div>
              )}
            </div>
          )}
          {section === "knowledge" && (
            <KnowledgePage
              custom={state.customKnowledge}
              questions={state.questions}
              group={pointGroup}
              name={pointName}
              onGroup={setPointGroup}
              onName={setPointName}
              busy={busy}
              onAdd={() =>
                run(async () => {
                  await api.addKnowledge({
                    group: pointGroup,
                    name: pointName.trim(),
                  });
                  setPointName("");
                  setNotice("知识点已添加");
                  return true;
                })
              }
            />
          )}
          {section === "tasks" && (
            <TasksPage
              jobs={state.jobs}
              questions={state.questions}
              onOpenQuestion={(question) => void run(() => openCard(question))}
              busy={busy}
              onCancel={(id) => void run(() => api.cancelJob(id))}
              onResume={(id) => void run(() => api.resumeJob(id))}
              renderMath={(text) => <MathView text={text} />}
            />
          )}
          {section === "settings" && settings && (
            <section className="page-scroll settings-page">
              <section
                className="settings-card appearance-settings"
                aria-labelledby="appearance-heading"
              >
                <h2 id="appearance-heading">外观</h2>
                <p>选择主题色，立即生效并自动保存。题目阅读区保持浅色。</p>
                <fieldset className="theme-options">
                  <legend>主题色</legend>
                  {colorThemes.map((theme) => (
                    <label
                      key={theme.id}
                      className="theme-option"
                      data-color-theme={theme.id}
                    >
                      <input
                        type="radio"
                        name="color-theme"
                        value={theme.id}
                        checked={
                          (state.settings.colorTheme ?? "GRAPHITE") === theme.id
                        }
                        disabled={busy}
                        onChange={() =>
                          void run(async () => {
                            await api.setColorTheme(theme.id);
                            await refresh();
                          })
                        }
                      />
                      <span className="theme-swatch" aria-hidden="true" />
                      <span>{theme.name}</span>
                    </label>
                  ))}
                </fieldset>
                <p className="theme-current" role="status">
                  当前主题：
                  {
                    colorThemes.find(
                      (theme) =>
                        theme.id === (state.settings.colorTheme ?? "GRAPHITE"),
                    )?.name
                  }
                </p>
              </section>
              <div className="settings-card">
                <div className="settings-help-heading">
                  <h2>题目识别与接口</h2>
                  <button onClick={() => setGuideOpen(true)}>
                    图文配置教学
                  </button>
                </div>
                <p>
                  使用支持图片输入的 Chat Completions
                  接口。密钥加密保存，识别与解题会调用你配置的服务。
                </p>
                <label className="field">
                  <span>HTTPS 接口地址</span>
                  <input
                    aria-label="接口地址"
                    value={settings.address}
                    onChange={(e) =>
                      changeSettings({ address: e.target.value })
                    }
                    placeholder="https://your-service.example/v1"
                  />
                </label>
                <label className="field">
                  <span>模型名</span>
                  <input
                    aria-label="模型名"
                    value={settings.model}
                    onChange={(e) => changeSettings({ model: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>
                    API Key ·{" "}
                    {state.settings.hasApiKey ? "已配置，留空保留" : "尚未配置"}
                  </span>
                  <input
                    aria-label="API Key"
                    type="password"
                    autoComplete="off"
                    value={settings.apiKey ?? ""}
                    onChange={(e) => changeSettings({ apiKey: e.target.value })}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={settings.autoSolveImports}
                    onChange={(e) =>
                      changeSettings({ autoSolveImports: e.target.checked })
                    }
                  />
                  导入后自动解题（默认关闭）
                </label>
                <div className="button-row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api.saveSettings(settings);
                        settingsDirty.current = false;
                        setSettings((s) => (s ? { ...s, apiKey: "" } : s));
                        setNotice("接口配置已保存");
                        await refresh();
                      })
                    }
                  >
                    保存接口配置
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => setNotice(await api.testVision()))
                    }
                  >
                    测试图片识别
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await api.saveSettings({
                          ...settings,
                          apiKey: "",
                          clearApiKey: true,
                        });
                        settingsDirty.current = false;
                        await refresh();
                      })
                    }
                  >
                    清除密钥
                  </button>
                </div>
              </div>
              <div className="settings-card">
                <h2>题库导入与备份</h2>
                <p>
                  目前仅支持 Windows 版 Matheca 导出的 ZIP 题库，Android
                  题库导入暂未开放。
                </p>
                <p>
                  ZIP 保存题目、原图、知识点、解答与题集设置。相同 ID
                  的记录保留本机版本；不会覆盖另一端已有题目的修改。接口配置和任务不进入备份。
                </p>
                <div className="button-row">
                  <button onClick={() => void run(inspect)}>
                    导入 Windows 题库
                  </button>
                  <button
                    className="primary"
                    onClick={() =>
                      void run(async () => {
                        const r = await api.exportBackup();
                        if (r)
                          setNotice(
                            `题库已备份，缺失原图 ${r.missingImages} 张`,
                          );
                      })
                    }
                  >
                    导出完整题库
                  </button>
                </div>
              </div>
              <QuickHelp />
            </section>
          )}
          {busy && (
            <div className="busy-indicator">
              <span />
              正在处理…
            </div>
          )}
          {fabOpen && section !== "history" && (
            <div className="fab-backdrop" onClick={() => setFabOpen(false)} />
          )}
          <div
            className={"fab-group " + (fabOpen ? "open" : "")}
            hidden={
              collectionPickerOpen || !!documentPreview || section === "history"
            }
            inert={
              collectionPickerOpen || !!documentPreview || section === "history"
            }
          >
            {fabOpen && (
              <div className="fab-menu" role="menu">
                <button
                  role="menuitem"
                  onClick={() => {
                    setFabOpen(false);
                    setNewTitle("");
                    setCollectionDialog(true);
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="folder-add" />
                  </span>
                  创建题集
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setFabOpen(false);
                    void run(inspect);
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="upload" />
                  </span>
                  导入题库
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setFabOpen(false);
                    void run(() => api.chooseImport());
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="upload" />
                  </span>
                  导入图片 / PDF
                </button>
                <button
                  role="menuitem"
                  disabled={busy}
                  onClick={() => {
                    setFabOpen(false);
                    void run(async () => {
                      const imported = await api.captureImport();
                      if (imported) {
                        visitSection("tasks");
                        setNotice("截图已导入，正在识别题目");
                      }
                    });
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="screenshot" />
                  </span>
                  截图导入题目
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setFabOpen(false);
                    void run(addQuestion);
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="file-add" />
                  </span>
                  手动录入题目
                </button>
                <button
                  role="menuitem"
                  className="soon"
                  onClick={() => {
                    setFabOpen(false);
                    setNotice("移动端导入将在与手机 App 联动后开放。");
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="swap" />
                  </span>
                  移动端导入
                  <small>即将支持</small>
                </button>
                <button
                  role="menuitem"

                  onClick={() => {
                    setFabOpen(false);
                    setMobileOpen(true);
                  }}
                >
                  <span className="fab-menu-icon">
                    <QuickIcon name="camera" />
                  </span>
                  手机联动
                </button>
              </div>
            )}
            <button
              className="fab"
              aria-label="新建题目"
              aria-expanded={fabOpen}
              onClick={() => setFabOpen((open) => !open)}
            >
              <QuickIcon name="plus" />
            </button>
          </div>
        </main>
      </div>
      {documentPreview && (
        <DocumentPreview
          data={documentPreview.data}
          title={documentPreview.title}
          format={documentPreview.format}
          busy={busy}
          onClose={closeDocumentPreview}
          onExport={() => void run(confirmDocumentExport)}
        />
      )}
      {guideOpen && (
        <ApiGuide
          onClose={() => setGuideOpen(false)}
          onApply={() => {
            changeSettings({
              address: guideValues.address,
              model: guideValues.model,
            });
            setGuideOpen(false);
            setNotice("已填入地址与模型名，请粘贴 API Key 后保存配置");
          }}
        />
      )}
      {manualSavePrompt && (
        <ManualSaveDialog
          hasContent={manualSavePrompt.hasContent}
          onDecision={(choice) => manualSaveRequest.current?.resolve(choice)}
        />
      )}
      {pendingKnowledge !== undefined && knowledgeConfirmationReady && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="knowledge-switch-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.stopPropagation();
                setPendingKnowledge(undefined);
              }
            }}
          >
            <h2 id="knowledge-switch-title">保存当前题目？</h2>
            <p>
              保存后结束当前校对，
              {pendingKnowledge
                ? `查看“${pendingKnowledge}”的题目`
                : "查看全部题目"}
              。取消则继续校对当前题目。
            </p>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => setPendingKnowledge(undefined)}
              >
                取消
              </button>
              <button
                autoFocus
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await saveDraft();
                    setEditorOpen(false);
                    finishEditorClose();
                    setF({ knowledge: pendingKnowledge });
                    setPendingKnowledge(undefined);
                  })
                }
              >
                保存并切换
              </button>
            </div>
          </section>
        </div>
      )}
      {joinQuestionId && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="join-collection-title"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) {
                event.stopPropagation();
                setJoinQuestionId(undefined);
              }
            }}
          >
            <h2 id="join-collection-title">加入题集</h2>
            <p>选择已有题集，或创建一个新题集。已加入的题目会自动去重。</p>
            <div className="collection-choices">
              {state.collections.map((c) => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await addToCollection(c.id, [joinQuestionId]);
                      setJoinQuestionId(undefined);
                    })
                  }
                >
                  {c.title}
                </button>
              ))}
              {!state.collections.length && (
                <p className="hint">暂无题集，可在下方创建。</p>
              )}
            </div>
            <label className="field">
              <span>新题集名称</span>
              <input
                autoFocus
                aria-label="新题集名称"
                value={joinTitle}
                maxLength={200}
                onChange={(event) => setJoinTitle(event.target.value)}
              />
            </label>
            <div className="button-row">
              <button
                disabled={busy}
                onClick={() => setJoinQuestionId(undefined)}
              >
                取消
              </button>
              <button
                className="primary"
                disabled={busy || !joinTitle.trim()}
                onClick={() =>
                  void run(async () => {
                    const collection = newCollection(
                      crypto.randomUUID(),
                      joinTitle.trim(),
                    );
                    await api.saveCollection(collection);
                    await addToCollection(
                      collection.id,
                      [joinQuestionId],
                      `已创建“${collection.title}”并加入题目`,
                    );
                    setJoinQuestionId(undefined);
                  })
                }
              >
                创建并加入
              </button>
            </div>
          </section>
        </div>
      )}
      {collectionDialog && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>创建题集</h2>
            <p>给这份练习起一个名字。</p>
            <input
              aria-label="题集名称"
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              maxLength={200}
            />
            <div className="button-row">
              <button onClick={() => setCollectionDialog(false)}>取消</button>
              <button
                className="primary"
                disabled={!newTitle.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await saveDraft();
                    const c = newCollection(
                      crypto.randomUUID(),
                      newTitle.trim(),
                    );
                    await api.saveCollection(c);
                    setCollectionId(c.id);
                    setPaper(c);
                    visitSection("collections");
                    setCollectionDialog(false);
                    setNewTitle("");
                  })
                }
              >
                创建题集
              </button>
            </div>
          </section>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop">
          <section className="modal">
            <h2>题库导入预览</h2>
            <p>
              包含 {preview.questions} 道题、{preview.collections} 个题集、
              {preview.images} 张原图和 {preview.knowledgePoints}{" "}
              个自定义知识点。
            </p>
            {preview.missingImages > 0 && (
              <p className="pending">
                备份前已缺失 {preview.missingImages} 张原图。
              </p>
            )}
            <p>相同编号保留本机版本。取消预览不会写入题库。</p>
            <div className="button-row">
              <button
                onClick={() =>
                  void run(async () => {
                    await api.dismissBackup(preview.token);
                    setPreview(undefined);
                  })
                }
              >
                取消
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await api.restoreBackup(preview.token);
                    setNotice(
                      `新增 ${r.questions} 道题、${r.collections} 个题集；保留本机 ${r.skippedQuestions} 道题`,
                    );
                    setPreview(undefined);
                  })
                }
              >
                确认合并导入
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
