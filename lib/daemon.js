const fs = require('node:fs');
const path = require('node:path');
const { getBaseDir } = require('./config');
const { writeResponse, listPendingRequests, respPath } = require('./ipc');

function getPidPath() {
  return path.join(getBaseDir(), 'daemon.pid');
}

function getLogPath() {
  return path.join(getBaseDir(), 'daemon.log');
}

function isRunning() {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return false;
  const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    try { fs.unlinkSync(pidPath); } catch {}
    return false;
  }
}

function writePid() {
  fs.mkdirSync(getBaseDir(), { recursive: true });
  fs.writeFileSync(getPidPath(), String(process.pid), 'utf-8');
}

function removePid() {
  try { fs.unlinkSync(getPidPath()); } catch {}
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(getLogPath(), line);
  } catch {}
}

function handleCardAction(data) {
  try {
    // card.action.trigger 回调中 action.value 已经是对象
    const btnValue = data.action?.value || {};
    const { action, requestId } = btnValue;
    if (!requestId) return;

    const operatorId = data.operator?.open_id || data.operator?.user_id || 'unknown';
    const resp = { requestId, action, operatorId };

    if (action === 'message') {
      resp.content = data.form_value?.user_input || '';
    }

    writeResponse(requestId, resp);
    log(`Card action: ${action} for ${requestId} by ${operatorId}`);
  } catch (e) {
    log(`Card action error: ${e.message}`);
  }
}

// 关键词 → 动作映射
const KEYWORD_ACTIONS = {
  '允许': 'allow', '同意': 'allow', '执行': 'allow', '放行': 'allow',
  'y': 'allow', 'yes': 'allow', 'ok': 'allow',
  '拒绝': 'deny', '禁止': 'deny', '取消': 'deny',
  'n': 'deny', 'no': 'deny',
};

function resolveAction(text, requestType) {
  const trimmed = text.trim().toLowerCase();
  if (KEYWORD_ACTIONS[trimmed]) return KEYWORD_ACTIONS[trimmed];
  return 'message';
}

// larkClient 由 startDaemon 初始化
let larkClient = null;

async function addReaction(messageId, emoji) {
  if (!larkClient || !messageId) return;
  try {
    await larkClient.im.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emoji } }
    });
    log(`Reaction ${emoji} added to ${messageId}`);
  } catch (e) {
    log(`Reaction failed: ${e.message}`);
  }
}

function handleMessage(data) {
  try {
    const msgType = data.message?.message_type;
    if (msgType !== 'text') return;

    const chatType = data.message?.chat_type; // "p2p" 或 "group"
    const mentions = data.message?.mentions || [];

    // 群聊只接受 @机器人 的消息，私聊直接接受
    if (chatType === 'group' && mentions.length === 0) {
      return; // 群里普通消息，忽略
    }

    const content = JSON.parse(data.message.content || '{}');
    let text = content.text || '';
    if (!text.trim()) return;

    // 去掉 @mention 占位符（如 @_user_1）
    for (const m of mentions) {
      if (m.key) text = text.replace(m.key, '').trim();
    }
    if (!text) return;

    const senderId = data.sender?.sender_id?.open_id || 'unknown';
    const messageId = data.message?.message_id;

    const pending = listPendingRequests()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (pending.length === 0) {
      log(`Message from ${senderId} but no pending requests: "${text}"`);
      return;
    }

    // 匹配最新的 pending request
    const target = pending[0];
    const action = resolveAction(text, target.type);

    const resp = {
      requestId: target.requestId,
      action,
      operatorId: senderId
    };
    if (action === 'message') {
      resp.content = text;
    }

    writeResponse(target.requestId, resp);
    log(`Message "${text}" → action:${action} matched to ${target.requestId} by ${senderId}`);

    // 添加表情确认收到
    const emoji = action === 'allow' ? 'OK' : action === 'deny' ? 'CrossMark' : 'DONE';
    addReaction(messageId, emoji);
  } catch (e) {
    log(`Message handler error: ${e.message}`);
  }
}

async function startDaemon(appId, appSecret) {
  if (isRunning()) {
    console.log('守护进程已在运行');
    return;
  }

  const lark = require('@larksuiteoapi/node-sdk');

  larkClient = new lark.Client({
    appId,
    appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.Feishu
  });

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': (data) => {
      log(`Received message event`);
      handleMessage(data);
      return {};
    },
    'card.action.trigger': (data) => {
      log(`Received card.action.trigger event`);
      handleCardAction(data);
      return {};
    }
  });

  const wsClient = new lark.WSClient({
    appId,
    appSecret,
    loggerLevel: lark.LoggerLevel.WARN
  });

  writePid();
  log(`Daemon started, PID: ${process.pid}`);
  console.log(`守护进程已启动 (PID: ${process.pid})`);

  process.on('SIGTERM', () => {
    log('Received SIGTERM, shutting down');
    removePid();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    log('Received SIGINT, shutting down');
    removePid();
    process.exit(0);
  });

  await wsClient.start({ eventDispatcher });
}

function stopDaemon() {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) {
    console.log('守护进程未运行');
    return false;
  }
  const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
  try {
    process.kill(pid, 'SIGTERM');
    removePid();
    console.log(`守护进程已停止 (PID: ${pid})`);
    return true;
  } catch {
    removePid();
    console.log('守护进程已停止（进程不存在）');
    return false;
  }
}

module.exports = {
  startDaemon,
  stopDaemon,
  isRunning,
  getPidPath,
  getLogPath,
  handleCardAction,
  handleMessage,
  addReaction,
  writePid,
  removePid,
  log
};
