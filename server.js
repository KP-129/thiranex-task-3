const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.resolve(process.env.DATA_DIR || ROOT);
const DATABASE_PATH = path.resolve(process.env.DATABASE_PATH || path.join(DATA_DIR, 'taskflow.sqlite'));
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const db = new DatabaseSync(DATABASE_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('todo', 'in-progress', 'done')),
    priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
    due_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_by_user_due ON tasks(user_id, due_date, created_at);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);
`);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function migrateLegacyJson() {
  const legacyPath = path.join(ROOT, 'data.json');
  if (!fs.existsSync(legacyPath)) return;
  const counts = db.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM tasks) AS tasks').get();
  if (counts.users || counts.tasks) return;
  const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  if (!Array.isArray(legacy.users) || !Array.isArray(legacy.tasks)) return;
  db.exec('BEGIN');
  try {
    const addUser = db.prepare('INSERT INTO users (id,name,email,salt,password_hash,created_at) VALUES (?,?,?,?,?,?)');
    for (const user of legacy.users) addUser.run(user.id, user.name, user.email, user.salt, user.passwordHash, user.createdAt || new Date().toISOString());
    const addTask = db.prepare('INSERT INTO tasks (id,user_id,title,description,status,priority,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)');
    for (const task of legacy.tasks) {
      if (!legacy.users.some(user => user.id === task.userId)) continue;
      addTask.run(task.id, task.userId, task.title, task.description || '', ['todo','in-progress','done'].includes(task.status) ? task.status : 'todo', ['low','medium','high'].includes(task.priority) ? task.priority : 'medium', task.dueDate || '', task.createdAt || new Date().toISOString(), task.updatedAt || task.createdAt || new Date().toISOString());
    }
    db.exec('COMMIT');
    console.log(`Imported ${legacy.users.length} accounts and ${legacy.tasks.length} tasks from data.json.`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
migrateLegacyJson();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}
function tokenFromCookieHeader(raw = '') {
  const value = raw.split(';').map(part => part.trim()).find(part => part.startsWith('tf_session='));
  if (!value) return '';
  try { return decodeURIComponent(value.slice('tf_session='.length)); } catch { return ''; }
}
function cookieToken(req) { return tokenFromCookieHeader(req.headers.cookie || ''); }
function tokenDigest(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function sessionUserId(token) {
  if (!token) return null;
  const row = db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').get(tokenDigest(token), Date.now());
  if (row) return row.user_id;
  db.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?').run(tokenDigest(token), Date.now());
  return null;
}
function userFor(req) { return sessionUserId(cookieToken(req)); }
function cookieOptions(maxAge = SESSION_TTL_SECONDS) { return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`; }
function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').run(tokenDigest(token), user.id, now + SESSION_TTL_SECONDS * 1000, new Date(now).toISOString());
  res.setHeader('Set-Cookie', `tf_session=${token}; ${cookieOptions()}`);
}
function clearSession(res, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenDigest(token));
  res.setHeader('Set-Cookie', `tf_session=; ${cookieOptions(0)}`);
}
function unauthorized(res) { send(res, 401, { error: 'Please sign in to continue.' }); }
function cleanUser(user) { return { id: user.id, name: user.name, email: user.email }; }
function userFromRow(row) { return row && { id: row.id, name: row.name, email: row.email, salt: row.salt, passwordHash: row.password_hash, createdAt: row.created_at }; }
function taskFromRow(row) { return { id: row.id, userId: row.user_id, title: row.title, description: row.description, status: row.status, priority: row.priority, dueDate: row.due_date, createdAt: row.created_at, updatedAt: row.updated_at }; }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) reject(new Error('Request is too large')); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}
function broadcastTaskChange(userId, action, taskId) {
  if (io) io.to(`user:${userId}`).emit('tasks:changed', { action, taskId });
}

