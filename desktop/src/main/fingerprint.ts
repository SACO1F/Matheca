import { createHash } from "node:crypto";
import type { Question } from "../shared/types";
export function kotlinUtf8(value: string): Buffer {
  let text = "";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = value.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        text += value[i] + value[++i];
      } else text += "?";
    } else if (c >= 0xdc00 && c <= 0xdfff) text += "?";
    else text += value[i];
  }
  return Buffer.from(text, "utf8");
}
export function fingerprint(q: Question) {
  const options =
    q.kind === "选择题" && q.figurePlacements?.some((p) => p !== "stem")
      ? "\0" + JSON.stringify([q.figurePlacements, q.figures])
      : "";
  return createHash("sha256")
    .update(
      kotlinUtf8([q.title, q.body, q.latex, q.sourcePath].join("\0") + options),
    )
    .digest("hex");
}
