import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// Adapter for shared React UI checks. Window resizing here is explicitly a CDP
// viewport check. Business operations always invoke the real packaged Rust app.
export const appTest = {
  async launch({ executablePath, env }) {
    if (
      !env?.MATHECA_TEST_DATA ||
      !path
        .resolve(env.MATHECA_TEST_DATA)
        .startsWith(path.resolve("test-output") + path.sep)
    )
      throw Error("Isolated test-output data required");
    const exe =
      executablePath ||
      fs
        .readFileSync("releases/latest-tauri.txt", "utf8")
        .match(/^EXE: (.+)$/m)[1]
        .trim();
    const output = path.join(env.MATHECA_TEST_DATA, "ui-evidence");
    fs.mkdirSync(output, { recursive: true });
    const server = net.createServer();
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    await new Promise((r) => server.close(r));
    if (!fs.existsSync(exe)) throw Error(`Packaged Tauri EXE missing: ${exe}`);
    const child = spawn(exe, [], {
      env: {
        ...env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "",
      spawnError;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (b) => (log += b));
    child.stderr.on("data", (b) => (log += b));
    let browser, page;
    try {
      const deadline = Date.now() + 30000;
      for (;;) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null)
          throw Error(`App exit ${child.exitCode}: ${log}`);
        try {
          if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
        } catch {}
        if (Date.now() > deadline) throw Error("WebView2 launch timeout");
        await new Promise((r) => setTimeout(r, 150));
      }
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      page =
        browser.contexts()[0].pages()[0] ||
        (await browser.contexts()[0].waitForEvent("page"));
      page.setDefaultTimeout(12000);
      await page.waitForFunction(() => !!window.matheca);
      await page.locator("h1").waitFor();
      const originalScreenshot = page.screenshot.bind(page);
      page.screenshot = (options) =>
        originalScreenshot({
          ...options,
          path: options?.path
            ? path.join(output, path.basename(options.path))
            : undefined,
        });
      const pending = [];
      const win = {
        isVisible: () => true,
        setSize: (width, height) => {
          const p = page.setViewportSize({ width, height });
          pending.push(p);
          return p;
        },
        close: () => {
          const p = page.evaluate(() =>
            window.__TAURI__.window.getCurrentWindow().close(),
          );
          pending.push(p);
          return p;
        },
      };
      const evaluate = async (fn, arg) => {
        const result = await fn(
          { BrowserWindow: { getAllWindows: () => [win] } },
          arg,
        );
        await Promise.all(pending.splice(0));
        return result;
      };
      console.log(`Packaged Tauri: ${exe}\nIsolated UI evidence: ${output}`);
      return {
        firstWindow: async () => page,
        evaluate,
        browserWindow: async () => ({
          evaluate: async (fn, arg) => {
            const r = await fn(win, arg);
            await Promise.all(pending.splice(0));
            return r;
          },
        }),
        async close() {
          try {
            await page.evaluate(() => window.matheca.setCloseAction("quit"));
            const ended = new Promise((resolve, reject) => {
              if (child.exitCode !== null) return resolve();
              const timer = setTimeout(
                () => reject(Error("Clean close timed out")),
                10000,
              );
              child.once("exit", (code) => {
                clearTimeout(timer);
                code === 0 ? resolve() : reject(Error(`App exit ${code}`));
              });
            });
            await page.evaluate(() =>
              window.__TAURI__.window.getCurrentWindow().close(),
            );
            await ended;
          } finally {
            if (child.exitCode === null) child.kill();
            await browser.close().catch(() => {});
            fs.writeFileSync(path.join(output, "native.log"), log);
          }
        },
      };
    } catch (error) {
      if (child.exitCode === null) child.kill();
      await browser?.close().catch(() => {});
      throw error;
    }
  },
};
