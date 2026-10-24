import { isColorTheme } from "../shared/color-themes";
import {
  validateFigures,
  validateFigureWidths,
  validateFigurePlacements,
} from "../domain/figures";
import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  dialog,
  clipboard,
  protocol,
  net,
  shell,
  nativeTheme,
  nativeImage,
} from "electron";
import squirrel from "electron-squirrel-startup";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { Store } from "./store";
import { describeOperation } from "./history";
import { SettingsService } from "./settings";
import { Jobs } from "./jobs";
import { work } from "./workers";
import { exportDocument, previewDocument } from "./export";
import { fingerprint } from "./fingerprint";
import { complete } from "./network";
import { RenderHost } from "./render-host";
import { ScreenCapture } from "./screen-capture";
import { MobileImport } from "./mobile-import";
import { LibraryExchange } from "./library-exchange";
import { publishFile, fileOperationMessage } from "./file-operations";
import {
  guideLinks,
  guideValues,
  type GuideLink,
  type GuideValue,
} from "../shared/guide";
import type { BackupData } from "../domain/backup";
import { setAppVersionTag } from "../domain/backup";
import type {
  Question,
  Collection,
  KnowledgePoint,
  SettingsInput,
  RestoreResult,
  Reply,
} from "../shared/types";
if (squirrel) app.quit();
app.setName("Matheca");
// Backups record which build produced them. Read the real version here instead
// of hard-coding it in the encoder.
setAppVersionTag(app.getVersion());
// Reuse existing libraries in place; never move or rewrite the user's directory.
const legacyDataRoot = path.join(app.getPath("appData"), "Mathector");
if (
  !process.env.MATHECA_TEST_DATA &&
  fs.existsSync(legacyDataRoot) &&
  !fs.existsSync(path.join(app.getPath("appData"), "Matheca"))
)
  app.setPath("userData", legacyDataRoot);

if (process.env.MATHECA_TEST_DATA)
  app.setPath("userData", path.resolve(process.env.MATHECA_TEST_DATA));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "matheca-asset",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
let win: BrowserWindow,
  store: Store,
  settings: SettingsService,
  jobs: Jobs,
  root: string,
  quitting = false,
  closePending = false;
let mobileImport: MobileImport;
let libraryExchange: LibraryExchange;
let screenCapture: ScreenCapture;
let manualPromptOpen = false;
let tray: Tray | undefined;
let closeChoiceOpen = false;
let closeChoiceReady = false;
let quitReady = false;
let closeRequest = 0;
const previews = new Map<string, { file: string; folder: string }>(),
  exports = new Set<string>(),
  workers = new Set<Promise<unknown>>(),
  operations = new Set<Promise<unknown>>(),
  requestControllers = new Set<AbortController>();
