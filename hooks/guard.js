#!/usr/bin/env node
const crypto = require('node:crypto');
const { loadConfig } = require('../lib/config');
const { send } = require('../lib/sender');
const { buildPermissionCard } = require('../lib/card-builder');
const { writeRequest, pollResponse, updateRequest } = require('../lib/ipc');
const { sendAppMessage } = require('../lib/feishu-app');
const { sendWebhook } = require('../lib/feishu-webhook');
const { isRunning } = require('../lib/daemon');

const os = require('node:os');

// 受保护的系统/用户关键目录
const PROTECTED_PATHS = [
  '/', '/bin', '/boot', '/dev', '/etc', '/lib', '/lib64',
  '/opt', '/proc', '/root', '/run', '/sbin', '/srv', '/sys',
  '/usr', '/var', os.homedir()
];

/**
 * 判断 rm -rf 是否危险：只有删除系统目录或用户主目录才拦截
 * 普通的 rm -rf some_dir 放行
 */
function isDangerousRm(command) {
  // 匹配 rm 命令中包含 -r/-rf/-Rf 等递归删除标志
  if (!/\brm\b/.test(command)) return null;
  if (!/\s-[a-zA-Z]*r[a-zA-Z]*f?/.test(command) && !/\s-[a-zA-Z]*f[a-zA-Z]*r/.test(command)) return null;

  // 提取 rm 后面的路径参数（跳过 flags）
  const parts = command.split(/[;&|]/).map(s => s.trim());
  for (const part of parts) {
    if (!/\brm\b/.test(part)) continue;
    const tokens = part.split(/\s+/);
    for (const token of tokens) {
      if (token === 'rm' || token.startsWith('-')) continue;
      // 解析路径
      const resolved = token.startsWith('/')
        ? token.replace(/\/+$/, '') || '/'
        : null;
      if (!resolved) continue;
      // 检查是否是受保护路径或其父路径
      for (const p of PROTECTED_PATHS) {
        if (resolved === p || p.startsWith(resolved + '/')) {
          return `rm -rf 目标为受保护路径: ${token}`;
        }
      }
    }
  }
  return null;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const command = data.tool_input?.command || '';
  if (!command) process.exit(0);

  const config = loadConfig();
  const patterns = config.dangerousPatterns || [];

  let matched = null;
  for (const pattern of patterns) {
    if (command.includes(pattern)) {
      matched = pattern;
      break;
    }
  }

  // rm -rf 智能检测：只拦截删除系统/用户主目录
  if (!matched) {
    matched = isDangerousRm(command);
  }

  if (!matched) process.exit(0);

  // daemon 未运行时，直接拦截并发告警（降级行为）
  if (!isRunning()) {
    const fields = [
      { label: '命令', value: command },
      { label: '匹配规则', value: matched }
    ];
    if (data.session_id) fields.push({ label: '会话ID', value: data.session_id });
    await send({ type: 'danger_blocked', cwd: data.cwd || process.cwd(), fields });
    process.stderr.write(`已拦截危险命令: "${command}" (匹配规则: ${matched})`);
    process.exit(2);
    return;
  }

  // daemon 运行中，发交互卡片让用户决定
  const requestId = crypto.randomUUID();
  const cwd = data.cwd || process.cwd();
  const sessionId = data.session_id || '';

  const cardContent = buildPermissionCard({
    requestId,
    sessionId,
    cwd,
    title: '⚠️ 检测到危险命令',
    message: `**命令**: \`${command}\`\n**匹配规则**: \`${matched}\``,
    notificationType: 'danger_command'
  });

  writeRequest(requestId, {
    requestId,
    type: 'danger',
    sessionId,
    hookEvent: 'PreToolUse',
    command,
    pattern: matched
  });

  if (config.app.enabled && config.app.appId) {
    try {
      const sendResult = await sendAppMessage(
        config.app.appId, config.app.appSecret,
        config.app.receiverId, config.app.receiverType,
        cardContent
      );
      const msgId = sendResult?.data?.message_id;
      if (msgId) updateRequest(requestId, { messageId: msgId });
    } catch (e) {
      console.error('[guard] App send failed:', e.message);
    }
  }
  if (config.webhook.enabled && config.webhook.url) {
    try {
      const payload = { msg_type: 'interactive', card: JSON.parse(cardContent) };
      await sendWebhook(config.webhook.url, payload, config.webhook.secret);
    } catch (e) {
      console.error('[guard] Webhook send failed:', e.message);
    }
  }

  // 等待用户响应，超时60秒默认拦截
  const response = await pollResponse(requestId, { timeoutMs: 60000, intervalMs: 500 });

  if (response && response.action === 'allow') {
    process.exit(0);
  } else {
    const reason = response ? '用户通过飞书拒绝了此危险命令' : '危险命令确认超时，已自动拦截';
    process.stderr.write(`${reason}: "${command}"`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[guard]', e.message);
  process.exit(0);
});
