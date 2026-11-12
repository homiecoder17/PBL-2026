import { randomBytes, timingSafeEqual } from "node:crypto";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function ensureCsrf(req) {
  if (!req.session.csrf) req.session.csrf = randomBytes(32).toString("hex");
  return req.session.csrf;
}
export function verifyCsrf(req, _res, next) {
  if (req.method !== "POST") return next();
  const actual = req.body?.csrf_token;
  const expected = req.session.csrf;
  if (
    typeof actual !== "string" ||
    typeof expected !== "string" ||
    !/^[a-f0-9]{64}$/.test(actual) ||
    expected.length !== 64 ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
  )
    return next(
      new HttpError(
        400,
        "Invalid or expired form token. Reload the page and try again.",
      ),
    );
  next();
}
export function loginRequired(req, res, next) {
  if (!req.user) {
    req.session.messages.push({
      type: "warning",
      text: "Please log in to continue.",
    });
    return res.redirect("/login");
  }
  next();
}
export function roleRequired(...roles) {
  const allowed = new Set(roles);
  return [
    loginRequired,
    (req, _res, next) =>
      allowed.has(req.user.role)
        ? next()
        : next(
            new HttpError(
              403,
              "This page is restricted to the appropriate role.",
            ),
          ),
  ];
}
export function flash(req, type, text) {
  req.session.messages ||= [];
  req.session.messages.push({ type, text });
}
export function regenerate(req) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
}
export function destroySession(req) {
  return new Promise((resolve, reject) =>
    req.session.destroy((e) => (e ? reject(e) : resolve())),
  );
}