function changed() {
  if (win && !win.isDestroyed()) win.webContents.send("state:changed");
  historyChanged();
}
function historyChanged() {
  if (win && !win.isDestroyed()) win.webContents.send("history:changed");
}
function id(v: unknown): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > 128 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(v)
  )
    throw Error("编号无效");
  return v;
}
function string(v: unknown, max = 3100000): string {
  if (typeof v !== "string" || v.length > max)
    throw Error("字段格式无效或内容过长");
  return v;
}
function boolean(v: unknown): boolean {
  if (typeof v !== "boolean") throw Error("布尔字段无效");
  return v;
}
function ids(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 20000) throw Error("选择列表无效");
  return v.map(id);
}
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("参数无效");
  return v as Record<string, unknown>;
}
function trusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent) {
  return (
    event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame
  );
}
function handle(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args): Promise<Reply<unknown>> => {
    let entry: ReturnType<typeof describeOperation>;
    try {
      if (!trusted(event)) throw Error("调用来源无效");
      if (quitting) throw Error("应用正在退出");
      entry = describeOperation(store, channel, args);
      const operation = Promise.resolve().then(() => fn(...args));
      operations.add(operation);
      try {
        const data = await operation;
        if (entry) {
          const cancelled = data === null || channel === "backup:dismiss";
          try {
            store.addHistory({
              ...entry,
              category: "operation",
              status: cancelled ? "cancelled" : "done",
            });
            historyChanged();
          } catch {
            // The business operation is already committed. A full audit table
            // must not turn a successful export/save into a false failure.
            console.warn("操作已完成，但历史记录暂时无法写入");
          }
        }
        return { ok: true, data };
      } finally {
        operations.delete(operation);
      }
    } catch (e) {
      if (entry) {
        try {
          store.addHistory({
            ...entry,
            detail: entry.detail + " · 操作未完成，请查看页面提示",
            category: "operation",
            status: "failed",
          });
          historyChanged();
        } catch {
          // Preserve the original actionable error (e.g. disk full), even if
          // recording that failure encounters the same storage problem.
          console.warn("操作失败记录暂时无法写入");
        }
      }
      return {
        ok: false,
        error: fileOperationMessage(e),
      };
    }
  });
}
async function background<T>(op: string, args: Record<string, unknown>) {
  const promise = work<T>(op, args);
  workers.add(promise);
  try {
    return await promise;
  } finally {
    workers.delete(promise);
  }
}
async function cleanupPreview(token: string) {
  const p = previews.get(token);
  if (p) {
    previews.delete(token);
    fs.rmSync(p.folder, { recursive: true, force: true });
  }
}
async function inspectBackupFile(source: string) {
  const token = randomUUID(),
    folder = path.join(root, "staging", token),
    file = path.join(folder, "archive.zip");
  fs.mkdirSync(folder, { recursive: true });
  try {
    if (!fs.statSync(source).isFile())
      throw Error("请选择 Windows 题库 ZIP 文件");
    if (fs.statSync(source).size > 512 * 1024 * 1024)
      throw Error("备份文件超过 512 MB");
    await fs.promises.copyFile(source, file);
    const data = await background<BackupData>("inspect", {
      file,
      staging: path.join(folder, "images"),
    });
    previews.set(token, { file, folder });
    return {
      token,
      questions: data.questions.length,
      collections: data.collections.length,
      images: new Set(Object.values(data.sources)).size,
      knowledgePoints: data.customKnowledge.length,
      missingImages: data.missingSources,
    };
  } catch (error) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}
async function finishQuit() {
  if (quitting) return;
  quitting = true;
  try {
    screenCapture?.cancel();
    await mobileImport?.pause();
    for (const controller of requestControllers) controller.abort();
    await jobs.stopAll();
    await Promise.allSettled([...operations]);
    await Promise.allSettled([...workers]);
    for (const token of previews.keys()) await cleanupPreview(token);
    store.close();
    tray?.destroy();
    tray = undefined;
    quitReady = true;
    app.quit();
  } catch (error) {
    quitting = false;
    showMainWindow();
    dialog.showErrorBox(
      "Matheca 暂未退出",
      error instanceof Error ? error.message : "请稍后重试退出",
    );
  }
}
function showMainWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.setSkipTaskbar(false);
  win.show();
  win.focus();
}
function ensureTray() {
  if (tray && !tray.isDestroyed()) return;
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "../../assets/icon.png"))
    .resize({ width: 32, height: 32 });
  if (icon.isEmpty()) throw Error("无法载入托盘图标，请保留完整应用目录");
  tray = new Tray(icon);
  tray.setToolTip("Matheca");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "显示 Matheca", click: showMainWindow },
      { type: "separator" },
      { label: "退出", click: requestQuit },
    ]),
  );
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);
}
function requestQuit() {
  if (quitting || closePending) return;
  closeChoiceOpen = false;
  win.webContents.send("window:close-choice", false);
  showMainWindow();
  if (manualPromptOpen) return;
  closePending = true;
  const request = ++closeRequest;
  win.webContents.send("window:before-close");
  setTimeout(() => {
    if (
      request !== closeRequest ||
      !closePending ||
      quitting ||
      manualPromptOpen
    )
      return;
    closePending = false;
    void dialog
      .showMessageBox(win, {
        type: "warning",
        buttons: ["返回应用", "退出"],
        defaultId: 0,
        cancelId: 0,
        message: "界面未响应，尚未确认草稿保存",
        detail: "已写入的题库与任务进度会保留。",
      })
      .then((result) => {
        if (result.response === 1) void finishQuit();
      });
  }, 15000);
}
function moveToBackground() {
  ensureTray();
  win.hide();
  win.setSkipTaskbar(true);
}
async function chooseCloseAction() {
  if (closeChoiceOpen || closePending || quitting || manualPromptOpen) return;
  try {
    const preference = settings.read().closeAction;
    if (preference === "quit") {
      requestQuit();
      return;
    }
    if (preference === "background") {
      moveToBackground();
      return;
    }
    closeChoiceOpen = true;
    closeChoiceReady = false;
    win.webContents.send("window:close-choice", true);
    setTimeout(() => {
      if (!closeChoiceOpen || closeChoiceReady || quitting) return;
      closeChoiceOpen = false;
      void dialog
        .showMessageBox(win, {
          type: "warning",
          message: "界面未响应，无法显示关闭选项",
          buttons: ["返回应用", "后台运行", "直接退出"],
          defaultId: 0,
          cancelId: 0,
        })
        .then((result) => {
          if (result.response === 1) moveToBackground();
          else if (result.response === 2) requestQuit();
        });
    }, 15000);
  } catch (error) {
    closeChoiceOpen = false;
    showMainWindow();
    dialog.showErrorBox(
      "Matheca 暂未关闭",
      error instanceof Error ? error.message : "请稍后重试",
    );
  }
}