async function api(req, res, url) {
  const route = url.pathname;
  if (req.method === 'POST' && route === '/api/auth/register') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (name.length < 2) return send(res, 400, { error: 'Please enter a name with at least 2 characters.' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { error: 'Enter a valid email address.' });
    if (password.length < 8) return send(res, 400, { error: 'Password must be at least 8 characters.' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(email)) return send(res, 409, { error: 'An account with that email already exists.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');
    const user = { id: crypto.randomUUID(), name, email, salt, passwordHash, createdAt: new Date().toISOString() };
    try { db.prepare('INSERT INTO users (id,name,email,salt,password_hash,created_at) VALUES (?,?,?,?,?,?)').run(user.id, user.name, user.email, user.salt, user.passwordHash, user.createdAt); }
    catch (error) { if (error.message.includes('UNIQUE constraint failed')) return send(res, 409, { error: 'An account with that email already exists.' }); throw error; }
    createSession(res, user);
    return send(res, 201, { user: cleanUser(user) });
  }
  if (req.method === 'POST' && route === '/api/auth/login') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const user = userFromRow(db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email));
    const candidate = user ? crypto.scryptSync(String(body.password || ''), user.salt, 64) : Buffer.alloc(64);
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
    if (!user || candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) return send(res, 401, { error: 'Email or password is incorrect.' });
    createSession(res, user);
    return send(res, 200, { user: cleanUser(user) });
  }
  if (req.method === 'POST' && route === '/api/auth/logout') {
    const token = cookieToken(req);
    const userId = sessionUserId(token);
    clearSession(res, token);
    if (userId) io.in(`user:${userId}`).disconnectSockets(true);
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && route === '/api/auth/me') {
    const id = userFor(req);
    if (!id) return unauthorized(res);
    const row = db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(id);
    return row ? send(res, 200, { user: row }) : unauthorized(res);
  }

  const userId = userFor(req);
  if (!userId) return unauthorized(res);
  if (req.method === 'GET' && route === '/api/tasks') {
    const rows = db.prepare("SELECT * FROM tasks WHERE user_id = ? ORDER BY CASE WHEN due_date = '' THEN '9999-12-31' ELSE due_date END, created_at DESC").all(userId);
    return send(res, 200, { tasks: rows.map(taskFromRow) });
  }
  if (req.method === 'POST' && route === '/api/tasks') {
    const body = await readBody(req);
    const title = String(body.title || '').trim();
    if (!title) return send(res, 400, { error: 'A task title is required.' });
    const now = new Date().toISOString();
    const task = {
      id: crypto.randomUUID(), userId, title: title.slice(0, 160),
      description: String(body.description || '').trim().slice(0, 2000),
      status: ['todo', 'in-progress', 'done'].includes(body.status) ? body.status : 'todo',
      priority: ['low', 'medium', 'high'].includes(body.priority) ? body.priority : 'medium',
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') ? body.dueDate : '',
      createdAt: now, updatedAt: now
    };
    db.prepare('INSERT INTO tasks (id,user_id,title,description,status,priority,due_date,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(task.id, task.userId, task.title, task.description, task.status, task.priority, task.dueDate, task.createdAt, task.updatedAt);
    broadcastTaskChange(userId, 'created', task.id);
    return send(res, 201, { task });
  }
  const match = route.match(/^\/api\/tasks\/([\w-]+)$/);
  if (match) {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(match[1], userId);
    if (!row) return send(res, 404, { error: 'Task not found.' });
    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const task = taskFromRow(row);
      if (body.title !== undefined) {
        const title = String(body.title).trim();
        if (!title) return send(res, 400, { error: 'A task title is required.' });
        task.title = title.slice(0, 160);
      }
      if (body.description !== undefined) task.description = String(body.description).trim().slice(0, 2000);
      if (['todo', 'in-progress', 'done'].includes(body.status)) task.status = body.status;
      if (['low', 'medium', 'high'].includes(body.priority)) task.priority = body.priority;
      if (body.dueDate !== undefined) task.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) ? body.dueDate : '';
      task.updatedAt = new Date().toISOString();
      db.prepare('UPDATE tasks SET title=?,description=?,status=?,priority=?,due_date=?,updated_at=? WHERE id=? AND user_id=?').run(task.title, task.description, task.status, task.priority, task.dueDate, task.updatedAt, task.id, userId);
      broadcastTaskChange(userId, 'updated', task.id);
      return send(res, 200, { task });
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(match[1], userId);
      broadcastTaskChange(userId, 'deleted', match[1]);
      return send(res, 200, { ok: true });
    }
  }
  return send(res, 404, { error: 'Route not found.' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (error) { console.error(error); if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Please try again.' }); }
    return;
  }
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = path.resolve(ROOT, `public${requested}`);
  if (!filePath.startsWith(path.join(ROOT, 'public') + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  });
});

const io = new Server(server);
io.use((socket, next) => {
  const userId = sessionUserId(tokenFromCookieHeader(socket.handshake.headers.cookie || ''));
  if (!userId) return next(new Error('Authentication required'));
  socket.data.userId = userId;
  next();
});
io.on('connection', socket => {
  socket.join(`user:${socket.data.userId}`);
});

server.listen(PORT, () => console.log(`Taskflow is ready at http://localhost:${PORT}`));