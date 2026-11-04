import { appTest } from "./tauri-ui-session.mjs";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const root = path.resolve("test-output", "mobile-lan-" + Date.now());
const app = await appTest.launch({
  env: { ...process.env, MATHECA_TEST_DATA: root },
});
try {
  const p = await app.firstWindow();
  const s = await p.evaluate(() => window.matheca.mobileStart());
  const hosts = s.urls.map((url) => new URL(url).host);
  const expected = process.env.MATHECA_QA_LAN_IP;
  if (expected)
    assert.equal(
      new URL(s.urls[0]).hostname,
      expected,
      "Default QR must prefer the actual network route",
    );
  const url = new URL(s.urls[0]);
  const status = await new Promise((resolve, reject) => {
    const req = http.get(url.origin, (r) => {
      r.resume();
      r.once("end", () => resolve(r.statusCode));
    });
    req.setTimeout(5000, () => req.destroy(Error("LAN HTTP timeout")));
    req.on("error", reject);
  });
  assert.equal(status, 200);
  await p.getByRole("button", { name: "新建题目", exact: true }).click();
  await p.getByRole("menuitem", { name: "手机联动", exact: true }).click();
  await p.getByRole("dialog", { name: "手机联动", exact: true }).waitFor();
  await p.screenshot({ path: "mobile-default-address.png" });
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.matheca.mobilePause());
  fs.writeFileSync(
    path.join(root, "REPORT.md"),
    `PASS: default advertised host ${hosts[0]}; HTTP ${status} on advertised LAN interface; QR UI opens. Other available hosts: ${hosts.slice(1).join(", ")}. This is a host-local LAN-address check, not a physical-phone test.\n`,
  );
  console.log("PASS LAN address selection and HTTP. Evidence: " + root);
} finally {
  await app.close();
}
