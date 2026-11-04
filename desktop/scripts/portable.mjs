const args = process.argv.slice(2);
if (args.length === 0 || (args.length === 1 && args[0] === "--tauri"))
  await import("./portable-tauri.mjs");
else if (args.length === 1 && args[0] === "--electron")
  await import("./portable-electron.mjs");
else throw Error("用法：npm run make:portable [-- --tauri|--electron]");
