import "dotenv/config";
export function loadConfig(overrides = {}) {
  const config = {
    secret: process.env.SESSION_SECRET || "",
    host: process.env.MYSQL_HOST || process.env.MYSQLHOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.MYSQL_USER || process.env.MYSQLUSER || "ues_app",
    password: process.env.MYSQL_PASSWORD || process.env.MYSQLPASSWORD || "",
    database:
      process.env.MYSQL_DATABASE ||
      process.env.MYSQLDATABASE ||
      "university_event_system",
    campusTimezone: process.env.CAMPUS_TIMEZONE || "Asia/Kolkata",
    sqlitePath: process.env.SQLITE_PATH || "",
    secureCookie: process.env.SESSION_COOKIE_SECURE === "true",
    trustProxy: process.env.TRUST_PROXY === "1",
    ...overrides,
  };
  if (config.secret.length < 32)
    throw new Error(
      "Set SESSION_SECRET to a random value of at least 32 characters.",
    );
  if (!config.password && !config.sqlitePath && !config.forceFallback)
    throw new Error(
      "Set MYSQL_PASSWORD; blank database passwords are refused.",
    );
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
    throw new Error("Invalid MySQL port.");
  new Intl.DateTimeFormat("en", { timeZone: config.campusTimezone }).format();
  return config;
}
