import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
export function generateNotices(root: string) {
  const seen = new Set<string>(),
    notices: string[] = [];
  function visit(folder: string) {
    if (seen.has(folder)) return;
    seen.add(folder);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(folder, "package.json"), "utf8"),
    );
    notices.push(
      `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}\n`,
    );
    const legalFiles = fs
      .readdirSync(folder)
      .filter(
        (n) =>
          /^(LICENSE|LICENCE|COPYING|NOTICE)(\.|$|-)/i.test(n) &&
          fs.statSync(path.join(folder, n)).isFile(),
      );
    for (const n of legalFiles)
      notices.push(`${n}\n${fs.readFileSync(path.join(folder, n), "utf8")}\n`);
    if (pkg.name === "pdfjs-dist")
      for (const sub of ["cmaps", "standard_fonts", "wasm"])
        for (const n of fs.readdirSync(path.join(folder, sub)))
          if (/^(LICENSE|NOTICE)/i.test(n))
            notices.push(
              `${sub}/${n}\n${fs.readFileSync(path.join(folder, sub, n), "utf8")}\n`,
            );
    const req = createRequire(path.join(folder, "package.json"));
    for (const dep of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
    })) {
      const dependency = (req.resolve.paths(dep) || [])
        .map((n) => path.join(n, dep))
        .find((p) => fs.existsSync(path.join(p, "package.json")));
      if (dependency) visit(dependency);
    }
  }
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  for (const dep of Object.keys(pkg.dependencies))
    visit(path.join(root, "node_modules", dep));
  notices.push(
    "Ant Design outlined navigation icons\n" +
      fs.readFileSync(path.join(root, "assets/ant-design/SOURCE.txt"), "utf8") +
      "\n" +
      fs.readFileSync(path.join(root, "assets/ant-design/LICENSE.txt"), "utf8"),
  );
  notices.push(
    "React Bits BranchedMenu\n" +
      fs.readFileSync(path.join(root, "assets/react-bits/SOURCE.txt"), "utf8") +
      "\n" +
      fs.readFileSync(path.join(root, "assets/react-bits/LICENSE.txt"), "utf8"),
  );
  fs.writeFileSync(
    path.join(root, "THIRD_PARTY_NOTICES.txt"),
    "Matheca Windows third-party notices\nKaTeX and its fonts, PDF.js, SQLite and other runtime dependencies are bundled locally.\nElectron and Chromium notices also accompany the executable as LICENSE and LICENSES.chromium.html.\n" +
      notices.join("\n"),
  );
}
