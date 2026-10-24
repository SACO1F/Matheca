import { Worker } from "node:worker_threads";
import path from "node:path";
import { readAppVersionTag } from "../domain/backup";
export function work<T>(
  operation: string,
  args: Record<string, unknown>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "worker.cjs"), {
      // The worker has its own module state, so the version set by the main
      // process has to travel with the job or exports would stamp "desktop".
      workerData: {
        operation,
        args: { ...args, appVersion: readAppVersionTag() },
      },
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
