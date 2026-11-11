import { createApp } from "./app.js";
const app = await createApp();
const port = Number(process.env.PORT || 3000),
  host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT.");
const server = app.listen(port, host, () =>
  console.log(`CampusFlow running at http://${host}:${port}`),
);
async function shutdown() {
  server.close(async () => {
    await app.locals.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