function applyTheme() {
  nativeTheme.themeSource = "light";
  updateTitleBar();
}
function updateTitleBar() {
  if (!win || win.isDestroyed()) return;
  win.setTitleBarOverlay({
    color: "#f4f6fa",
    symbolColor: "#26334b",
    height: 36,
  });
}
function publicQuestion(q: Question): Question {
  const current = q.solutionFingerprint === fingerprint(q);
  return {
    ...q,
    solution: current ? q.solution : "",
    solutionLatex: current ? q.solutionLatex : "",
    sourcePath: q.sourcePath
      ? `matheca-asset://question/${encodeURIComponent(q.id)}`
      : "",
  };
}
function register() {
  handle("settings:close-action", (value: unknown) => {
    if (value !== "ask" && value !== "quit" && value !== "background")
      throw Error("关闭行为无效");
    store.setSetting("closeAction", value);
    changed();
  });
  handle("window:close-choice", (choice: unknown, remember: unknown) => {
    if (choice !== "quit" && choice !== "background" && choice !== "cancel")
      throw Error("关闭选择无效");
    boolean(remember);
    if (!closeChoiceOpen) return;
    if (choice === "background") ensureTray();
    if (remember && choice !== "cancel") {
      store.setSetting("closeAction", choice);
      changed();
    }
    closeChoiceOpen = false;
    if (choice === "quit") setImmediate(requestQuit);
    else if (choice === "background") moveToBackground();
  });
  handle("mobile:start", () => mobileImport.start());
  handle("mobile:status", () => mobileImport.state());
  handle("mobile:forget-device", (v: unknown) =>
    mobileImport.forgetDevice(string(v, 32)),
  );
  handle("mobile:pause", () => mobileImport.pause());
  handle("mobile:copy-address", (index: unknown) => {
    const state = mobileImport.state();
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      !state.urls[index] ||
      state.status !== "receiving"
    )
      throw Error("连接地址不可用，请重新开启");
    clipboard.writeText(state.urls[index]);
  });
  handle("mobile:remove", (value: unknown) => mobileImport.remove(id(value)));
  handle("mobile:confirm", () => mobileImport.confirm());
  handle("mobile:inspect-library", (v: unknown) =>
    libraryExchange.inspect(id(v)),
  );
  handle("mobile:apply-library", (v: unknown, policy: unknown) => {
    if (policy !== "keep" && policy !== "replace" && policy !== "copy")
      throw Error("冲突处理方式无效");
    libraryExchange.apply(id(v), policy);
  });
  handle("mobile:discard-library", (v: unknown) =>
    libraryExchange.discard(id(v)),
  );
  handle("mobile:send-library", async (v: unknown) => {
    if (!v || typeof v !== "object") throw Error("请选择题目或题集");
    const selection = v as {
      questionIds: unknown;
      collectionIds: unknown;
      changedOnly?: unknown;
    };
    if (
      selection.changedOnly !== undefined &&
      typeof selection.changedOnly !== "boolean"
    )
      throw Error("发送方式无效");
    const check = (list: unknown) => {
      if (!Array.isArray(list) || list.length > 20000)
        throw Error("选择数量无效");
      return list.map(id);
    };
    const questionIds = check(selection.questionIds),
      collectionIds = check(selection.collectionIds);
    if (!questionIds.length && !collectionIds.length)
      throw Error("请先选择题目或题集");
    const folder = path.join(root, "exchange-outgoing", randomUUID());
    fs.mkdirSync(folder, { recursive: true });
    const stamp = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Shanghai",
      dateStyle: "short",
      timeStyle: "medium",
    })
      .format(new Date())
      .replace(/[- :]/g, "");
    const file = path.join(folder, "题库资料-" + stamp + ".zip");
    try {
      const chosen = selection.changedOnly
        ? await mobileImport.delta({ questionIds, collectionIds })
        : { questionIds, collectionIds };
      if (!chosen.questionIds.length && !chosen.collectionIds.length)
        throw Error("所选资料与手机一致，无需发送");
      await libraryExchange.export(file, chosen);
      return await mobileImport.share(file, true);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
  handle("mobile:approve", (v: unknown) => mobileImport.approve(string(v, 64)));
  handle("mobile:reject", (v: unknown) => mobileImport.reject(string(v, 64)));
  handle("mobile:share", (v: unknown) => {
    const file = string(v, 32768);
    if (!exports.has(file)) throw Error("仅可发送本次生成的 PDF 或 Word 文档");
    return mobileImport.share(file);
  });
  handle("history:list", (limit: unknown, offset: unknown, query: unknown) => {
    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      typeof offset !== "number" ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    )
      throw Error("历史分页参数无效");
    return store.history(limit, offset, string(query, 200));
  });
  handle("history:record", (title: unknown, detail: unknown) => {
    const queryTitle = string(title, 160);
    if (!["筛选题库", "筛选题集添加面板"].includes(queryTitle)) return;
    store.addHistory({
      title: queryTitle,
      detail: string(detail, 200),
      category: "interaction",
      status: "done",
    });
    historyChanged();
  });
  handle("library:state", () => ({
    questions: store.questions().map(publicQuestion),
    collections: store.collections(),
    items: store.items(),
    customKnowledge: store.points(),
    jobs: store
      .jobs()
      .map(({ paths, labels, autoSolve, runId, fingerprint, ...j }) => ({
        ...j,
        ...(j.type === "import"
          ? store.importDetails(
              j.id,
              labels ?? paths?.map((file) => path.basename(file)) ?? [],
            )
          : {
              questionPreview:
                j.questionPreview ??
                store.question(j.questionId ?? "")?.body.slice(0, 600),
              questionSource:
                j.questionSource ??
                store.question(j.questionId ?? "")?.sourceLabel,
            }),
      })),
    settings: settings.read(),
  }));
  handle("question:manual-prompt", (open: unknown) => {
    boolean(open);
    manualPromptOpen = open as boolean;
  });
  handle("question:save", (input: unknown, confirm: unknown) => {
    const v = object(input);
    id(v.id);
    for (const k of [
      "title",
      "body",
      "latex",
      "grade",
      "kind",
      "difficulty",
      "knowledge",
    ])
      string(v[k]);
    validateFigures(v.figures);
    validateFigurePlacements(
      v.figurePlacements,
      (v.figures as string[] | undefined)?.length ??
        store.question(v.id as string)?.figures?.length ??
        0,
    );
    validateFigureWidths(
      v.figureWidths,
      (v.figures as string[] | undefined)?.length ??
        store.question(v.id as string)?.figures?.length ??
        0,
    );
    boolean(v.favorite);
    boolean(v.autoSolve);
    const old = store.question(v.id as string),
      q = store.saveQuestion(v as unknown as Question, boolean(confirm));
    const contentChanged = !!old && fingerprint(old) !== fingerprint(q);
    if ((old?.autoSolve && !q.autoSolve) || contentChanged)
      jobs.cancelQuestion(q.id);
    if (
      q.autoSolve &&
      (!old?.autoSolve || contentChanged) &&
      (q.body.trim() || q.latex.trim())
    )
      jobs.solve(q.id);
    changed();
    return publicQuestion(q);
  });
  handle("deletion:undo", (v: unknown) => {
    const result = store.undoDeletion(id(v));
    changed();
    return result;
  });
  handle("question:undo-review", (input: unknown) => {
    const expected = object(input);
    id(expected.id);
    const q = store.undoReview(expected as unknown as Question);
    jobs.cancelQuestion(q.id);
    changed();
    return publicQuestion(q);
  });
  handle("question:crop", async (questionId: unknown, input: unknown) => {
    id(questionId);
    const rect = object(input),
      q = store.question(questionId as string);
    if (!q?.sourcePath || !fs.existsSync(q.sourcePath))
      throw Error("此题没有可提取的来源原图");
    for (const key of ["x", "y", "width", "height"])
      if (
        typeof rect[key] !== "number" ||
        !Number.isFinite(rect[key]) ||
        (rect[key] as number) < 0 ||
        (rect[key] as number) > 1
      )
        throw Error("框选范围无效");
    const { x, y, width, height } = rect as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    if (
      width <= 0 ||
      height <= 0 ||
      x + width > 1.00001 ||
      y + height > 1.00001
    )
      throw Error("框选范围超出原图");
    let image = nativeImage.createFromPath(q.sourcePath);
    if (image.isEmpty() && /\.(heic|heif)$/i.test(q.sourcePath))
      image = nativeImage.createFromBuffer(
        Buffer.from(
          await work<string>("heic", { file: q.sourcePath }),
          "base64",
        ),
      );
    if (image.isEmpty()) throw Error("无法读取来源原图");
    const size = image.getSize();
    const bounds = {
      x: Math.floor(x * size.width),
      y: Math.floor(y * size.height),
      width: Math.floor(width * size.width),
      height: Math.floor(height * size.height),
    };
    if (bounds.width < 8 || bounds.height < 8)
      throw Error("请框选更大的图形区域");
    const cropped = image.crop(bounds),
      result = cropped.toDataURL();
    validateFigures([result]);
    return result;
  });
  handle("question:delete", (v: unknown) => {
    const key = id(v);
    jobs.cancelQuestion(key);
    const token = store.deleteQuestion(key);
    changed();
    return token;
  });
  handle("library:examples", () => {
    store.seed();
    changed();
  });
  handle("collection:save", (v: unknown) => {
    const c = object(v);
    id(c.id);
    string(c.title, 200);
    string(c.paperTitle, 80);
    string(c.examInstructions, 600);
    store.saveCollection(c as unknown as Collection);
    changed();
  });
  handle("collection:delete", (v: unknown) => {
    const token = store.deleteCollection(id(v));
    changed();
    return token;
  });
  handle("collection:add", (c: unknown, qs: unknown) => {
    const n = store.addQuestions(id(c), ids(qs));
    changed();
    return n;
  });
  handle("collection:reorder", (c: unknown, qs: unknown) => {
    store.reorder(id(c), ids(qs));
    changed();
  });
  handle("collection:add-undoable", (c: unknown, qs: unknown) => {
    const result = store.addQuestionsWithUndo(id(c), ids(qs));
    changed();
    return result;
  });
  handle("collection:undo-addition", (token: unknown) => {
    store.undoAddition(id(token));
    changed();
  });
  handle("collection:remove", (c: unknown, q: unknown) => {
    const token = store.removeQuestion(id(c), id(q));
    changed();
    return token;
  });
  handle("knowledge:add", (v: unknown) => {
    const p = object(v);
    string(p.group, 80);
    string(p.name, 32);
    store.addPoint(p as unknown as KnowledgePoint);
    changed();
  });
  handle("settings:color-theme", (value: unknown) => {
    if (!isColorTheme(value)) throw Error("主题色设置无效");
    store.setSetting("colorTheme", value);
    changed();
  });
  handle("settings:save", async (v: unknown) => {
    const s = object(v);
    string(s.address, 2048);
    string(s.model, 512);
    string(s.theme, 10);
    boolean(s.autoSolveImports);
    if (s.apiKey !== undefined) string(s.apiKey, 4096);
    if (s.clearApiKey !== undefined) boolean(s.clearApiKey);
    await settings.save(s as unknown as SettingsInput);
    applyTheme();
    changed();
  });
  handle("settings:test", async () => {
    const config = await settings.config(),
      controller = new AbortController();
    requestControllers.add(controller);
    const host = await new RenderHost().load();
    try {
      const image = "data:image/png;base64," + clipboardTestPng();
      const result = await complete(
        config,
        "请读取图片中写出的数字，简短回答。",
        await host.call("image", image),
        controller.signal,
      );
      return "图片接口测试成功：" + result.slice(0, 200);
    } finally {
      requestControllers.delete(controller);
      host.close();
    }
  });
  handle("intake:choose", async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "图片和 PDF",
          extensions: ["jpg", "jpeg", "png", "webp", "heic", "heif", "pdf"],
        },
      ],
    });
    if (r.canceled) return null;
    await jobs.intake(r.filePaths);
  });
  handle("intake:capture", async () => {
    const png = await screenCapture.capture();
    if (!png) return null;
    const folder = path.join(root, "screenshots");
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `截图-${Date.now()}.png`);
    try {
      fs.writeFileSync(file, png);
      await jobs.intake([file]);
      return true;
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
  handle("intake:drop", async (v: unknown) => {
    if (!Array.isArray(v) || !v.length || v.length > 20)
      throw Error("一次最多导入 20 个文件");
    const folder = path.join(root, "drops", randomUUID());
    try {
      let memorySize = 0;
      const paths = v.map((entry, index) => {
        if (typeof entry === "string") return string(entry, 32768);
        if (
          !entry ||
          typeof entry !== "object" ||
          !(entry.bytes instanceof Uint8Array)
        )
          throw Error("拖入文件无效，请重新拖入");
        const name = path.basename(string(entry.name, 256));
        if (!/\.(?:jpg|jpeg|png|webp|heic|heif|pdf|zip)$/i.test(name))
          throw Error("请选择支持的图片、PDF 或 Windows 题库 ZIP");
        const bytes = Buffer.from(entry.bytes);
        memorySize += bytes.length;
        if (
          !bytes.length ||
          bytes.length > 50 * 1024 * 1024 ||
          memorySize > 100 * 1024 * 1024
        )
          throw Error("拖入内容过大，请分批导入或先保存到本机");
        const target = path.join(folder, String(index), name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
        return target;
      });
      if (paths.some((file) => /\.zip$/i.test(file))) {
        if (paths.length !== 1) throw Error("题库 ZIP 请单独拖入");
        return await inspectBackupFile(paths[0]);
      }
      await jobs.intake(paths);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
  handle("intake:paste", async () => {
    const item = (await clipboard.read()).find((i) =>
      i.types.includes("image/png"),
    );
    if (!item) throw Error("剪贴板中没有图片，请先截图或复制图片");
    const png = Buffer.from(
      await (await item.getType("image/png")).arrayBuffer(),
    );
    if (png.length > 50 * 1024 * 1024) throw Error("图片超过 50 MB");
    const folder = path.join(root, "clipboard");
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, randomUUID() + ".png");
    try {
      fs.writeFileSync(file, png);
      await jobs.intake([file]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
  handle("job:resume", (v: unknown) => {
    jobs.resume(id(v));
  });
  handle("job:cancel", (v: unknown) => jobs.cancel(id(v)));
  handle("question:solve", (v: unknown) => jobs.solve(id(v)));
  handle("backup:inspect", async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "Matheca 题库", extensions: ["zip"] }],
    });
    if (r.canceled) return null;
    return inspectBackupFile(r.filePaths[0]);
  });
  handle("backup:restore", async (v: unknown) => {
    const token = id(v),
      p = previews.get(token);
    if (!p) throw Error("备份预览已过期，请重新选择");
    try {
      const result = await background<RestoreResult>("restore", {
        file: p.file,
        staging: path.join(p.folder, "validated"),
        batch: path.join(root, "restored", randomUUID()),
        database: store.file,
      });
      changed();
      return result;
    } finally {
      await cleanupPreview(token);
    }
  });
  handle("backup:dismiss", (v: unknown) => cleanupPreview(id(v)));
  handle("backup:export", async () => {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: `Matheca-题库-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: "题库备份", extensions: ["zip"] }],
    });
    if (r.canceled || !r.filePath) return null;
    const missingImages = await background<number>("export", {
      database: store.file,
      target: r.filePath,
    });
    return { path: r.filePath, missingImages };
  });
  handle("collection:preview", async (c: unknown) => {
    const collection = store.collection(id(c));
    if (!collection) throw Error("题集不存在");
    const questions = store
      .items()
      .filter((item) => item.collectionId === collection.id)
      .sort((a, b) => a.position - b.position)
      .map((item) => store.question(item.questionId)!)
      .filter(Boolean);
    return previewDocument(questions, collection);
  });
  handle("collection:export", async (c: unknown, f: unknown) => {
    const collection = store.collection(id(c));
    if (!collection) throw Error("题集不存在");
    if (f !== "pdf" && f !== "docx") throw Error("导出格式无效");
    const qids = store
        .items()
        .filter((i) => i.collectionId === collection.id)
        .map((i) => i.questionId),
      questions = qids.map((i) => store.question(i)!).filter(Boolean);
    const pending = questions.filter((q) => !q.reviewed).length;
    if (pending) {
      const r = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["继续导出", "返回校对"],
        defaultId: 1,
        cancelId: 1,
        message: `题集中有 ${pending} 道待校对题目`,
        detail: "识别和 AI 结果需要核对。继续导出当前保存内容？",
      });
      if (r.response !== 0) return null;
    }
    const name =
      collection.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").slice(0, 50) ||
      "数学题集";
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${name}.${f}`,
      filters: [{ name: f.toUpperCase(), extensions: [f] }],
    });
    if (result.canceled || !result.filePath) return null;
    const temp = result.filePath + "." + randomUUID() + ".partial";
    try {
      await exportDocument(questions, collection, f, temp);
      publishFile(temp, result.filePath);
    } catch (e) {
      fs.rmSync(temp, { force: true });
      throw e;
    }
    exports.add(result.filePath);
    return { path: result.filePath, format: f };
  });
  handle("export:open", async (v: unknown) => {
    const file = string(v, 32768);
    if (!exports.has(file)) throw Error("仅可打开本次生成的文档");
    const error = await shell.openPath(file);
    if (error) throw Error("无法打开文档，请检查是否已安装对应软件");
  });
  handle("guide:open", async (value: unknown) => {
    if (typeof value !== "string" || !Object.hasOwn(guideLinks, value))
      throw Error("教学链接无效");
    await shell.openExternal(guideLinks[value as GuideLink]);
  });
  handle("guide:copy", (value: unknown) => {
    if (typeof value !== "string" || !Object.hasOwn(guideValues, value))
      throw Error("教学配置项无效");
    clipboard.writeText(guideValues[value as GuideValue]);
  });
}
function clipboardTestPng() {
  // An actual digit image, generated locally for vision testing.
  return fs
    .readFileSync(path.join(__dirname, "../../assets/vision-test.png"))
    .toString("base64");
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      root = app.getPath("userData");
      fs.mkdirSync(root, { recursive: true });
      store = new Store(path.join(root, "library.sqlite"));
      store.cleanupEmptyManualQuestions();
      settings = new SettingsService(store);
      applyTheme();
      for (const folder of ["staging", "restored"]) {
        const dir = path.join(root, folder);
        fs.mkdirSync(dir, { recursive: true });
        const committed = new Set(
          (
            store.db.prepare("SELECT path FROM batches").all() as {
              path: string;
            }[]
          ).map((x) => path.resolve(x.path)),
        );
        for (const name of fs.readdirSync(dir)) {
          const child = path.resolve(dir, name);
          if (
            child.startsWith(path.resolve(dir) + path.sep) &&
            (folder === "staging" || !committed.has(child))
          )
            fs.rmSync(child, { recursive: true, force: true });
        }
      }
      jobs = new Jobs(store, settings, root, changed);
      libraryExchange = new LibraryExchange(
        path.join(root, "library-exchange"),
        store,
        changed,
      );
      mobileImport = new MobileImport(
        path.join(root, "mobile-inbox"),
        (files) => jobs.intake(files),
        (name) => store.jobs().some((job) => job.labels?.includes(name)),
        undefined,
        undefined,
        () => store.jobs(),
        libraryExchange,
      );
      protocol.handle("matheca-asset", async (request) => {
        try {
          const url = new URL(request.url);
          const parts = url.pathname.slice(1).split("/");
          const source =
            url.hostname === "question"
              ? store.question(decodeURIComponent(url.pathname.slice(1)))
                  ?.sourcePath
              : url.hostname === "mobile"
                ? mobileImport.image(parts[0], parts[1])
                : undefined;
          if (
            !source ||
            !path.resolve(source).startsWith(path.resolve(root) + path.sep) ||
            !fs.existsSync(source)
          )
            return new Response("", { status: 404 });
          if (/\.(heic|heif)$/i.test(source)) {
            const dir = path.join(root, "previews");
            fs.mkdirSync(dir, { recursive: true });
            const target = path.join(
              dir,
              createHash("sha256").update(source).digest("hex") + ".png",
            );
            if (!fs.existsSync(target))
              fs.writeFileSync(
                target,
                Buffer.from(
                  await background<string>("heic", { file: source }),
                  "base64",
                ),
              );
            return net.fetch(pathToFileURL(target).toString());
          }
          return net.fetch(pathToFileURL(source).toString());
        } catch {
          return new Response("", { status: 404 });
        }
      });
      Menu.setApplicationMenu(null);
      win = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 1024,
        minHeight: 700,
        title: "Matheca",
        icon: path.join(__dirname, "../../assets/icon.ico"),
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#f4f6fa",
          symbolColor: "#26334b",
          height: 36,
        },
        backgroundColor: "#f4f6fa",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      win.setMenu(null);
      screenCapture = new ScreenCapture(win);
      nativeTheme.on("updated", updateTitleBar);
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.webContents.on("render-process-gone", () => {
        manualPromptOpen = false;
        closePending = false;
        closeChoiceOpen = false;
      });
      win.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      register();
      ipcMain.on("window:close-choice-shown", (event) => {
        if (trusted(event) && closeChoiceOpen) closeChoiceReady = true;
      });
      ipcMain.on("window:close-ready", (event, ok) => {
        if (!trusted(event) || !closePending) return;
        closePending = false;
        if (ok === true) void finishQuit();
        else if (ok !== "cancelled")
          dialog.showMessageBox(win, {
            type: "error",
            message: "草稿保存失败，请检查后再退出",
          });
      });
      win.on("close", (event) => {
        if (quitReady) return;
        event.preventDefault();
        if (!quitting) void chooseCloseAction();
      });
      if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
        await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
      else
        await win.loadFile(
          path.join(
            __dirname,
            `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
          ),
        );
    })
    .catch((e) => {
      dialog.showErrorBox(
        "Matheca 启动失败",
        e instanceof Error ? e.message : "无法打开本机题库",
      );
      app.quit();
    });
  app.on("before-quit", (e) => {
    if (store && !quitReady) {
      e.preventDefault();
      requestQuit();
    }
  });
}
