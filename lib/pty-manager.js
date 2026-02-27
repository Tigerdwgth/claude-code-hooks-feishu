// lib/pty-manager.js
const pty = require('node-pty');
const os = require('node:os');

class PtyManager {
  constructor() {
    this._ptys = new Map(); // sessionId → pty instance
  }

  create(sessionId, { cols = 220, rows = 50, onData, onExit } = {}) {
    if (this._ptys.has(sessionId)) this.destroy(sessionId);
    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash');
    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols, rows,
      cwd: process.env.HOME || '/',
      env: process.env
    });
    if (onData) p.onData(onData);
    if (onExit) p.onExit(onExit);
    this._ptys.set(sessionId, p);
    return p;
  }

  write(sessionId, data) {
    const p = this._ptys.get(sessionId);
    if (p) p.write(data);
  }

  resize(sessionId, cols, rows) {
    const p = this._ptys.get(sessionId);
    if (p) p.resize(cols, rows);
  }

  destroy(sessionId) {
    const p = this._ptys.get(sessionId);
    if (p) {
      try { p.kill(); } catch {}
      this._ptys.delete(sessionId);
    }
  }

  has(sessionId) {
    return this._ptys.has(sessionId);
  }

  destroyAll() {
    for (const id of [...this._ptys.keys()]) this.destroy(id);
  }
}

module.exports = { PtyManager };
