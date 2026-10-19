import { parentPort, workerData } from "node:worker_threads";
import fs from "node:fs";
import convert from "heic-convert";
import { Store } from "./store";
import { inspectArchive, exportArchive, restoreArchive } from "./archive";
import { fileOperationMessage } from "./file-operations";
(async () => {
  const { operation, args } = workerData;
  let store: Store | undefined;
  try {
    let result: unknown;
    if (operation === "heic")
      result = Buffer.from(
        await convert({ buffer: fs.readFileSync(args.file), format: "PNG" }),
      ).toString("base64");
    else if (operation === "inspect")
      result = await inspectArchive(args.file, args.staging);
    else {
      store = new Store(args.database);
      if (operation === "export")
        result = await exportArchive(store, args.target);
      else if (operation === "restore") {
        const data = await inspectArchive(args.file, args.staging);
        result = restoreArchive(store, data, args.staging, args.batch);
      } else throw Error("未知处理任务");
    }
    parentPort?.postMessage({ ok: true, data: result });
  } catch (e) {
    parentPort?.postMessage({
      ok: false,
      error: fileOperationMessage(e),
    });
  } finally {
    store?.close();
  }
})();
