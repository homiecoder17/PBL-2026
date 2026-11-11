import session from "express-session";
export class MySQLSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.cleanup = setInterval(
      () =>
        this.db
          .query("DELETE FROM app_sessions WHERE expires_at <= ?", [Date.now()])
          .catch(() => {}),
      60 * 60 * 1000,
    );
    this.cleanup.unref();
  }
  get(sid, callback) {
    this.db
      .query(
        "SELECT data FROM app_sessions WHERE session_id=? AND expires_at>?",
        [sid, Date.now()],
      )
      .then((rows) =>
        callback(null, rows.length ? JSON.parse(rows[0].data) : null),
      )
      .catch(callback);
  }
  set(sid, value, callback = () => {}) {
    const expires = value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + 7200000;
    this.db
      .query(
        "INSERT INTO app_sessions (session_id,data,expires_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data=?,expires_at=?",
        [sid, JSON.stringify(value), expires, JSON.stringify(value), expires],
      )
      .then(() => callback())
      .catch(callback);
  }
  destroy(sid, callback = () => {}) {
    this.db
      .query("DELETE FROM app_sessions WHERE session_id=?", [sid])
      .then(() => callback())
      .catch(callback);
  }
  touch(sid, value, callback = () => {}) {
    const expires = value.cookie.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + 7200000;
    this.db
      .query("UPDATE app_sessions SET expires_at=? WHERE session_id=?", [
        expires,
        sid,
      ])
      .then(() => callback())
      .catch(callback);
  }
  close() {
    clearInterval(this.cleanup);
  }
}
