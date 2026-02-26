#!/usr/bin/env node
const crypto = require('node:crypto');
const { loadConfig } = require('../lib/config');
const { send } = require('../lib/sender');
const { buildPermissionCard } = require('../lib/card-builder');
const { writeRequest, pollResponse } = require('../lib/ipc');
const { sendAppMessage } = require('../lib/feishu-app');
const { sendWebhook } = require('../lib/feishu-webhook');
const { isRunning } = require('../lib/daemon');

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
      await sendAppMessage(
        config.app.appId, config.app.appSecret,
        config.app.receiverId, config.app.receiverType,
        cardContent
      );
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
