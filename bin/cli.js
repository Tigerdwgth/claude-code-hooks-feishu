#!/usr/bin/env node
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { saveConfig, defaultConfig, getBaseDir, getHooksDir } = require('../lib/config');
const { buildCardPayload, sendWebhook } = require('../lib/feishu-webhook');
const { buildAppCardContent, sendAppMessage } = require('../lib/feishu-app');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

async function main() {
  console.log('\n🔔 claude-code-hooks-feishu 安装向导\n');
  console.log('本工具为 Claude Code 配置飞书通知 hooks。\n');

  const config = defaultConfig();

  // 1. 选择通知方式
  console.log('请选择飞书通知方式:');
  console.log('  1) 群机器人 Webhook');
  console.log('  2) 自建应用个人消息');
  console.log('  3) 两者都要');
  const choice = await ask('请输入 (1/2/3) [1]: ');
  const mode = choice.trim() || '1';

  // Webhook 配置
  if (mode === '1' || mode === '3') {
    config.webhook.enabled = true;
    config.webhook.url = (await ask('飞书 Webhook URL: ')).trim();
    const secret = (await ask('签名密钥 (可选，直接回车跳过): ')).trim();
    if (secret) config.webhook.secret = secret;
  }

  // App 配置
  if (mode === '2' || mode === '3') {
    config.app.enabled = true;
    config.app.appId = (await ask('App ID: ')).trim();
    config.app.appSecret = (await ask('App Secret: ')).trim();
    config.app.receiverId = (await ask('接收人 ID (open_id/user_id): ')).trim();
    const idType = (await ask('ID 类型 (open_id/user_id) [open_id]: ')).trim();
    if (idType) config.app.receiverType = idType;
  }

  // 2. 选择 hooks
  console.log('\n请选择要启用的 hooks (回车默认全部启用):');
  const h1 = await ask('  飞书通知 (Stop/Notification/Failure) [Y/n]: ');
  config.hooks.notify = h1.trim().toLowerCase() !== 'n';
  const h2 = await ask('  危险命令拦截 + 飞书告警 [Y/n]: ');
  config.hooks.guard = h2.trim().toLowerCase() !== 'n';
  const h3 = await ask('  Python 代码格式化 [Y/n]: ');
  config.hooks.formatPython = h3.trim().toLowerCase() !== 'n';
  const h4 = await ask('  Commit 前代码审查 [Y/n]: ');
  config.hooks.codeReview = h4.trim().toLowerCase() !== 'n';

  const h5 = await ask('  飞书双向交互 (Stop后继续对话/权限审批) [Y/n]: ');
  config.hooks.interactive = h5.trim().toLowerCase() !== 'n';

  const h6 = await ask('  Write 工具相对路径修复 (子 agent 写文件路径 undefined 修复) [Y/n]: ');
  config.hooks.fixWritePath = h6.trim().toLowerCase() !== 'n';

  if (config.hooks.formatPython) {
    const fmt = await ask('  Python 格式化工具 (black/autopep8) [black]: ');
    if (fmt.trim()) config.pythonFormatter = fmt.trim();
  }

  // 3. Web Dashboard 配置
  console.log('\n--- Web Dashboard 配置 ---');
  const enableDash = await ask('是否启用 Web Dashboard？(y/N): ');
  if (enableDash.trim().toLowerCase() === 'y') {
    const serverUrl = await ask('中央服务器 WebSocket 地址 (如 ws://your-server:3000/ws): ');
    const machineToken = await ask('Machine Token (在中央服务器 MACHINE_TOKENS 环境变量中配置): ');
    config.centralServer = {
      enabled: true,
      url: serverUrl.trim(),
      machineToken: machineToken.trim(),
      machineId: ''
    };
    console.log('✅ Web Dashboard 已启用，daemon 启动后自动连接中央服务器');
  } else {
    config.centralServer = { enabled: false, url: '', machineToken: '', machineId: '' };
  }

  // 4. 保存配置
  saveConfig(config);
  console.log(`\n✅ 配置已保存到 ${path.join(getBaseDir(), 'config.json')}`);

  // 5. 复制 hooks 脚本到 ~/.claude-hooks-feishu/
  const hooksDir = getHooksDir();
  const libDir = path.join(getBaseDir(), 'lib');
  fs.mkdirSync(hooksDir, { recursive: true });
  fs.mkdirSync(libDir, { recursive: true });

  const srcRoot = path.resolve(__dirname, '..');
  // 复制 hooks
  for (const f of ['notify.js', 'guard.js', 'interactive.js', 'format-python.sh', 'code-review.sh', 'fix-write-path.js']) {
    const src = path.join(srcRoot, 'hooks', f);
    const dst = path.join(hooksDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, 0o755);
    }
  }
  // 复制 lib
  for (const f of ['config.js', 'feishu-webhook.js', 'feishu-app.js', 'sender.js', 'ipc.js', 'card-builder.js', 'daemon.js', 'session-registry.js', 'message-queue.js']) {
    const src = path.join(srcRoot, 'lib', f);
    const dst = path.join(libDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  console.log(`✅ Hook 脚本已安装到 ${hooksDir}`);

  // 6. 测试发送
  const doTest = await ask('\n是否发送测试消息? [Y/n]: ');
  if (doTest.trim().toLowerCase() !== 'n') {
    console.log('发送测试消息...');
    try {
      if (config.webhook.enabled && config.webhook.url) {
        const payload = buildCardPayload({ type: 'task_complete', cwd: process.cwd(), detail: '这是一条测试消息' });
        const res = await sendWebhook(config.webhook.url, payload, config.webhook.secret);
        console.log('  Webhook:', res.code === 0 ? '✅ 成功' : `❌ 失败 (${JSON.stringify(res)})`);
      }
      if (config.app.enabled && config.app.appId) {
        const content = buildAppCardContent({ type: 'task_complete', cwd: process.cwd(), detail: '这是一条测试消息' });
        const res = await sendAppMessage(config.app.appId, config.app.appSecret, config.app.receiverId, config.app.receiverType, content);
        console.log('  App:', res.code === 0 ? '✅ 成功' : `❌ 失败 (${JSON.stringify(res)})`);
      }
    } catch (e) {
      console.log('  ❌ 发送失败:', e.message);
    }
  }

  // 7. 注入 hooks 到 ~/.claude/settings.json
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let claudeSettings = {};
  if (fs.existsSync(claudeSettingsPath)) {
    try { claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8')); } catch {}
  }
  if (!claudeSettings.hooks) claudeSettings.hooks = {};

  const hooksBase = getHooksDir();
  const nodeCmd = (script) => `node ${path.join(hooksBase, script)}`;
  const shCmd = (script) => path.join(hooksBase, script);

  if (config.hooks.notify) {
    for (const event of ['Stop', 'Notification']) {
      if (!claudeSettings.hooks[event]) claudeSettings.hooks[event] = [];
      const existing = claudeSettings.hooks[event].find(h =>
        h.hooks?.some(hh => hh.command?.includes('claude-hooks-feishu'))
      );
      if (!existing) {
        claudeSettings.hooks[event].push({
          hooks: [{ type: 'command', command: nodeCmd('notify.js') }]
        });
      }
    }
  }

  if (config.hooks.guard) {
    if (!claudeSettings.hooks.PreToolUse) claudeSettings.hooks.PreToolUse = [];
    const existingGuard = claudeSettings.hooks.PreToolUse.find(h =>
      h.matcher === 'Bash' && h.hooks?.some(hh => hh.command?.includes('guard.js'))
    );
    if (!existingGuard) {
      claudeSettings.hooks.PreToolUse.push({
        matcher: 'Bash',
        hooks: [{ type: 'command', command: nodeCmd('guard.js') }]
      });
    }
  }

  if (config.hooks.formatPython) {
    if (!claudeSettings.hooks.PostToolUse) claudeSettings.hooks.PostToolUse = [];
    const existingFmt = claudeSettings.hooks.PostToolUse.find(h =>
      h.hooks?.some(hh => hh.command?.includes('format-python'))
    );
    if (!existingFmt) {
      claudeSettings.hooks.PostToolUse.push({
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: shCmd('format-python.sh') }]
      });
    }
  }

  if (config.hooks.codeReview) {
    if (!claudeSettings.hooks.PreToolUse) claudeSettings.hooks.PreToolUse = [];
    const existingReview = claudeSettings.hooks.PreToolUse.find(h =>
      h.hooks?.some(hh => hh.command?.includes('code-review'))
    );
    if (!existingReview) {
      claudeSettings.hooks.PreToolUse.push({
        matcher: 'Bash',
        hooks: [{ type: 'command', command: shCmd('code-review.sh') }]
      });
    }
  }

  if (config.hooks.interactive) {
    for (const event of ['Stop', 'Notification']) {
      if (!claudeSettings.hooks[event]) claudeSettings.hooks[event] = [];
      const existing = claudeSettings.hooks[event].find(h =>
        h.hooks?.some(hh => hh.command?.includes('interactive.js'))
      );
      if (!existing) {
        claudeSettings.hooks[event].push({
          hooks: [{ type: 'command', command: nodeCmd('interactive.js') }]
        });
      }
    }
  }

  if (config.hooks.fixWritePath) {
    if (!claudeSettings.hooks.PreToolUse) claudeSettings.hooks.PreToolUse = [];
    const existingFix = claudeSettings.hooks.PreToolUse.find(h =>
      h.hooks?.some(hh => hh.command?.includes('fix-write-path.js'))
    );
    if (!existingFix) {
      claudeSettings.hooks.PreToolUse.push({
        matcher: 'Write',
        hooks: [{ type: 'command', command: nodeCmd('fix-write-path.js') }]
      });
    }
  }

  fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
  fs.writeFileSync(claudeSettingsPath, JSON.stringify(claudeSettings, null, 2), 'utf-8');
  console.log(`✅ Hooks 已注入 ${claudeSettingsPath}`);

  console.log('\n🎉 安装完成! Claude Code 现在会通过飞书通知你。\n');
  console.log('管理命令:');
  console.log('  npx claude-code-hooks-feishu                # 重新配置');
  console.log('  npx claude-code-hooks-feishu --test         # 发送测试消息');
  console.log('  npx claude-code-hooks-feishu --remove       # 卸载');
  console.log('  npx claude-code-hooks-feishu --daemon start # 启动交互守护进程');
  console.log('  npx claude-code-hooks-feishu --daemon stop  # 停止守护进程');
  console.log('  npx claude-code-hooks-feishu --daemon status# 查看状态');
  console.log('  npx claude-code-hooks-feishu --server start # 启动 Web Dashboard');
  console.log('  npx claude-code-hooks-feishu --server stop  # 停止 Web Dashboard');
  console.log('  npx claude-code-hooks-feishu --server status# 查看 Dashboard 状态\n');

  rl.close();
}

