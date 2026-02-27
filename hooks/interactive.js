#!/usr/bin/env node
const crypto = require('node:crypto');
const { loadConfig } = require('../lib/config');
const { buildStopCard, buildPermissionCard } = require('../lib/card-builder');
const { writeRequest, pollResponse, updateRequest } = require('../lib/ipc');
const { sendAppMessage } = require('../lib/feishu-app');
const { sendWebhook } = require('../lib/feishu-webhook');
const { resolveEventType } = require('../lib/sender');
const { isRunning } = require('../lib/daemon');
const { getMachineId } = require('../lib/config');
const { registerSession } = require('../lib/session-registry');
const { dequeue } = require('../lib/message-queue');

function generateRequestId() {
  return crypto.randomUUID();
}

function buildInteractivePayload(data) {
  const hookEvent = data.hook_event_name || 'Stop';
  const requestId = generateRequestId();
  const sessionId = data.session_id || '';
  const cwd = data.cwd || process.cwd();
  const machineId = getMachineId();

  let cardContent;
  if (hookEvent === 'Stop') {
    cardContent = buildStopCard({
      requestId, sessionId, machineId, cwd,
      message: data.last_assistant_message || '',
      transcriptPath: data.transcript_path
    });
  } else {
    cardContent = buildPermissionCard({
      requestId, sessionId, machineId, cwd,
      title: data.title || '',
      message: data.message || '',
      notificationType: data.notification_type || ''
    });
  }

  return { cardContent, requestId, hookEvent, sessionId, machineId, cwd };
}

function processResponse(hookEvent, response) {
  if (!response) return null;

  if (hookEvent === 'Stop') {
    if (response.action === 'message' && response.content) {
      return {
        decision: 'block',
        reason: `用户通过飞书下达新指令: ${response.content}`
      };
    }
    return null;
  }

  if (response.action === 'allow') {
    return { exitCode: 0 };
  }
  if (response.action === 'deny') {
    return { exitCode: 2, stderr: '用户通过飞书拒绝了此操作' };
  }
  return null;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const hookEvent = data.hook_event_name || 'Stop';

  const machineId = getMachineId();
  const sessionId = data.session_id || '';
  const cwd = data.cwd || process.cwd();

  // 注册/更新 session
  registerSession({ machineId, sessionId, cwd, pid: process.pid });

  if (data.stop_hook_active) {
    process.exit(0);
    return;
  }

  const config = loadConfig();

  if (!isRunning()) {
    const { send } = require('../lib/sender');
    const type = resolveEventType(hookEvent, {});
    const { buildFields } = require('./notify');
    const fields = buildFields(hookEvent, data);
    await send({ type, cwd: data.cwd || process.cwd(), fields });
    process.exit(0);
    return;
  }

  // 检查队列中是否有属于本 session 的消息
  if (hookEvent === 'Stop') {
    const queued = dequeue(machineId, sessionId);
    if (queued) {
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `用户通过飞书下达新指令: ${queued.content}`
      }));
      process.exit(0);
      return;
    }
  }

  const { cardContent, requestId } = buildInteractivePayload(data);

  writeRequest(requestId, {
    requestId,
    type: hookEvent === 'Stop' ? 'stop' : 'permission',
    machineId,
    sessionId: data.session_id || '',
    hookEvent
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
      console.error('[interactive] App send failed:', e.message);
    }
  }
  if (config.webhook.enabled && config.webhook.url) {
    try {
      const payload = { msg_type: 'interactive', card: JSON.parse(cardContent) };
      await sendWebhook(config.webhook.url, payload, config.webhook.secret);
    } catch (e) {
      console.error('[interactive] Webhook send failed:', e.message);
    }
  }

  const timeoutMs = 86400000; // 24小时，等用户回复
  const response = await pollResponse(requestId, { timeoutMs, intervalMs: 500 });

  const result = processResponse(hookEvent, response);

  if (!result) {
    process.exit(0);
    return;
  }

  if (result.decision === 'block') {
    process.stdout.write(JSON.stringify({
      decision: result.decision,
      reason: result.reason
    }));
    process.exit(0);
  } else if (result.exitCode === 2) {
    process.stderr.write(result.stderr || '');
    process.exit(2);
  } else {
    process.exit(result.exitCode || 0);
  }
}

module.exports = { buildInteractivePayload, processResponse, generateRequestId };

if (require.main === module) {
  main().catch((e) => {
    console.error('[interactive]', e.message);
    process.exit(0);
  });
}
