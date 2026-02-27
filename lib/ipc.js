const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { loadConfig } = require('./config');

const DEFAULT_IPC_DIR = path.join(os.tmpdir(), 'claude-hooks-feishu');

function getIpcDir() {
  if (process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR) {
    return process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR;
  }
  try {
    const cfg = loadConfig();
    if (cfg.ipcDir) return cfg.ipcDir;
  } catch {}
  return DEFAULT_IPC_DIR;
}

function ensureDir() {
  const dir = getIpcDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function reqPath(requestId) {
  return path.join(getIpcDir(), `req-${requestId}.json`);
}

function respPath(requestId) {
  return path.join(getIpcDir(), `resp-${requestId}.json`);
}

function writeRequest(requestId, data) {
  ensureDir();
  const filePath = reqPath(requestId);
  fs.writeFileSync(filePath, JSON.stringify({ ...data, timestamp: Date.now() }), 'utf-8');
  return filePath;
}

function updateRequest(requestId, patch) {
  const filePath = reqPath(requestId);
  if (!fs.existsSync(filePath)) return;
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    fs.writeFileSync(filePath, JSON.stringify({ ...existing, ...patch }), 'utf-8');
  } catch {}
}

function writeResponse(requestId, data) {
  ensureDir();
  const filePath = respPath(requestId);
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  return filePath;
}

function pollResponse(requestId, { timeoutMs = 300000, intervalMs = 500 } = {}) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const rp = respPath(requestId);
      if (fs.existsSync(rp)) {
        try {
          const content = JSON.parse(fs.readFileSync(rp, 'utf-8'));
          try { fs.unlinkSync(rp); } catch {}
          try { fs.unlinkSync(reqPath(requestId)); } catch {}
          resolve(content);
          return;
        } catch {}
      }
      if (Date.now() >= deadline) {
        try { fs.unlinkSync(reqPath(requestId)); } catch {}
        resolve(null);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function listPendingRequests() {
  const dir = getIpcDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('req-') && f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

module.exports = {
  writeRequest,
  updateRequest,
  writeResponse,
  pollResponse,
  listPendingRequests,
  getIpcDir,
  reqPath,
  respPath,
  IPC_DIR: DEFAULT_IPC_DIR
};
