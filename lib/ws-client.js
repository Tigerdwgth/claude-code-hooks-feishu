// lib/ws-client.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const WebSocket = require('ws');
const { listActiveSessions } = require('./session-registry');
const { getMachineId } = require('./config');

// ── JSONL 工具函数 ──────────────────────────────────────────────

function findJsonlFiles(dir) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findJsonlFiles(full));
      else if (entry.name.endsWith('.jsonl')) results.push(full);
    }
  } catch {}
  return results;
}

async function scanSessionHistory() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const sessions = new Map();
  const files = findJsonlFiles(base);
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.sessionId && d.cwd && !sessions.has(d.sessionId)) {
            let summary = '';
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
            sessions.set(d.sessionId, {
              sessionId: d.sessionId,
              cwd: d.cwd,
              timestamp: d.timestamp || '',
              gitBranch: d.gitBranch || '',
              summary,
              filePath: file
            });
            break;
          }
        } catch {}
      }
    } catch {}
  }
  return [...sessions.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

const ACTIVE_THRESHOLD_MS = 30_000;

function scanActiveSessions() {
  const base = path.join(os.homedir(), '.claude', 'projects');
  const files = findJsonlFiles(base);
  const now = Date.now();
  const active = [];
  for (const file of files) {
    try {
      const stat = fs.statSync(file);
      if (now - stat.mtimeMs > ACTIVE_THRESHOLD_MS) continue;
      const content = fs.readFileSync(file, 'utf-8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line);
          if (d.sessionId && d.cwd) {
            active.push({ sessionId: d.sessionId, cwd: d.cwd, mtime: stat.mtimeMs });
            break;
          }
        } catch {}
      }
    } catch {}
  }
  return active;
}

function listDir(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

class WsClient {
  constructor({ url, machineToken, machineId, ptyManager }) {
    this._url = url;
    this._token = machineToken;
    this._machineId = machineId || getMachineId();
    this._pty = ptyManager;
    this._ws = null;
    this._reconnectTimer = null;
    this._reconnectEnabled = true;
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
      // 立即发送一次 active_sessions，不等轮询
      try {
        const activeSess = scanActiveSessions();
        this._send({ type: 'active_sessions', sessions: activeSess });
      } catch {}
      this._startActiveSessionPoller();
    });

    ws.on('message', (data) => this._handleMessage(data.toString()));

    ws.on('close', () => {
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
      scanSessionHistory().then(sessions => {
        this._send({ type: 'session_history', sessions });
      });
    } else if (msg.type === 'scan_active') {
      const sessions = scanActiveSessions();
      this._send({ type: 'active_sessions', sessions });
    } else if (msg.type === 'list_dir') {
      const entries = listDir(msg.path || os.homedir());
      this._send({ type: 'dir_entries', path: msg.path, entries });
    } else if (msg.type === 'delete_session') {
      scanSessionHistory().then(sessions => {
        const target = sessions.find(s => s.sessionId === msg.sessionId);
        if (target && target.filePath) {
          try { fs.unlinkSync(target.filePath); } catch {}
        }
        this._send({ type: 'session_deleted', sessionId: msg.sessionId });
        scanSessionHistory().then(updated => {
          this._send({ type: 'session_history', sessions: updated });
        });
      });
    }
  }

  _startActiveSessionPoller() {
    if (this._activePoller) clearInterval(this._activePoller);
    this._activePoller = setInterval(() => {
      const sessions = scanActiveSessions();
      this._send({ type: 'active_sessions', sessions });
    }, 10_000);
  }

  _send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  disconnect() {
    this._reconnectEnabled = false;
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._activePoller) clearInterval(this._activePoller);
    if (this._ws) this._ws.close();
  }
}

module.exports = { WsClient, scanSessionHistory, scanActiveSessions, listDir };
