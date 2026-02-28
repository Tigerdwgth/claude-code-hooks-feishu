// lib/ws-client.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { listActiveSessions } = require('./session-registry');
const { getMachineId, loadConfig } = require('./config');

// ── JSONL 工具函数（IO 优化版） ─────────────────────────────────

const PROJECTS_BASE = path.join(os.homedir(), '.claude', 'projects');

// 文件列表缓存：避免每次都递归遍历目录
let _fileListCache = [];
let _fileListCacheTime = 0;
const FILE_LIST_CACHE_TTL = 15_000; // 15s 缓存目录结构

function findJsonlFiles(dir) {
  const now = Date.now();
  if (now - _fileListCacheTime < FILE_LIST_CACHE_TTL && _fileListCache.length > 0) {
    return _fileListCache;
  }
  const results = [];
  try {
    _findJsonlRecursive(dir, results, 0);
  } catch {}
  _fileListCache = results;
  _fileListCacheTime = now;
  return results;
}

function _findJsonlRecursive(dir, results, depth) {
  if (depth > 6) return; // 防止过深递归
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) _findJsonlRecursive(full, results, depth + 1);
      else if (entry.name.endsWith('.jsonl')) results.push(full);
    }
  } catch {}
}

// ── scanActiveSessions（轻量版：只 stat，只读活跃文件的首行） ──

const ACTIVE_THRESHOLD_MS = 1_800_000; // 30 minutes

function scanActiveSessions() {
  const files = findJsonlFiles(PROJECTS_BASE);
  const now = Date.now();
  const seen = new Map();
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs > ACTIVE_THRESHOLD_MS) continue;
      // 只读文件的前 2KB 提取 sessionId 和 cwd
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(2048);
      const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
      fs.closeSync(fd);
      const head = buf.toString('utf-8', 0, bytesRead);
      const firstNewline = head.indexOf('\n');
      const firstLine = firstNewline > 0 ? head.slice(0, firstNewline) : head;
      try {
        const d = JSON.parse(firstLine);
        if (d.sessionId && d.cwd) {
          const prev = seen.get(d.sessionId);
          if (!prev || stat.mtimeMs > prev.mtime) {
            seen.set(d.sessionId, { sessionId: d.sessionId, cwd: d.cwd, mtime: stat.mtimeMs });
          }
        }
      } catch {}
    } catch {}
  }
  return [...seen.values()];
}

// ── scanSessionHistory（带 mtime 缓存，只读变化的文件） ──────

const _historyCache = new Map(); // file → { mtime, data }
let _historyCacheResult = null;
let _historyCacheTime = 0;
const HISTORY_CACHE_TTL = 60_000; // 60s 内不重新扫描

async function scanSessionHistory() {
  const now = Date.now();
  if (_historyCacheResult && now - _historyCacheTime < HISTORY_CACHE_TTL) {
    return _historyCacheResult;
  }

  const files = findJsonlFiles(PROJECTS_BASE);
  const sessions = new Map();
  const aliveFiles = new Set(files);

  // 清理已删除文件的缓存
  for (const key of _historyCache.keys()) {
    if (!aliveFiles.has(key)) _historyCache.delete(key);
  }

  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      const cached = _historyCache.get(file);
      if (cached && cached.mtime === stat.mtimeMs) {
        // 文件未变化，复用缓存
        if (cached.data) sessions.set(cached.data.sessionId, cached.data);
        continue;
      }

      // 文件变化或新文件，只读前 4KB 提取元数据
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const head = buf.toString('utf-8', 0, bytesRead);
      const lines = head.split('\n');

      let data = null;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.sessionId && d.cwd) {
            let summary = '';
            // 在已读取的部分中找 user message
            for (const l2 of lines) {
              try {
                const d2 = JSON.parse(l2);
                if (d2.type === 'user' && d2.message?.content) {
                  const c = d2.message.content;
                  summary = Array.isArray(c)
                    ? (c.find(x => x.type === 'text')?.text || '').slice(0, 60)
                    : String(c).slice(0, 60);
                  break;
                }
              } catch {}
            }
            data = {
              sessionId: d.sessionId,
              cwd: d.cwd,
              timestamp: d.timestamp || '',
              gitBranch: d.gitBranch || '',
              summary,
              filePath: file
            };
            break;
          }
        } catch {}
      }

      _historyCache.set(file, { mtime: stat.mtimeMs, data });
      if (data) sessions.set(data.sessionId, data);
    } catch {}
  }

  _historyCacheResult = [...sessions.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  _historyCacheTime = now;
  return _historyCacheResult;
}

// 使历史缓存失效（删除 session 后调用）
function invalidateHistoryCache() {
  _historyCacheResult = null;
  _historyCacheTime = 0;
}

