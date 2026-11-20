// The Charged Proxy — accounts + direct messages
//
// Storage: one SQLite file (data/charged.db, or $DATA_DIR/charged.db).
// Live delivery: a WebSocket at /chat that pushes new messages to every
// open tab of the sender and the recipient.

import { DatabaseSync } from "node:sqlite";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { WebSocketServer } from "ws";

const scryptAsync = promisify(scrypt);

const COOKIE = "charged_sid";
const SESSION_DAYS = 30;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MAX_BODY = 1000;

export function createChat({ dataDir }) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "charged.db"));

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass     TEXT NOT NULL,
      created  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token   TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id        INTEGER PRIMARY KEY,
      sender    INTEGER NOT NULL,
      recipient INTEGER NOT NULL,
      body      TEXT NOT NULL,
      created   INTEGER NOT NULL,
      read      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS msg_pair   ON messages(sender, recipient, id);
    CREATE INDEX IF NOT EXISTS msg_unread ON messages(recipient, read);
    CREATE TABLE IF NOT EXISTS blocks (
      blocker INTEGER NOT NULL,
      blocked INTEGER NOT NULL,
      PRIMARY KEY (blocker, blocked)
    );
  `);

  const q = {
    userByName:   db.prepare("SELECT id, username, pass FROM users WHERE username = ?"),
    userById:     db.prepare("SELECT id, username FROM users WHERE id = ?"),
    addUser:      db.prepare("INSERT INTO users (username, pass, created) VALUES (?, ?, ?)"),
    addSession:   db.prepare("INSERT INTO sessions (token, user_id, created) VALUES (?, ?, ?)"),
    session:      db.prepare("SELECT user_id, created FROM sessions WHERE token = ?"),
    dropSession:  db.prepare("DELETE FROM sessions WHERE token = ?"),
    oldSessions:  db.prepare("DELETE FROM sessions WHERE created < ?"),
    addMessage:   db.prepare("INSERT INTO messages (sender, recipient, body, created) VALUES (?, ?, ?, ?)"),
    thread:       db.prepare(`
      SELECT id, sender, recipient, body, created FROM messages
      WHERE ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)) AND id < ?
      ORDER BY id DESC LIMIT 50`),
    markRead:     db.prepare("UPDATE messages SET read = 1 WHERE sender = ? AND recipient = ? AND read = 0"),
    unreadTotal:  db.prepare(`
      SELECT COUNT(*) AS n FROM messages
      WHERE recipient = ? AND read = 0
        AND sender NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)`),
    convos:       db.prepare(`
      SELECT other, MAX(id) AS last_id FROM (
        SELECT recipient AS other, id FROM messages WHERE sender = ?
        UNION ALL
        SELECT sender AS other, id FROM messages WHERE recipient = ?
      ) GROUP BY other ORDER BY last_id DESC LIMIT 100`),
    messageById:  db.prepare("SELECT id, sender, recipient, body, created FROM messages WHERE id = ?"),
    unreadFrom:   db.prepare("SELECT COUNT(*) AS n FROM messages WHERE sender = ? AND recipient = ? AND read = 0"),
    isBlocked:    db.prepare("SELECT 1 FROM blocks WHERE blocker = ? AND blocked = ?"),
    block:        db.prepare("INSERT OR IGNORE INTO blocks (blocker, blocked) VALUES (?, ?)"),
    unblock:      db.prepare("DELETE FROM blocks WHERE blocker = ? AND blocked = ?"),
  };

  // Clear out expired sessions once at startup and then daily.
  const pruneSessions = () => q.oldSessions.run(Date.now() - SESSION_DAYS * 864e5);
  pruneSessions();
  setInterval(pruneSessions, 864e5).unref();

  /* ---------------- helpers ---------------- */

  async function hashPassword(password) {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, 64);
    return salt.toString("hex") + ":" + key.toString("hex");
  }

  async function checkPassword(password, stored) {
    const [saltHex, keyHex] = stored.split(":");
    const key = await scryptAsync(password, Buffer.from(saltHex, "hex"), 64);
    const expected = Buffer.from(keyHex, "hex");
    return key.length === expected.length && timingSafeEqual(key, expected);
  }

  function parseCookies(header = "") {
    const out = {};
    for (const part of header.split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function userFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const s = q.session.get(token);
    if (!s || s.created < Date.now() - SESSION_DAYS * 864e5) return null;
    const user = q.userById.get(s.user_id);
    return user ? { ...user, token } : null;
  }

  function isHttps(req) {
    return req.secure || req.headers["x-forwarded-proto"] === "https";
  }

  function startSession(req, res, userId) {
    const token = randomBytes(32).toString("base64url");
    q.addSession.run(token, userId, Date.now());
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps(req),
      maxAge: SESSION_DAYS * 864e5,
      path: "/",
    });
  }

  const publicMessage = (m) => {
    const from = q.userById.get(m.sender);
    const to = q.userById.get(m.recipient);
    return { id: m.id, from: from?.username, to: to?.username, body: m.body, at: m.created };
  };

  // Tiny in-memory rate limiter: at most `max` hits per `ms` per key.
  const hits = new Map();
  function limited(key, max, ms) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < ms);
    list.push(now);
    hits.set(key, list);
    return list.length > max;
  }
  setInterval(() => hits.clear(), 10 * 60e3).unref();

  /* ---------------- live sockets ---------------- */

  const sockets = new Map(); // userId -> Set<WebSocket>
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

  function push(userId, payload) {
    const set = sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(payload);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  wss.on("connection", (ws, user) => {
    ws.isAlive = true;
    if (!sockets.has(user.id)) sockets.set(user.id, new Set());
    sockets.get(user.id).add(ws);
    ws.on("pong", () => (ws.isAlive = true));
    ws.on("message", () => {}); // client only listens
    ws.on("close", () => {
      const set = sockets.get(user.id);
      if (set) {
        set.delete(ws);
        if (!set.size) sockets.delete(user.id);
      }
    });
  });

  // Keep connections warm through hosting proxies and drop dead ones.
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 25e3).unref();

  function handleUpgrade(req, socket, head) {
    const user = userFromRequest(req);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, user));
  }

  /* ---------------- HTTP API ---------------- */

  const router = express.Router();
  router.use(express.json({ limit: "8kb" }));

  const fail = (res, status, error) => res.status(status).json({ error });

  function requireUser(req, res, next) {
    const user = userFromRequest(req);
    if (!user) return fail(res, 401, "Log in to use messages.");
    req.user = user;
    next();
  }

  router.post("/signup", async (req, res) => {
    if (limited("auth:" + req.ip, 10, 60e3)) return fail(res, 429, "Too many tries. Wait a minute.");
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!USERNAME_RE.test(username)) return fail(res, 400, "Usernames are 3–20 letters, numbers or _.");
    if (password.length < 6 || password.length > 100) return fail(res, 400, "Passwords need at least 6 characters.");
    if (q.userByName.get(username)) return fail(res, 409, "That username is taken.");
    const info = q.addUser.run(username, await hashPassword(password), Date.now());
    startSession(req, res, Number(info.lastInsertRowid));
    res.json({ user: { username } });
  });

  router.post("/login", async (req, res) => {
    if (limited("auth:" + req.ip, 10, 60e3)) return fail(res, 429, "Too many tries. Wait a minute.");
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const user = q.userByName.get(username);
    if (!user || !(await checkPassword(password, user.pass))) {
      return fail(res, 401, "Wrong username or password.");
    }
    startSession(req, res, user.id);
    res.json({ user: { username: user.username } });
  });

  router.post("/logout", (req, res) => {
    const user = userFromRequest(req);
    if (user) q.dropSession.run(user.token);
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", requireUser, (req, res) => {
    const unread = q.unreadTotal.get(req.user.id, req.user.id).n;
    res.json({ user: { username: req.user.username }, unread });
  });

  router.get("/conversations", requireUser, (req, res) => {
    const me = req.user.id;
    const list = q.convos.all(me, me).map((row) => {
      const other = q.userById.get(row.other);
      const last = q.messageById.get(row.last_id);
      return {
        username: other?.username,
        last: last.body.slice(0, 120),
        lastFromMe: last.sender === me,
        at: last.created,
        unread: q.unreadFrom.get(row.other, me).n,
        blocked: !!q.isBlocked.get(me, row.other),
      };
    });
    res.json({ conversations: list.filter((c) => c.username) });
  });

  router.get("/messages/:username", requireUser, (req, res) => {
    const other = q.userByName.get(req.params.username);
    if (!other) return fail(res, 404, "No one has that username.");
    if (other.id === req.user.id) return fail(res, 400, "That's you!");
    const me = req.user.id;
    const before = Number(req.query.before) || Number.MAX_SAFE_INTEGER;
    const rows = q.thread.all(me, other.id, other.id, me, before).reverse();
    q.markRead.run(other.id, me);
    res.json({
      with: { username: other.username, blocked: !!q.isBlocked.get(me, other.id) },
      messages: rows.map(publicMessage),
    });
  });

  router.post("/messages/:username", requireUser, (req, res) => {
    const other = q.userByName.get(req.params.username);
    if (!other) return fail(res, 404, "No one has that username.");
    if (other.id === req.user.id) return fail(res, 400, "You can't message yourself.");
    const me = req.user.id;
    const body = String(req.body?.body || "").trim();
    if (!body) return fail(res, 400, "Type a message first.");
    if (body.length > MAX_BODY) return fail(res, 400, `Keep it under ${MAX_BODY} characters.`);
    if (limited("msg:" + me, 20, 10e3)) return fail(res, 429, "Slow down a little.");
    if (q.isBlocked.get(me, other.id)) return fail(res, 403, "Unblock them to send a message.");
    if (q.isBlocked.get(other.id, me)) return fail(res, 403, "You can't message this person.");

    const info = q.addMessage.run(me, other.id, body, Date.now());
    const message = publicMessage(q.messageById.get(Number(info.lastInsertRowid)));
    push(me, { type: "message", message });
    push(other.id, { type: "message", message });
    res.json({ message });
  });

  router.post("/read/:username", requireUser, (req, res) => {
    const other = q.userByName.get(req.params.username);
    if (other) q.markRead.run(other.id, req.user.id);
    res.json({ ok: true });
  });

  router.post("/block/:username", requireUser, (req, res) => {
    const other = q.userByName.get(req.params.username);
    if (!other || other.id === req.user.id) return fail(res, 404, "No one has that username.");
    q.block.run(req.user.id, other.id);
    res.json({ ok: true });
  });

  router.delete("/block/:username", requireUser, (req, res) => {
    const other = q.userByName.get(req.params.username);
    if (other) q.unblock.run(req.user.id, other.id);
    res.json({ ok: true });
  });

  router.use((req, res) => fail(res, 404, "Not found."));

  return { router, handleUpgrade };
}
