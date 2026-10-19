import fs from "node:fs";

// Flush the completed temporary file before replacing the user's destination.
// Both paths are on the same volume, so rename remains the publication point.
export function publishFile(partial: string, target: string) {
  const descriptor = fs.openSync(partial, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(partial, target);
}

export function fileOperationMessage(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "ENOSPC" || code === "SQLITE_FULL")
    return "磁盘空间不足，操作未完成。请释放空间后重试。";
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES")
    return "文件被占用或没有写入权限。请关闭占用该文件的程序，或选择其他保存位置后重试。";
  return error instanceof Error ? error.message : "文件处理失败，请重试";
}
