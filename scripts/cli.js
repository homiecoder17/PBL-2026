import { hiddenPassword } from "../src/terminal.js";
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { createDatabase } from "../src/db.js";
import { createServices } from "../src/services.js";
import { createUser, seedDemo, seedEvents, demoSql } from "../src/accounts.js";
async function confirmed(label) {
  const value = await hiddenPassword(label),
    again = await hiddenPassword("Confirm " + label);
  if (value !== again) throw new Error("Passwords do not match.");
  return value;
}
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    email: { type: "string" },
    role: { type: "string", default: "student" },
    "student-id": { type: "string" },
  },
});
let db;
try {
  const config = loadConfig();
  db = createDatabase(config);
  const services = createServices(db, config);
  switch (positionals[0]) {
    case "check-db":
      if ((await db.query("SELECT 1 AS result"))[0].result !== 1)
        throw new Error("Unexpected database response.");
      console.log("MySQL verified: SELECT 1 returned 1.");
      break;
    case "seed-demo":
      await seedDemo(db, {
        adminPassword: await confirmed(
          "Choose administrator password (12+ characters)",
        ),
        studentPassword: await confirmed(
          "Choose student password (12+ characters)",
        ),
      });
      console.log(
        "Created admin@campus.test and student@campus.test (ID CSE2026001).",
      );
      break;
    case "create-user":
      await createUser(db, {
        name: values.name,
        email: values.email,
        role: values.role,
        studentId: values["student-id"] || null,
        password: await confirmed("Choose account password (12+ characters)"),
      });
      console.log("Account created with a salted scrypt password hash.");
      break;
    case "seed-events":
      await seedEvents(db, services, config);
      console.log("Created 3 future-dated sample events.");
      break;
    case "demo-sql":
      console.log((await demoSql(db)).join("\n"));
      break;
    default:
      throw new Error(
        "Use: check-db | seed-demo | seed-events | demo-sql | create-user --name NAME --email EMAIL --role student --student-id ID",
      );
  }
} catch (error) {
  console.error(
    error.code ? "Database command failed: " + error.code : error.message,
  );
  process.exitCode = 1;
} finally {
  if (db) await db.close();
}
