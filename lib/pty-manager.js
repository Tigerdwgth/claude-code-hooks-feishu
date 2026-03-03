// lib/pty-manager.js
const pty = require('node-pty');
const { execSync, spawnSync } = require('node:child_process');
const os = require('node:os');

// tmux session 名称：截取 sessionId 前 16 字符（tmux 名称不能太长且不含特殊字符）
function tmuxName(sessionId) {
  return 'cc-' + sessionId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 16);
}

function tmuxHasSession(name) {
  const r = spawnSync('tmux', ['has-session', '-t', name], { stdio: 'ignore' });
  return r.status === 0;
}

function tmuxCapturePane(name) {
  try {
    // 捕获最近 500 行输出作为历史补屏（保留 ANSI 颜色）
    const r = spawnSync('tmux', ['capture-pane', '-t', name, '-p', '-e', '-S', '-500'], {
      encoding: 'utf8',
    });
    return r.stdout || '';
  } catch {
    return '';
  }
}

class PtyManager {
  constructor() {
    // sessionId → { pty, tmuxName, onDataCallbacks: Set }
    this._sessions = new Map();
  }

  /**
   * 打开或复用一个 tmux session，返回 pty 实例。
   * 如果 tmux session 已存在（另一个浏览器打开过），直接 attach，并推送历史屏幕内容。
   * @param {string} sessionId
   * @param {{ cols, rows, command, cwd, onData, onExit }} opts
   * @returns {{ isNew: boolean, historySnapshot: string }}
   */
  create(sessionId, { cols = 220, rows = 50, command, cwd, onData, onExit } = {}) {
    const name = tmuxName(sessionId);
    const existing = this._sessions.get(sessionId);

    // 复用：pty 进程存活，只追加 onData 回调（共享输出流）
    if (existing) {
      try {
        process.kill(existing.pty.pid, 0);
        if (cols && rows) existing.pty.resize(cols, rows);
        if (onData) existing.onDataCallbacks.add(onData);
        const snapshot = tmuxCapturePane(name);
        return { isNew: false, historySnapshot: snapshot };
      } catch {
        this._sessions.delete(sessionId);
      }
    }

    // 构建要在 tmux 里运行的命令
    const cmd = (command && command.length > 0) ? command[0] : 'claude';
    const args = (command && command.length > 1) ? command.slice(1) : [];
    if (cmd === 'claude' && !args.includes('--dangerously-skip-permissions')) {
      args.push('--dangerously-skip-permissions');
    }
    const workdir = cwd || process.env.HOME || '/';

    // 清除嵌套检测环境变量
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_SSE_PORT;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;
    cleanEnv.IS_SANDBOX = '1';
    cleanEnv.TERM = 'xterm-256color';

    let isNew = false;
    let historySnapshot = '';

    if (tmuxHasSession(name)) {
      // tmux session 已存在（例如另一台浏览器之前开过，pty 已死但 tmux 还活着）
      historySnapshot = tmuxCapturePane(name);
    } else {
      // 新建 tmux session，在里面运行 claude
      const innerCmd = [cmd, ...args].map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
      spawnSync('tmux', [
        'new-session', '-d',
        '-s', name,
        '-x', String(cols),
        '-y', String(rows),
        `cd ${workdir} && ${innerCmd}`,
      ], { env: cleanEnv });
      isNew = true;
    }

    // node-pty attach 到 tmux session（这是浏览器和 tmux 之间的 PTY）
    const p = pty.spawn('tmux', ['attach-session', '-t', name], {
      name: 'xterm-256color',
      cols, rows,
      cwd: workdir,
      env: cleanEnv,
    });

    const onDataCallbacks = new Set();
    if (onData) onDataCallbacks.add(onData);

    p.onData((data) => {
      for (const cb of onDataCallbacks) {
        try { cb(data); } catch {}
      }
    });

    p.onExit(() => {
      // pty 断开（浏览器关闭），但 tmux session 还在，不销毁 claude
      this._sessions.delete(sessionId);
      if (onExit) onExit();
    });

    this._sessions.set(sessionId, { pty: p, tmuxName: name, onDataCallbacks });
    return { isNew, historySnapshot };
  }

  /**
   * 给 sessionId 对应的 pty（tmux attach）写输入
   */
  write(sessionId, data) {
    const s = this._sessions.get(sessionId);
    if (s) s.pty.write(data);
  }

  resize(sessionId, cols, rows) {
    const s = this._sessions.get(sessionId);
    if (s) {
      try { s.pty.resize(cols, rows); } catch {}
      // 同时 resize tmux 窗口
      try {
        spawnSync('tmux', ['resize-window', '-t', s.tmuxName, '-x', String(cols), '-y', String(rows)]);
      } catch {}
    }
  }

  destroy(sessionId) {
    const s = this._sessions.get(sessionId);
    if (s) {
      try { s.pty.kill(); } catch {}
      this._sessions.delete(sessionId);
      // 不 kill tmux session，claude 继续跑
    }
  }

  /**
   * 彻底终止：同时 kill tmux session（关闭 claude 进程）
   */
  destroyWithTmux(sessionId) {
    const s = this._sessions.get(sessionId);
    const name = s ? s.tmuxName : tmuxName(sessionId);
    if (s) {
      try { s.pty.kill(); } catch {}
      this._sessions.delete(sessionId);
    }
    try {
      spawnSync('tmux', ['kill-session', '-t', name]);
    } catch {}
  }

  has(sessionId) {
    // 也检查 tmux session 是否存在（即使 pty 断了 claude 还在跑）
    if (this._sessions.has(sessionId)) return true;
    return tmuxHasSession(tmuxName(sessionId));
  }

  destroyAll() {
    for (const id of [...this._sessions.keys()]) this.destroy(id);
  }
}

module.exports = { PtyManager };
