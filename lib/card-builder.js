/**
 * 交互卡片构建器
 * 支持卡片按钮回调 + @机器人文字回复 + 私聊文字回复
 */

function timestamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function buildStopCard({ requestId, sessionId, cwd, message, transcriptPath }) {
  const elements = [];

  const infoLines = [`**项目目录**: ${cwd}`, `**时间**: ${timestamp()}`];
  if (sessionId) infoLines.push(`**会话ID**: ${sessionId}`);
  if (transcriptPath) infoLines.push(`**Transcript**: ${transcriptPath}`);
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: infoLines.join('\n') }
  });

  if (message) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `**Claude 回复:**\n${message}` }
    });
  }

  elements.push({ tag: 'hr' });

  // 输入框 + 按钮
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'input',
        name: 'user_input',
        placeholder: { tag: 'plain_text', content: '输入新指令...' },
        width: 'fill'
      }
    ]
  });
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '📤 发送指令' },
        type: 'primary',
        value: { action: 'message', requestId }
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '🔚 结束会话' },
        type: 'default',
        value: { action: 'dismiss', requestId }
      }
    ]
  });

  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: '💬 也可 @机器人 或私聊发送指令' }
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '✅ Claude Code 任务完成' },
      template: 'green'
    },
    elements
  });
}

function buildPermissionCard({ requestId, sessionId, cwd, title, message, notificationType }) {
  const elements = [];

  const infoLines = [`**项目目录**: ${cwd}`, `**时间**: ${timestamp()}`];
  if (sessionId) infoLines.push(`**会话ID**: ${sessionId}`);
  if (notificationType) infoLines.push(`**通知类型**: ${notificationType}`);
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: infoLines.join('\n') }
  });

  if (title) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `**${title}**` }
    });
  }
  if (message) {
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: message }
    });
  }

  elements.push({ tag: 'hr' });

  // 允许/拒绝按钮
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '✅ 允许' },
        type: 'primary',
        value: { action: 'allow', requestId }
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '❌ 拒绝' },
        type: 'danger',
        value: { action: 'deny', requestId }
      }
    ]
  });

  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: '📩 也可 @机器人 回复 "允许"/"拒绝"' }
  });

  return JSON.stringify({
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '⚠️ Claude Code 需要确认' },
      template: 'yellow'
    },
    elements
  });
}

function buildStatusUpdateCard({ originalCard, action, content, operator }) {
  const parsed = typeof originalCard === 'string' ? JSON.parse(originalCard) : originalCard;
  const now = timestamp();
  let statusText = '';
  if (action === 'message') {
    statusText = `💬 **已发送指令**: ${content}\n**操作人**: ${operator} | ${now}`;
  } else if (action === 'allow') {
    statusText = `✅ **已允许** by ${operator} | ${now}`;
  } else if (action === 'deny') {
    statusText = `❌ **已拒绝** by ${operator} | ${now}`;
  } else {
    statusText = `🔚 **已结束会话** by ${operator} | ${now}`;
  }

  parsed.elements = parsed.elements.filter(e => e.tag !== 'action');
  parsed.elements.push({ tag: 'hr' });
  parsed.elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: statusText }
  });

  return JSON.stringify(parsed);
}

module.exports = { buildStopCard, buildPermissionCard, buildStatusUpdateCard };
