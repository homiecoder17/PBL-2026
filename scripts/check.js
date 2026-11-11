import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ejs from "ejs";
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(p)));
    else result.push(p);
  }
  return result;
}
let js = 0,
  views = 0;
for (const dir of ["backend/src", "backend/tests", "frontend/public", "frontend/views", "scripts"]) {
  for (const file of await files(dir)) {
    if (file.endsWith(".js")) {
      const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
      });
      if (result.status !== 0) throw new Error(result.stderr);
      js++;
    } else if (file.endsWith(".ejs")) {
      ejs.compile(await readFile(file, "utf8"), { filename: file });
      views++;
    }
  }
}
console.log(
  `Syntax checks passed: ${js} project JavaScript files and ${views} EJS templates.`,
);
console.log(
  "JavaScript is interpreted; syntax checks and executed tests replace a separate compilation step.",
);
