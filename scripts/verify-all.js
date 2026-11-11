import { spawnSync } from "node:child_process";
if (process.env.RUN_DB_TESTS !== "1")
  throw new Error(
    "Full verification requires RUN_DB_TESTS=1 and separate disposable MySQL test credentials. Read README.md first.",
  );
for (const args of [
  ["scripts/check.js"],
  [
    "--test",
    "--test-concurrency=1",
    "backend/tests/integration.test.js",
    "backend/tests/app-integration.test.js",
    "backend/tests/passwords.test.js",
    "backend/tests/scheduler.test.js",
  ],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(
  "Full syntax, EJS, unit, and real-MySQL integration verification passed. Run test:browser separately with a local demo server.",
);
