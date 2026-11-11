import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
export async function hiddenPassword(label) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Run account initialization in an interactive terminal; password input must not be piped or placed in command arguments.",
    );
  const muted = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
  });
  process.stdout.write(label + ": ");
  try {
    return await rl.question("");
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}
