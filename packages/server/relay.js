// packages/server/relay.js
const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth');

const MACHINE_TOKENS = new Set(
  (process.env.MACHINE_TOKENS || '').split(',').filter(Boolean)
);

class RelayServer {
  constructor() {
    this.machines = new Map();   // machineId → { ws, sessions }
    this.browsers = new Map();   // browserId → { ws, watching: Set<"machineId:sessionId"> }
    this._browserId = 0;
    this._lastSessionListHash = '';  // 广播 diff 检测
  }

  registerMachine(machineId, ws) {
    console.log(`[relay] machine registered: ${machineId}`);
    this.machines.set(machineId, { ws, sessions: [] });
  }

  unregisterMachine(machineId) {
    this.machines.delete(machineId);
  }

  getMachine(machineId) {
    return this.machines.get(machineId);
  }

  updateSessions(machineId, sessions) {
    const m = this.machines.get(machineId);
    if (m) m.sessions = sessions;
    this._broadcastSessionList();
  }

  getAllSessions() {
    const result = [];
    for (const [machineId, { sessions }] of this.machines) {
      for (const s of sessions) result.push({ ...s, machineId });
    }
    return result;
  }

  _broadcastSessionList() {
    const sessions = this.getAllSessions();
    const msg = JSON.stringify({ type: 'session_list', sessions });
    // diff 检测：内容不变则跳过广播
    if (msg === this._lastSessionListHash) return;
    this._lastSessionListHash = msg;
    for (const { ws } of this.browsers.values()) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  _addBrowser(ws) {
    const browserId = ++this._browserId;
    this.browsers.set(browserId, { ws, watching: new Set() });
    const allSessions = this.getAllSessions();
    console.log(`[relay] browser #${browserId} connected, ${allSessions.length} sessions, ${this.machines.size} machines`);
    ws.send(JSON.stringify({ type: 'session_list', sessions: allSessions }));
    // 触发所有在线机器立即推送 active_sessions 和 history
    for (const [, m] of this.machines) {
      if (m.ws.readyState === 1) {
        m.ws.send(JSON.stringify({ type: 'scan_active' }));
        m.ws.send(JSON.stringify({ type: 'scan_history' }));
      }
    }
    return browserId;
  }

  handleMachineMessage(machineId, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const detail = msg.type === 'session_list' ? `(${(msg.sessions||[]).length} sessions)` :
      msg.type === 'active_sessions' ? `(${(msg.sessions||[]).length} active)` :
      msg.type === 'session_history' ? `(${(msg.sessions||[]).length} history)` : '';
    console.log(`[relay] machine ${machineId} → ${msg.type} ${detail}`);

    if (msg.type === 'session_list') {
      this.updateSessions(machineId, msg.sessions || []);
      return;
    }
    if (msg.type === 'pty_data') {
      const watchKey = `${machineId}:${msg.sessionId}`;
      for (const browser of this.browsers.values()) {
        if (browser.watching.has(watchKey) && browser.ws.readyState === 1) {
          browser.ws.send(JSON.stringify(msg));
        }
      }
    }
    if (msg.type === 'active_sessions' || msg.type === 'session_history' || msg.type === 'dir_entries' || msg.type === 'session_deleted' || msg.type === 'file_content') {
      for (const browser of this.browsers.values()) {
        if (browser.ws.readyState === 1) {
          browser.ws.send(JSON.stringify({ ...msg, machineId }));
        }
      }
    }
  }

  handleBrowserMessage(browserId, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const browser = this.browsers.get(browserId);
    if (!browser) return;

    if (msg.type === 'open_terminal') {
      browser.watching.add(`${msg.machineId}:${msg.sessionId}`);
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({
          type: 'pty_open', sessionId: msg.sessionId,
          cols: msg.cols || 220, rows: msg.rows || 50,
          command: msg.command,
          cwd: msg.cwd
        }));
      }
      browser.ws.send(JSON.stringify({ type: 'session_list', sessions: this.getAllSessions() }));
      return;
    }
    if (msg.type === 'terminal_input') {
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({ type: 'pty_input', sessionId: msg.sessionId, data: msg.data }));
      }
    } else if (msg.type === 'terminal_resize') {
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({ type: 'pty_resize', sessionId: msg.sessionId, cols: msg.cols, rows: msg.rows }));
      }
    } else if (msg.type === 'scan_history') {
      // 广播给所有在线机器
      for (const [, m] of this.machines) {
        if (m.ws.readyState === 1) m.ws.send(JSON.stringify({ type: 'scan_history' }));
      }
    } else if (msg.type === 'list_dir') {
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify(msg));
      }
    } else if (msg.type === 'pty_attach') {
      browser.watching.add(`${msg.machineId}:${msg.sessionId}`);
    } else if (msg.type === 'close_terminal') {
      browser.watching.delete(`${msg.machineId}:${msg.sessionId}`);
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({ type: 'pty_close', sessionId: msg.sessionId }));
      }
    } else if (msg.type === 'delete_session') {
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({ type: 'delete_session', sessionId: msg.sessionId }));
      }
    } else if (msg.type === 'read_file') {
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({ type: 'read_file', path: msg.path }));
      }
    }
  }

  attachToHttpServer(server) {
    // 不限制 path，让代理转发的各种路径都能连接（如 /proxy/3000/ws）
    const wss = new WebSocketServer({ noServer: true, perMessageDeflate: true });
    server.on('upgrade', (req, socket, head) => {
      // 只要路径以 /ws 结尾就接受
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.endsWith('/ws') || pathname === '/ws') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });
    wss.on('connection', (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      const machineToken = req.headers['x-machine-token'];

      // 开发机连接
      if (machineToken && MACHINE_TOKENS.has(machineToken)) {
        const machineId = req.headers['x-machine-id'] || 'unknown';
        this.registerMachine(machineId, ws);
        ws.on('message', (data) => this.handleMachineMessage(machineId, data.toString()));
        ws.on('close', () => {
          this.unregisterMachine(machineId);
          this._broadcastSessionList();
        });
        return;
      }

      // 浏览器连接（JWT）
      const payload = verifyToken(token);
      if (!payload) { ws.close(4001, 'Unauthorized'); return; }
      const browserId = this._addBrowser(ws);
      ws.on('message', (data) => this.handleBrowserMessage(browserId, data.toString()));
      ws.on('close', () => this.browsers.delete(browserId));
    });
  }
}

module.exports = { RelayServer };
