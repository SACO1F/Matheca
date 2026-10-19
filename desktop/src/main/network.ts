import https from "node:https";
import { completion } from "../domain/vision";
export function httpError(code: number) {
  if ([401, 403].includes(code))
    return `接口认证失败，请检查 API Key 和模型权限（HTTP ${code}）`;
  if (code === 429) return "服务额度不足或请求频繁，请稍后重试（HTTP 429）";
  if (code >= 300 && code < 400)
    return `接口发生重定向，请填写最终 HTTPS 地址（HTTP ${code}）`;
  if (code >= 500) return `服务暂时不可用（HTTP ${code}）`;
  return `接口请求失败，请检查地址、模型和服务兼容性（HTTP ${code}）`;
}
export function complete(
  config: { endpoint: string; model: string; key: string },
  prompt: string,
  image: string | string[] | undefined,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(
      JSON.stringify({
        model: config.model,
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              ...(image
                ? (Array.isArray(image) ? image : [image]).map((url) => ({
                    type: "image_url",
                    image_url: { url },
                  }))
                : []),
            ],
          },
        ],
      }),
    );
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const finish = (error?: Error, text?: string) => {
      if (settled) return;
      settled = true;
      timers.forEach(clearTimeout);
      signal.removeEventListener("abort", abort);
      if (error) {
        req.destroy();
        reject(error);
      } else {
        try {
          resolve(completion(text!));
        } catch (e) {
          reject(e);
        }
      }
    };
    const abort = () => finish(Error("任务已停止，可稍后继续"));
    const req = https.request(
      config.endpoint,
      {
        method: "POST",
        agent: false,
        headers: {
          Authorization: "Bearer " + config.key,
          "Content-Type": "application/json; charset=utf-8",
          "Content-Length": payload.length,
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          res.resume();
          return finish(Error(httpError(res.statusCode ?? 0)));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.setTimeout(120000, () => finish(Error("读取接口响应超时，请重试")));
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4 * 1024 * 1024)
            finish(Error("接口响应超过 4 MB，请裁剪图片后重试"));
          else chunks.push(chunk);
        });
        res.on("end", () =>
          finish(undefined, Buffer.concat(chunks).toString("utf8")),
        );
        res.on("error", () => finish(Error("读取接口响应失败，请重试")));
      },
    );
    const connectTimer = setTimeout(
      () => finish(Error("连接服务超时，请检查网络")),
      20000,
    );
    timers.push(
      connectTimer,
      setTimeout(() => finish(Error("接口请求超时，请重试")), 150000),
    );
    req.on("socket", (socket) => {
      socket.once("secureConnect", () => {
        clearTimeout(connectTimer);
        const writeTimer = setTimeout(
          () => finish(Error("上传超时，请重试")),
          45000,
        );
        timers.push(writeTimer);
        req.once("finish", () => clearTimeout(writeTimer));
      });
    });
    req.on("error", () =>
      finish(Error("无法连接服务，请检查网络、地址或服务是否超时")),
    );
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    req.end(payload);
  });
}
