// packages/server/relay.js
const { WebSocketServer } = require('ws');
const { verifyToken } = require('./auth');

const MACHINE_TOKENS = new Set(
  (process.env.MACHINE_TOKENS || '').split(',').filter(Boolean)
);

class RelayServer {
  constructor() {
    this.machines = new Map();   // machineId → { ws, sessions }
    this.browsers = new Map();   // browserId → { ws, watchingMachine, watchingSession }
    this._browserId = 0;
  }

  registerMachine(machineId, ws) {
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
    for (const { ws } of this.browsers.values()) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }

  handleMachineMessage(machineId, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'session_list') {
      this.updateSessions(machineId, msg.sessions || []);
      return;
    }
    if (msg.type === 'pty_data') {
      for (const browser of this.browsers.values()) {
        if (browser.watchingMachine === machineId &&
            browser.watchingSession === msg.sessionId &&
            browser.ws.readyState === 1) {
          browser.ws.send(JSON.stringify(msg));
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
      browser.watchingMachine = msg.machineId;
      browser.watchingSession = msg.sessionId;
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify({
          type: 'pty_open', sessionId: msg.sessionId,
          cols: msg.cols || 220, rows: msg.rows || 50
        }));
      }
      browser.ws.send(JSON.stringify({ type: 'session_list', sessions: this.getAllSessions() }));
      return;
    }
    if (msg.type === 'terminal_input' || msg.type === 'terminal_resize') {
      const machine = this.machines.get(msg.machineId);
      if (machine && machine.ws.readyState === 1) {
        machine.ws.send(JSON.stringify(msg));
      }
    }
  }

  attachToHttpServer(server) {
    const wss = new WebSocketServer({ server, path: '/ws' });
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
      const browserId = ++this._browserId;
      this.browsers.set(browserId, { ws, watchingMachine: null, watchingSession: null });
      ws.send(JSON.stringify({ type: 'session_list', sessions: this.getAllSessions() }));
      ws.on('message', (data) => this.handleBrowserMessage(browserId, data.toString()));
      ws.on('close', () => this.browsers.delete(browserId));
    });
  }
}

module.exports = { RelayServer };