// 处理 --test 和 --remove 参数
const args = process.argv.slice(2);
if (args.includes('--test')) {
  const { loadConfig } = require('../lib/config');
  const cfg = loadConfig();
  (async () => {
    console.log('发送测试消息...');
    if (cfg.webhook.enabled) {
      const payload = buildCardPayload({ type: 'task_complete', cwd: process.cwd(), detail: '测试消息' });
      const res = await sendWebhook(cfg.webhook.url, payload, cfg.webhook.secret);
      console.log('Webhook:', res.code === 0 ? '✅' : `❌ ${JSON.stringify(res)}`);
    }
    if (cfg.app.enabled) {
      const content = buildAppCardContent({ type: 'task_complete', cwd: process.cwd(), detail: '测试消息' });
      const res = await sendAppMessage(cfg.app.appId, cfg.app.appSecret, cfg.app.receiverId, cfg.app.receiverType, content);
      console.log('App:', res.code === 0 ? '✅' : `❌ ${JSON.stringify(res)}`);
    }
    if (!cfg.webhook.enabled && !cfg.app.enabled) {
      console.log('未配置任何通知渠道。请先运行 npx claude-code-hooks-feishu 进行配置。');
    }
  })();
} else if (args.includes('--daemon')) {
  const { loadConfig } = require('../lib/config');
  const cfg = loadConfig();
  const sub = args[args.indexOf('--daemon') + 1] || 'status';

  if (sub === 'start') {
    const hasCentralServer = cfg.centralServer?.enabled && cfg.centralServer?.url && cfg.centralServer?.machineToken;
    if (!cfg.app.enabled || !cfg.app.appId) {
      if (!hasCentralServer) {
        console.log('❌ 请先配置飞书应用 (appId/appSecret) 或 centralServer');
        console.log('运行: npx claude-code-hooks-feishu');
        process.exit(1);
      }
    }
    const { startDaemon } = require('../lib/daemon');
    startDaemon(cfg.app.appId, cfg.app.appSecret).catch(e => {
      console.error('启动失败:', e.message);
      process.exit(1);
    });
  } else if (sub === 'stop') {
    const { stopDaemon } = require('../lib/daemon');
    stopDaemon();
  } else {
    const { isRunning, getPidPath, getLogPath } = require('../lib/daemon');
    const running = isRunning();
    console.log(`守护进程状态: ${running ? '✅ 运行中' : '❌ 未运行'}`);
    if (running) {
      const pid = fs.readFileSync(getPidPath(), 'utf-8').trim();
      console.log(`PID: ${pid}`);
    }
    console.log(`日志: ${getLogPath()}`);
  }
} else if (args.includes('--server')) {
  const { loadConfig, getBaseDir } = require('../lib/config');
  const cfg = loadConfig();
  const sub = args[args.indexOf('--server') + 1] || 'status';
  const serverCfg = cfg.server || {};
  const pidPath = path.join(getBaseDir(), 'server.pid');

  if (sub === 'start') {
    const tokens = serverCfg.machineTokens || [];
    if (tokens.length === 0) {
      console.log('⚠️  未配置 server.machineTokens，开发机将无法连接');
      console.log('请在 config.json 的 server.machineTokens 中添加 token');
    }
    // 设置 env 供 relay.js 读取（兼容旧逻辑）
    process.env.MACHINE_TOKENS = tokens.join(',');
    const port = serverCfg.port || 3000;
    const host = serverCfg.host || '0.0.0.0';
    const { startServer } = require('../packages/server/index');
    startServer({ port, host, machineTokens: tokens });
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, String(process.pid));
    process.on('SIGTERM', () => { try { fs.unlinkSync(pidPath); } catch {} process.exit(0); });
    process.on('SIGINT', () => { try { fs.unlinkSync(pidPath); } catch {} process.exit(0); });
  } else if (sub === 'stop') {
    if (!fs.existsSync(pidPath)) { console.log('Server 未运行'); process.exit(0); }
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    try { process.kill(pid, 'SIGTERM'); console.log(`Server 已停止 (PID: ${pid})`); } catch { console.log('Server 已停止（进程不存在）'); }
    try { fs.unlinkSync(pidPath); } catch {}
  } else {
    const running = fs.existsSync(pidPath) && (() => {
      try { process.kill(parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10), 0); return true; } catch { return false; }
    })();
    console.log(`Server 状态: ${running ? '✅ 运行中' : '❌ 未运行'}`);
    if (running) console.log(`PID: ${fs.readFileSync(pidPath, 'utf-8').trim()}`);
    console.log(`端口: ${serverCfg.port || 3000}`);
    console.log(`Machine Tokens: ${(serverCfg.machineTokens || []).length} 个`);
  }
} else if (args.includes('--remove')) {
  const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  if (fs.existsSync(claudeSettingsPath)) {
    let settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'));
    if (settings.hooks) {
      for (const [event, handlers] of Object.entries(settings.hooks)) {
        if (Array.isArray(handlers)) {
          settings.hooks[event] = handlers.filter(h =>
            !h.hooks?.some(hh => hh.command?.includes('claude-hooks-feishu'))
          );
          if (settings.hooks[event].length === 0) delete settings.hooks[event];
        }
      }
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2));
    }
  }
  const baseDir = getBaseDir();
  if (fs.existsSync(baseDir)) fs.rmSync(baseDir, { recursive: true });
  console.log('✅ 已卸载 claude-code-hooks-feishu');
} else {
  main().catch(console.error);
}