function listDir(dirPath) {
  try {
    const all = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'));
    const dirs = all.filter(e => e.isDirectory())
      .map(e => ({ name: e.name, path: path.join(dirPath, e.name), type: 'dir' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = all.filter(e => e.isFile())
      .map(e => ({ name: e.name, path: path.join(dirPath, e.name), type: 'file' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...dirs, ...files];
  } catch { return []; }
}

// ── WsClient ─────────────────────────────────────────────────

const ACTIVE_POLL_INTERVAL = 60_000; // 60s（阈值已是 30 分钟，不需要太频繁）

class WsClient {
  constructor({ url, machineToken, machineId, ptyManager }) {
    this._url = url;
    this._token = machineToken;
    this._machineId = machineId || getMachineId();
    this._pty = ptyManager;
    this._ws = null;
    this._reconnectTimer = null;
    this._reconnectEnabled = true;
    this._scanDebounce = null;
    this._lastActiveHash = '';  // diff 检测用
  }

  connect() {
    const ws = new WebSocket(this._url, {
      headers: {
        'x-machine-token': this._token,
        'x-machine-id': this._machineId
      }
    });
    this._ws = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'register', machineId: this._machineId }));
      this._sendSessionList();
      try {
        const activeSess = scanActiveSessions();
        this._send({ type: 'active_sessions', sessions: activeSess });
      } catch {}
      this._startActiveSessionPoller();
    });

    ws.on('message', (data) => this._handleMessage(data.toString()));

    ws.on('close', () => {
      this._stopActiveSessionPoller();
      if (this._reconnectEnabled) {
        this._reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    ws.on('error', () => {}); // 错误由 close 处理
  }

  _sendSessionList() {
    try {
      const sessions = listActiveSessions().map(s => ({ id: s.sessionId, cwd: s.cwd }));
      this._send({ type: 'session_list', sessions });
    } catch {
      this._send({ type: 'session_list', sessions: [] });
    }
  }

  _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'pty_open') {
      this._pty.create(msg.sessionId, {
        cols: msg.cols, rows: msg.rows,
        command: msg.command,
        cwd: msg.cwd,
        onData: (data) => {
          this._send({
            type: 'pty_data',
            sessionId: msg.sessionId,
            data: Buffer.from(data).toString('base64')
          });
        },
        onExit: () => {
          this._send({ type: 'pty_data', sessionId: msg.sessionId, data: '' });
        }
      });
    } else if (msg.type === 'pty_input') {
      const data = Buffer.from(msg.data, 'base64').toString();
      this._pty.write(msg.sessionId, data);
    } else if (msg.type === 'pty_resize') {
      this._pty.resize(msg.sessionId, msg.cols, msg.rows);
    } else if (msg.type === 'pty_close') {
      this._pty.destroy(msg.sessionId);
    } else if (msg.type === 'scan_history') {
      this._debouncedScanHistory();
    } else if (msg.type === 'scan_active') {
      const sessions = scanActiveSessions();
      this._send({ type: 'active_sessions', sessions });
    } else if (msg.type === 'list_dir') {
      const entries = listDir(msg.path || os.homedir());
      this._send({ type: 'dir_entries', path: msg.path, entries });
    } else if (msg.type === 'delete_session') {
      this._deleteSession(msg.sessionId);
    } else if (msg.type === 'read_file') {
      this._readFile(msg.path);
    }
  }

  // debounce：多个浏览器同时请求 scan_history 时只执行一次
  _debouncedScanHistory() {
    if (this._scanDebounce) return;
    this._scanDebounce = setTimeout(() => {
      this._scanDebounce = null;
      scanSessionHistory().then(sessions => {
        this._send({ type: 'session_history', sessions });
      });
    }, 200);
  }

  _readFile(filePath) {
    try {
      const resolved = path.resolve(filePath);
      const home = os.homedir();
      const cfg = loadConfig();
      const access = cfg.fileAccess || {};
      const blockedDirs = access.blockedDirs || ['.ssh', '.gnupg', '.aws', '.config/gcloud', '.env'];
      const blockedSystem = access.blockedSystemPaths || ['/etc/shadow', '/etc/passwd', '/proc', '/sys'];
      const maxSize = (access.maxFileSizeKB || 100) * 1024;
      // 安全检查：禁止 home 下的敏感目录
      for (const b of blockedDirs) {
        if (resolved.startsWith(path.join(home, b))) {
          this._send({ type: 'file_content', path: filePath, error: 'Access denied' });
          return;
        }
      }
      // 禁止系统关键路径
      for (const s of blockedSystem) {
        if (resolved.startsWith(s)) {
          this._send({ type: 'file_content', path: filePath, error: 'Access denied' });
          return;
        }
      }
      const stat = fs.statSync(resolved);
      if (stat.size > maxSize) {
        this._send({ type: 'file_content', path: filePath, error: `File too large (>${access.maxFileSizeKB || 100}KB)` });
        return;
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      this._send({ type: 'file_content', path: filePath, content });
    } catch (e) {
      this._send({ type: 'file_content', path: filePath, error: e.message });
    }
  }

  _deleteSession(sessionId) {
    scanSessionHistory().then(sessions => {
      const target = sessions.find(s => s.sessionId === sessionId);
      if (target && target.filePath) {
        try { fs.unlinkSync(target.filePath); } catch {}
      }
      invalidateHistoryCache();
      this._send({ type: 'session_deleted', sessionId });
      scanSessionHistory().then(updated => {
        this._send({ type: 'session_history', sessions: updated });
      });
    });
  }

  _startActiveSessionPoller() {
    this._stopActiveSessionPoller();
    this._activePoller = setInterval(() => {
      const sessions = scanActiveSessions();
      const hash = JSON.stringify(sessions);
      if (hash === this._lastActiveHash) return; // diff 检测：不变则不发送
      this._lastActiveHash = hash;
      this._send({ type: 'active_sessions', sessions });
    }, ACTIVE_POLL_INTERVAL);
  }

  _stopActiveSessionPoller() {
    if (this._activePoller) {
      clearInterval(this._activePoller);
      this._activePoller = null;
    }
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    this._reconnectEnabled = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._stopActiveSessionPoller();
    if (this._scanDebounce) clearTimeout(this._scanDebounce);
    if (this._ws) this._ws.close();
  }
}

module.exports = { WsClient, scanSessionHistory, scanActiveSessions, listDir };
