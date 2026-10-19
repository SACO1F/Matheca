import { Worker } from "node:worker_threads";
import path from "node:path";
export function work<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "worker.cjs"), {
      workerData: { operation, args },
    });
    let settled = false;
    worker.once("message", (reply: { ok: boolean; data: T; error: string }) => {
      settled = true;
      reply.ok ? resolve(reply.data) : reject(Error(reply.error));
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (!settled) reject(Error(`文件处理任务中断 (${code})`));
    });
  });
}
