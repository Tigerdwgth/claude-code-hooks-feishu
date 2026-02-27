// packages/server/auth.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'users.db');
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const JWT_EXPIRES = '24h';

let _db = null;

async function getDb() {
  if (_db) return _db;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const data = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(data);
  } else {
    _db = new SQL.Database();
  }
  _db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  return _db;
}

function saveDb(db) {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function createUser(username, password) {
  const db = await getDb();
  const hash = await bcrypt.hash(password, 12);
  db.run('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)',
    [username, hash, Date.now()]);
  saveDb(db);
  const rows = db.exec('SELECT last_insert_rowid() as id');
  const id = rows[0]?.values[0][0];
  return { id, username };
}

async function verifyPassword(username, password) {
  const db = await getDb();
  const rows = db.exec('SELECT id, username, password_hash FROM users WHERE username = ?', [username]);
  if (!rows.length || !rows[0].values.length) return null;
  const [id, uname, hash] = rows[0].values[0];
  const ok = await bcrypt.compare(password, hash);
  return ok ? { id, username: uname } : null;
}

function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = payload;
  next();
}

async function listUsers() {
  const db = await getDb();
  const rows = db.exec('SELECT id, username, created_at FROM users');
  if (!rows.length) return [];
  return rows[0].values.map(([id, username, created_at]) => ({ id, username, created_at }));
}

module.exports = { createUser, verifyPassword, generateToken, verifyToken, authMiddleware, listUsers };
