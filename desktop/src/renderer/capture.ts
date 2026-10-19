import "./capture.css";
import type { CaptureRect } from "../main/screen-capture";
declare global {
  interface Window {
    screenCapture: {
      ready(): Promise<string>;
      confirm(rect: CaptureRect): Promise<void>;
      cancel(): void;
    };
  }
}
const image = document.querySelector<HTMLImageElement>("#screen")!;
const selection = document.querySelector<HTMLElement>("#selection")!;
const dimensions = document.querySelector<HTMLElement>("#dimensions")!;
const actions = document.querySelector<HTMLElement>("#capture-actions")!;
const shade = document.querySelector<HTMLElement>("#shade")!;
const help = document.querySelector<HTMLElement>("#capture-help")!;
let origin: { x: number; y: number } | undefined;
let rect: CaptureRect | undefined;
let busy = false;
let loaded = false;
function reset() {
  origin = undefined;
  rect = undefined;
  selection.hidden = true;
  actions.hidden = true;
  shade.hidden = false;
}
async function confirm() {
  if (!rect || rect.width < 8 || rect.height < 8 || busy) return;
  busy = true;
  try {
    await window.screenCapture.confirm(rect);
  } catch (error) {
    help.textContent =
      error instanceof Error ? error.message : "截图失败，请重新框选";
    busy = false;
  }
}
function paint(x: number, y: number) {
  if (!origin) return;
  x = Math.max(0, Math.min(innerWidth, x));
  y = Math.max(0, Math.min(innerHeight, y));
  rect = {
    x: Math.min(origin.x, x),
    y: Math.min(origin.y, y),
    width: Math.abs(x - origin.x),
    height: Math.abs(y - origin.y),
    viewportWidth: innerWidth,
    viewportHeight: innerHeight,
  };
  selection.hidden = false;
  shade.hidden = true;
  Object.assign(selection.style, {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  dimensions.textContent = `${Math.round((rect.width * image.naturalWidth) / innerWidth)} × ${Math.round((rect.height * image.naturalHeight) / innerHeight)}`;
}
document.addEventListener("pointerdown", (event) => {
  if (
    !loaded ||
    busy ||
    event.button !== 0 ||
    (event.target as Element).closest("button")
  )
    return;
  reset();
  origin = { x: event.clientX, y: event.clientY };
  paint(event.clientX, event.clientY);
  document.body.setPointerCapture(event.pointerId);
});
document.addEventListener("pointermove", (event) =>
  paint(event.clientX, event.clientY),
);
document.addEventListener("pointerup", (event) => {
  if (!origin) return;
  paint(event.clientX, event.clientY);
  origin = undefined;
  if (!rect || rect.width < 8 || rect.height < 8) {
    reset();
    return;
  }
  actions.hidden = false;
  actions.style.left = `${Math.max(12, Math.min(innerWidth - actions.offsetWidth - 12, rect.x + rect.width - actions.offsetWidth))}px`;
  actions.style.top = `${Math.max(12, Math.min(innerHeight - actions.offsetHeight - 12, rect.y + rect.height + 12))}px`;
  document.querySelector<HTMLButtonElement>("#confirm")!.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    window.screenCapture.cancel();
  }
  if (event.key === "Enter" && !(event.target as Element).closest("button")) {
    event.preventDefault();
    void confirm();
  }
});
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  reset();
});
document.querySelector("#reset")!.addEventListener("click", reset);
document
  .querySelector("#cancel")!
  .addEventListener("click", () => window.screenCapture.cancel());
document
  .querySelector("#confirm")!
  .addEventListener("click", () => void confirm());
try {
  image.src = await window.screenCapture.ready();
  await image.decode();
  loaded = true;
} catch {
  help.textContent = "屏幕图像加载失败，请按 Esc 返回应用";
}
