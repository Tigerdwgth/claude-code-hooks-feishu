// lib/ws-client.js
const WebSocket = require('ws');
const { listActiveSessions } = require('./session-registry');
const { getMachineId } = require('./config');

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
    if (this._ws) this._ws.close();
  }
}

module.exports = { WsClient };
