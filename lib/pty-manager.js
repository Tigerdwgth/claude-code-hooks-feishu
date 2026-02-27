// lib/pty-manager.js
const pty = require('node-pty');
const os = require('node:os');

class PtyManager {
  constructor() {
    this._ptys = new Map(); // sessionId → pty instance
  }

  create(sessionId, { cols = 220, rows = 50, command, cwd, onData, onExit } = {}) {
    if (this._ptys.has(sessionId)) this.destroy(sessionId);
    const cmd = (command && command.length > 0) ? command[0] : 'claude';
    const args = (command && command.length > 1) ? command.slice(1) : [];
    const workdir = cwd || process.env.HOME || '/';
    // 清除 Claude Code 嵌套检测变量，否则子进程无法启动 claude
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SSE_PORT;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    const p = pty.spawn(cmd, args, {
      name: 'xterm-256color',
      cols, rows,
      cwd: workdir,
      env: cleanEnv
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
