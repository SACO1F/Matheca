export interface Question {
  id: string;
  title: string;
  body: string;
  latex: string;
  grade: string;
  kind: string;
  difficulty: string;
  knowledge: string;
  sourcePath: string;
  sourceLabel: string;
  figures?: string[];
  /** Printed figure widths in mm; 0 preserves automatic sizing. */
  figureWidths?: number[];
  /** Image placement; absent entries in older questions belong to the stem. */
  figurePlacements?: ("stem" | "A" | "B" | "C" | "D")[];
  reviewed: boolean;
  favorite: boolean;
  example: boolean;
  createdAt: string;
  autoSolve: boolean;
  solution: string;
  solutionLatex: string;
  solutionFingerprint: string;
  solutionError: string;
}
export interface Collection {
  id: string;
  title: string;
  createdAt: string;
  paperTitle: string;
  examInstructions: string;
  examMinutes: number;
  totalScore: number;
  questionLayout?: Record<
    string,
    { answerSpaceMm?: number; pageBreakBefore?: boolean }
  >;
}
export interface CollectionItem {
  collectionId: string;
  questionId: string;
  position: number;
}
export interface KnowledgePoint {
  group: string;
  name: string;
}
export interface Settings {
  colorTheme?: import("./color-themes").ColorTheme;
  theme: "SYSTEM" | "LIGHT" | "DARK";
  address: string;
  model: string;
  hasApiKey: boolean;
  autoSolveImports: boolean;
}
export interface SettingsInput extends Omit<Settings, "hasApiKey"> {
  apiKey?: string;
  clearApiKey?: boolean;
}
export interface ImportJob {
  id: string;
  status: string;
  message: string;
  createdAt: string;
  completed: number;
  total: number;
  type: "import" | "solution";
  questionId?: string;
  questionIds?: string[];
  sourceFiles?: {
    name: string;
    recognizedCount: number;
    completedPages: number;
  }[];
  recognizedCount?: number;
  /** Snapshot of the question when the solution task was created. */
  questionPreview?: string;
  questionSource?: string;
}
export interface State {
  questions: Question[];
  collections: Collection[];
  items: CollectionItem[];
  customKnowledge: KnowledgePoint[];
  jobs: ImportJob[];
  settings: Settings;
}
export interface Filter {
  keyword: string;
  grade: string;
  kind: string;
  difficulty: string;
  knowledge: string;
  reviewed: "all" | "pending" | "reviewed";
  favorite: boolean;
}
export interface BackupPreview {
  token: string;
  questions: number;
  collections: number;
  images: number;
  knowledgePoints: number;
  missingImages: number;
}
export interface RestoreResult {
  questions: number;
  collections: number;
  skippedQuestions: number;
  skippedCollections: number;
  knowledgePoints: number;
}
export interface ExportResult {
  path: string;
  format: "pdf" | "docx";
}
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
export interface MobilePhoto {
  id: string;
  name: string;
  size: number;
  preview: string;
}
export interface MobileImportState {
  sessionId: string;
  status: "closed" | "receiving" | "expired" | "importing";
  urls: string[];
  qrCodes: string[];
  expiresAt: number;
  connected: boolean;
  files: MobilePhoto[];
  imported: number;
}
export interface DesktopAPI {
  mobileStart(): Promise<MobileImportState>;
  mobileStatus(): Promise<MobileImportState>;
  mobilePause(): Promise<void>;
  mobileRemove(id: string): Promise<MobileImportState>;
  mobileConfirm(): Promise<number>;
  historyList(
    limit?: number,
    offset?: number,
    query?: string,
  ): Promise<{ records: HistoryEntry[]; total: number }>;
  recordHistory(title: string, detail?: string): Promise<void>;
  onHistoryChanged(fn: () => void): () => void;
  state(): Promise<State>;
  saveQuestion(q: Question, confirm?: boolean): Promise<Question>;
  undoReview(expected: Question): Promise<Question>;
  deleteQuestion(id: string): Promise<string>;
  undoDeletion(token: string): Promise<{
    kind: "question" | "collection" | "item";
    collection?: Collection;
  }>;
  cropFigure(
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<string>;
  examples(): Promise<void>;
  saveCollection(c: Collection): Promise<void>;
  deleteCollection(id: string): Promise<string>;
  addQuestions(id: string, questionIds: string[]): Promise<number>;
  addQuestionsWithUndo(
    id: string,
    ids: string[],
  ): Promise<{ count: number; token?: string }>;
  undoAddition(token: string): Promise<void>;
  reorder(id: string, questionIds: string[]): Promise<void>;
  removeQuestion(collectionId: string, questionId: string): Promise<string>;
  addKnowledge(point: KnowledgePoint): Promise<void>;
  saveSettings(settings: SettingsInput): Promise<void>;
  setColorTheme(theme: import("./color-themes").ColorTheme): Promise<void>;
  setManualPromptOpen(open: boolean): Promise<void>;
  testVision(): Promise<string>;
  chooseImport(): Promise<void>;
  captureImport(): Promise<boolean | null>;
  importDropped(files: File[]): Promise<BackupPreview | void>;
  pasteImage(): Promise<void>;
  resumeJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  solveQuestion(id: string): Promise<void>;
  inspectBackup(): Promise<BackupPreview | null>;
  restoreBackup(token: string): Promise<RestoreResult>;
  dismissBackup(token: string): Promise<void>;
  exportBackup(): Promise<{ path: string; missingImages: number } | null>;
  exportCollection(
    id: string,
    format: "pdf" | "docx",
  ): Promise<ExportResult | null>;
  previewCollection(id: string): Promise<number[]>;
  openExport(path: string): Promise<void>;
  openGuideLink(key: import("./guide").GuideLink): Promise<void>;
  copyGuideValue(key: import("./guide").GuideValue): Promise<void>;
  onChanged(fn: () => void): () => void;
  onBeforeClose(fn: () => Promise<void>): () => void;
}
export interface HistoryEntry {
  id: number;
  timestamp: number;
  title: string;
  detail: string;
  category: "operation" | "interaction" | "task" | "application";
  status: "done" | "failed" | "cancelled";
}
export const newQuestion = (id: string): Question => ({
  id,
  title: "新题目",
  body: "",
  latex: "",
  grade: "",
  kind: "解答题",
  difficulty: "待评估",
  knowledge: "",
  sourcePath: "",
  sourceLabel: "手动录入",
  reviewed: false,
  favorite: false,
  example: false,
  createdAt: Date.now().toString(),
  autoSolve: false,
  solution: "",
  solutionLatex: "",
  solutionFingerprint: "",
  solutionError: "",
});
export const newCollection = (id: string, title: string): Collection => ({
  id,
  title,
  createdAt: Date.now().toString(),
  paperTitle: title.slice(0, 80),
  examInstructions: "",
  examMinutes: 0,
  totalScore: 0,
});
