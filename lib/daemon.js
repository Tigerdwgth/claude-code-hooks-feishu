const fs = require('node:fs');
const path = require('node:path');
const { getBaseDir } = require('./config');
const { writeResponse, listPendingRequests, respPath } = require('./ipc');
const { enqueue, dequeue, peekQueue } = require('./message-queue');
const { listActiveSessions, cleanExpiredSessions } = require('./session-registry');

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
    const btnValue = data.action?.value || {};
    const { action, requestId: cardRequestId } = btnValue;
    if (!action) return;

    // 处理 session 选择卡片的路由按钮
    if (action === 'route') {
      const { targetMachine, targetSession } = btnValue;
      if (targetMachine && targetSession) {
        // 找到未路由的消息，重新路由
        const unrouted = peekQueue('', '');
        if (unrouted.length > 0) {
          const msg = dequeue('', '');
          if (msg) {
            enqueue({
              targetMachine,
              targetSession,
              content: msg.content,
              action: msg.action,
              senderId: msg.senderId
            });
            log(`Routed message to ${targetMachine}:${targetSession}: "${msg.content}"`);
          }
        }
      }
      return;
    }

    const operatorId = data.operator?.open_id || data.operator?.user_id || 'unknown';

    // 获取输入框内容（尝试多种字段名）
    const formValue = data.form_value || {};
    const inputContent = formValue.user_input || Object.values(formValue)[0] || '';

    log(`Card action raw: action=${action}, cardReqId=${cardRequestId}, form_value=${JSON.stringify(formValue)}`);

    // 找到目标 request：优先匹配卡片上的 requestId，否则 fallback 到最新的 pending
    const pending = listPendingRequests()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    let targetId = cardRequestId;
    if (pending.length > 0) {
      const exact = pending.find(r => r.requestId === cardRequestId);
      if (!exact) {
        targetId = pending[0].requestId;
        log(`Card requestId ${cardRequestId} not found in pending, fallback to ${targetId}`);
      }
    }

    if (!targetId) return;

    const resp = { requestId: targetId, action, operatorId };
    if (action === 'message') {
      resp.content = inputContent;
    }

    writeResponse(targetId, resp);
    log(`Card action: ${action} for ${targetId} by ${operatorId}`);
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

    const chatType = data.message?.chat_type || data.chat_type;
    const rawContent = JSON.parse(data.message.content || '{}');
    let text = rawContent.text || '';
    if (!text.trim()) return;

    const hasMention = /@_user_\d+/.test(text);
    if (chatType === 'group' && !hasMention) return;
    text = text.replace(/@_user_\d+/g, '').trim();
    if (!text) return;

    const senderId = data.sender?.sender_id?.open_id || 'unknown';
    const messageId = data.message?.message_id;

    // 1. 优先匹配 pending request
    const pending = listPendingRequests()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (pending.length > 0) {
      const target = pending[0];
      const action = resolveAction(text, target.type);
      const resp = { requestId: target.requestId, action, operatorId: senderId };
      if (action === 'message') resp.content = text;
      writeResponse(target.requestId, resp);
      log(`Message "${text}" → action:${action} matched to ${target.requestId} by ${senderId}`);
      const emoji = action === 'allow' ? 'OK' : action === 'deny' ? 'CrossMark' : 'DONE';
      addReaction(messageId, emoji);
      return;
    }

    // 2. 无 pending request → 入队
    const sessions = listActiveSessions();
    if (sessions.length === 0) {
      log(`Message from ${senderId} but no active sessions: "${text}"`);
      addReaction(messageId, 'Hourglass');
      return;
    }

    if (sessions.length === 1) {
      enqueue({
        targetMachine: sessions[0].machineId,
        targetSession: sessions[0].sessionId,
        content: text,
        action: 'message',
        senderId
      });
      log(`Message "${text}" queued for ${sessions[0].machineId}:${sessions[0].sessionId}`);
      addReaction(messageId, 'DONE');
    } else {
      // 多个 session，检查数字前缀
      const numMatch = text.match(/^(\d+)\s+([\s\S]+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < sessions.length) {
          const target = sessions[idx];
          enqueue({
            targetMachine: target.machineId,
            targetSession: target.sessionId,
            content: numMatch[2],
            action: 'message',
            senderId
          });
          log(`Message routed to session #${idx + 1}: ${target.machineId}:${target.sessionId}`);
          addReaction(messageId, 'DONE');
          return;
        }
      }

      // 入队为未路由消息，发 session 选择卡片
      enqueue({
        targetMachine: '',
        targetSession: '',
        content: text,
        action: 'message',
        senderId
      });
      log(`Multiple sessions, queued unrouted message and sending picker card`);
      addReaction(messageId, 'Hourglass');
      sendPickerCard(sessions, text);
    }
  } catch (e) {
    log(`Message handler error: ${e.message}`);
  }
}

async function sendPickerCard(sessions, originalText) {
  try {
    const { loadConfig } = require('./config');
    const { buildSessionPickerCard } = require('./card-builder');
    const config = loadConfig();
    const cardContent = buildSessionPickerCard({ sessions, originalText });
    if (config.app.enabled && config.app.appId) {
      const { sendAppMessage } = require('./feishu-app');
      await sendAppMessage(
        config.app.appId, config.app.appSecret,
        config.app.receiverId, config.app.receiverType,
        cardContent
      );
    }
  } catch (e) {
    log(`sendPickerCard failed: ${e.message}`);
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

  // 启动 Web Dashboard 连接（如已配置）
  const cfg = loadConfig();
  if (cfg.centralServer?.enabled && cfg.centralServer?.url) {
    const { WsClient } = require('./ws-client');
    const { PtyManager } = require('./pty-manager');
    const ptyMgr = new PtyManager();
    const wsClientDash = new WsClient({
      url: cfg.centralServer.url,
      machineToken: cfg.centralServer.machineToken,
      machineId: cfg.centralServer.machineId || undefined,
      ptyManager: ptyMgr
    });
    wsClientDash.connect();
    log('Web Dashboard ws-client started');
    process.on('SIGTERM', () => { wsClientDash.disconnect(); ptyMgr.destroyAll(); });
    process.on('SIGINT', () => { wsClientDash.disconnect(); ptyMgr.destroyAll(); });
  }

  process.on('SIGTERM', () => {
    clearInterval(cleanupInterval);
    log('Received SIGTERM, shutting down');
    removePid();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    clearInterval(cleanupInterval);
    log('Received SIGINT, shutting down');
    removePid();
    process.exit(0);
  });

  // 每小时清理过期 session
  const cleanupInterval = setInterval(() => {
    try {
      cleanExpiredSessions();
      log('Cleaned expired sessions');
    } catch (e) {
      log(`Session cleanup error: ${e.message}`);
    }
  }, 60 * 60 * 1000);

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
  sendPickerCard,
  addReaction,
  writePid,
  removePid,
  log
};
