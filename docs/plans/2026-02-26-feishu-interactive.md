# 飞书双向交互 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 通过飞书实现与 Claude Code 的双向交互——Stop 后继续下达指令、权限审批一键允许/拒绝。

**Architecture:** 常驻 WebSocket 守护进程接收飞书回调，交互式 Hook 通过文件 IPC 与守护进程通信。Hook 发送交互卡片后轮询响应文件，Daemon 收到飞书回调后写入响应文件。

**Tech Stack:** Node.js, @larksuiteoapi/node-sdk (WSClient + EventDispatcher), 飞书交互卡片 v2

---

## Task 0: 移除 notify.js 消息截断

**Files:**
- Modify: `hooks/notify.js:4-7,26,34-35`
- Test: `tests/notify.test.js` (新建)

**Step 1: 写失败测试**

创建 `tests/notify.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

// 直接测试 buildFields 逻辑（从 notify.js 提取）
// 先验证当前 notify.js 不截断长文本
test('notify should not truncate long messages', () => {
  // 模拟一个超长的 assistant message
  const longMsg = 'A'.repeat(1000);
  const data = {
    hook_event_name: 'Stop',
    session_id: 'test-session',
    last_assistant_message: longMsg,
    transcript_path: '/tmp/transcript.jsonl'
  };
  // 将在 Step 3 中 require 并测试
  const { buildFields } = require('../hooks/notify');
  const fields = buildFields('Stop', data);
  const msgField = fields.find(f => f.label === 'Claude 回复');
  assert.ok(msgField, '应包含 Claude 回复字段');
  assert.strictEqual(msgField.value, longMsg, '不应截断消息');
  assert.strictEqual(msgField.value.length, 1000);
});

test('notify should not truncate tool input', () => {
  const longCmd = 'echo ' + 'x'.repeat(500);
  const data = {
    hook_event_name: 'PostToolUseFailure',
    tool_name: 'Bash',
    tool_input: { command: longCmd },
    error: 'E'.repeat(500)
  };
  const { buildFields } = require('../hooks/notify');
  const fields = buildFields('PostToolUseFailure', data);
  const inputField = fields.find(f => f.label === '输入');
  assert.ok(inputField);
  assert.strictEqual(inputField.value, longCmd, '不应截断输入');
  const errorField = fields.find(f => f.label === '错误');
  assert.strictEqual(errorField.value, 'E'.repeat(500), '不应截断错误');
});
```

**Step 2: 运行测试验证失败**

Run: `cd /share/geshijia/claude-code-hooks-feishu && node --test tests/notify.test.js`
Expected: FAIL — buildFields 未导出，且当前有 truncate

**Step 3: 修改 notify.js**

1. 删除 `truncate()` 函数（第4-7行）
2. 修改 `buildFields` 中所有 `truncate()` 调用为直接使用原始值
3. 修改 `extractToolInput` 中的 `.slice(0, 200)` 为不限制
4. 将 `buildFields` 和 `extractToolInput` 导出
5. 将 "Claude 回复摘要" 改为 "Claude 回复"

修改后的 `hooks/notify.js`:

```javascript
#!/usr/bin/env node
const { resolveEventType, send } = require('../lib/sender');

function extractToolInput(data) {
  const input = data.tool_input || {};
  if (input.command) return input.command;
  if (input.file_path) return input.file_path;
  if (input.pattern) return input.pattern;
  if (input.query) return input.query;
  if (input.url) return input.url;
  return JSON.stringify(input);
}

function buildFields(hookEvent, data) {
  const fields = [];
  const sid = data.session_id;
  if (sid) fields.push({ label: '会话ID', value: sid });

  if (hookEvent === 'Stop') {
    const msg = data.last_assistant_message;
    if (msg) fields.push({ label: 'Claude 回复', value: msg });
    if (data.transcript_path) fields.push({ label: 'Transcript', value: data.transcript_path });
  } else if (hookEvent === 'Notification') {
    if (data.title) fields.push({ label: '标题', value: data.title });
    if (data.message) fields.push({ label: '内容', value: data.message });
    if (data.notification_type) fields.push({ label: '通知类型', value: data.notification_type });
  } else if (hookEvent === 'PostToolUseFailure') {
    if (data.tool_name) fields.push({ label: '工具', value: data.tool_name });
    fields.push({ label: '输入', value: extractToolInput(data) });
    if (data.error) fields.push({ label: '错误', value: data.error });
  }

  return fields;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch { /* stdin 可能为空 */ }

  const hookEvent = data.hook_event_name || 'Stop';
  const cwd = data.cwd || process.cwd();
  const type = resolveEventType(hookEvent, {});
  const fields = buildFields(hookEvent, data);

  await send({ type, cwd, fields });
}

// 导出供测试使用
module.exports = { buildFields, extractToolInput };

if (require.main === module) {
  main().catch((e) => console.error('[notify]', e.message));
}
```

**Step 4: 运行测试验证通过**

Run: `cd /share/geshijia/claude-code-hooks-feishu && node --test tests/notify.test.js`
Expected: PASS

**Step 5: 运行全部测试确保无回归**

Run: `cd /share/geshijia/claude-code-hooks-feishu && node --test tests/`
Expected: 全部 PASS

**Step 6: 提交**

```bash
cd /share/geshijia/claude-code-hooks-feishu
git add hooks/notify.js tests/notify.test.js
git commit -m "fix: 移除消息截断，完整显示所有通知内容"
```

---

## Task 1: 文件 IPC 模块 (`lib/ipc.js`)

**Files:**
- Create: `lib/ipc.js`
- Test: `tests/ipc.test.js` (新建)

**Step 1: 写失败测试**

创建 `tests/ipc.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { writeRequest, writeResponse, pollResponse, IPC_DIR } = require('../lib/ipc');

// 使用临时目录
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpDir;

test('writeRequest creates request file with correct content', () => {
  const reqId = 'test-req-001';
  const data = { requestId: reqId, type: 'stop', sessionId: 'sess-1' };
  const filePath = writeRequest(reqId, data);
  assert.ok(fs.existsSync(filePath));
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.strictEqual(content.requestId, reqId);
  assert.strictEqual(content.type, 'stop');
});

test('writeResponse creates response file', () => {
  const reqId = 'test-req-002';
  const data = { requestId: reqId, action: 'allow' };
  const filePath = writeResponse(reqId, data);
  assert.ok(fs.existsSync(filePath));
  const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  assert.strictEqual(content.action, 'allow');
});

test('pollResponse resolves when response file exists', async () => {
  const reqId = 'test-req-003';
  // 先写入响应文件
  writeResponse(reqId, { requestId: reqId, action: 'message', content: 'hello' });
  const result = await pollResponse(reqId, { timeoutMs: 2000, intervalMs: 100 });
  assert.strictEqual(result.action, 'message');
  assert.strictEqual(result.content, 'hello');
});

test('pollResponse returns null on timeout', async () => {
  const reqId = 'test-req-never-exists';
  const result = await pollResponse(reqId, { timeoutMs: 500, intervalMs: 100 });
  assert.strictEqual(result, null);
});

test('pollResponse cleans up files after reading', async () => {
  const reqId = 'test-req-cleanup';
  const reqPath = writeRequest(reqId, { requestId: reqId, type: 'stop' });
  writeResponse(reqId, { requestId: reqId, action: 'allow' });
  await pollResponse(reqId, { timeoutMs: 1000, intervalMs: 100 });
  // 请求和响应文件都应被清理
  assert.ok(!fs.existsSync(reqPath));
});
```

**Step 2: 运行测试验证失败**

Run: `node --test tests/ipc.test.js`
Expected: FAIL — lib/ipc.js 不存在

**Step 3: 实现 `lib/ipc.js`**

```javascript
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULT_IPC_DIR = path.join(os.tmpdir(), 'claude-hooks-feishu');

function getIpcDir() {
  return process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR || DEFAULT_IPC_DIR;
}

function ensureDir() {
  const dir = getIpcDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function reqPath(requestId) {
  return path.join(getIpcDir(), `req-${requestId}.json`);
}

function respPath(requestId) {
  return path.join(getIpcDir(), `resp-${requestId}.json`);
}

function writeRequest(requestId, data) {
  const dir = ensureDir();
  const filePath = reqPath(requestId);
  fs.writeFileSync(filePath, JSON.stringify({ ...data, timestamp: Date.now() }), 'utf-8');
  return filePath;
}

function writeResponse(requestId, data) {
  const dir = ensureDir();
  const filePath = respPath(requestId);
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  return filePath;
}

function pollResponse(requestId, { timeoutMs = 300000, intervalMs = 500 } = {}) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const rp = respPath(requestId);
      if (fs.existsSync(rp)) {
        try {
          const content = JSON.parse(fs.readFileSync(rp, 'utf-8'));
          // 清理文件
          try { fs.unlinkSync(rp); } catch {}
          try { fs.unlinkSync(reqPath(requestId)); } catch {}
          resolve(content);
          return;
        } catch {}
      }
      if (Date.now() >= deadline) {
        // 超时清理请求文件
        try { fs.unlinkSync(reqPath(requestId)); } catch {}
        resolve(null);
        return;
      }
      setTimeout(check, intervalMs);
    };
    check();
  });
}

function listPendingRequests() {
  const dir = getIpcDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('req-') && f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

module.exports = {
  writeRequest,
  writeResponse,
  pollResponse,
  listPendingRequests,
  getIpcDir,
  reqPath,
  respPath,
  IPC_DIR: DEFAULT_IPC_DIR
};
```

**Step 4: 运行测试验证通过**

Run: `node --test tests/ipc.test.js`
Expected: 全部 PASS

**Step 5: 提交**

```bash
git add lib/ipc.js tests/ipc.test.js
git commit -m "feat: 添加文件 IPC 模块用于 hook-daemon 通信"
```

---

## Task 2: 交互卡片构建器 (`lib/card-builder.js`)

**Files:**
- Create: `lib/card-builder.js`
- Test: `tests/card-builder.test.js` (新建)

**Step 1: 写失败测试**

创建 `tests/card-builder.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { buildStopCard, buildPermissionCard, buildStatusUpdateCard } = require('../lib/card-builder');

test('buildStopCard contains input and buttons', () => {
  const card = buildStopCard({
    requestId: 'req-001',
    sessionId: 'sess-1',
    cwd: '/project',
    message: 'Task completed successfully',
    transcriptPath: '/tmp/transcript.jsonl'
  });
  const parsed = JSON.parse(card);
  assert.ok(parsed.header);
  assert.strictEqual(parsed.header.template, 'green');
  // 应包含 Claude 回复全文
  const content = JSON.stringify(parsed);
  assert.ok(content.includes('Task completed successfully'));
  // 应包含按钮
  assert.ok(content.includes('发送指令'));
  assert.ok(content.includes('结束会话'));
});

test('buildStopCard includes full long message without truncation', () => {
  const longMsg = 'X'.repeat(2000);
  const card = buildStopCard({
    requestId: 'req-002',
    sessionId: 'sess-2',
    cwd: '/project',
    message: longMsg
  });
  const content = JSON.stringify(JSON.parse(card));
  assert.ok(content.includes(longMsg), '应包含完整长消息');
});

test('buildPermissionCard contains allow/deny buttons', () => {
  const card = buildPermissionCard({
    requestId: 'req-003',
    sessionId: 'sess-3',
    cwd: '/project',
    title: 'Claude Code 需要确认',
    message: '是否允许执行 rm -rf /tmp/test?',
    notificationType: 'permission_prompt'
  });
  const parsed = JSON.parse(card);
  assert.strictEqual(parsed.header.template, 'yellow');
  const content = JSON.stringify(parsed);
  assert.ok(content.includes('允许'));
  assert.ok(content.includes('拒绝'));
  assert.ok(content.includes('rm -rf /tmp/test'));
});

test('buildStatusUpdateCard shows action result', () => {
  const card = buildStatusUpdateCard({
    originalCard: buildStopCard({
      requestId: 'req-004',
      sessionId: 'sess-4',
      cwd: '/project',
      message: 'Done'
    }),
    action: 'message',
    content: '继续优化代码',
    operator: '葛士嘉'
  });
  const parsed = JSON.parse(card);
  const text = JSON.stringify(parsed);
  assert.ok(text.includes('继续优化代码'));
  assert.ok(text.includes('葛士嘉'));
});
```

**Step 2: 运行测试验证失败**

Run: `node --test tests/card-builder.test.js`
Expected: FAIL — lib/card-builder.js 不存在

**Step 3: 实现 `lib/card-builder.js`**

```javascript
/**
 * 交互卡片构建器
 * 构建飞书交互卡片 JSON，包含按钮和输入框
 */

function timestamp() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function buildStopCard({ requestId, sessionId, cwd, message, transcriptPath }) {
  const elements = [];

  // 基本信息
  const infoLines = [`**项目目录**: ${cwd}`, `**时间**: ${timestamp()}`];
  if (sessionId) infoLines.push(`**会话ID**: ${sessionId}`);
  if (transcriptPath) infoLines.push(`**Transcript**: ${transcriptPath}`);
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: infoLines.join('\n') }
  });

  // Claude 回复（完整显示）
  if (message) {
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: `**Claude 回复:**\n${message}` }
    });
  }

  // 分隔线
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
        value: JSON.stringify({ action: 'message', requestId })
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '🔚 结束会话' },
        type: 'default',
        value: JSON.stringify({ action: 'dismiss', requestId })
      }
    ]
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
  elements.push({
    tag: 'action',
    actions: [
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '✅ 允许' },
        type: 'primary',
        value: JSON.stringify({ action: 'allow', requestId })
      },
      {
        tag: 'button',
        text: { tag: 'plain_text', content: '❌ 拒绝' },
        type: 'danger',
        value: JSON.stringify({ action: 'deny', requestId })
      }
    ]
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

  // 移除按钮，添加状态
  parsed.elements = parsed.elements.filter(e => e.tag !== 'action');
  parsed.elements.push({ tag: 'hr' });
  parsed.elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: statusText }
  });

  return JSON.stringify(parsed);
}

module.exports = { buildStopCard, buildPermissionCard, buildStatusUpdateCard };
```

**Step 4: 运行测试验证通过**

Run: `node --test tests/card-builder.test.js`
Expected: 全部 PASS

**Step 5: 提交**

```bash
git add lib/card-builder.js tests/card-builder.test.js
git commit -m "feat: 添加交互卡片构建器（Stop输入框+权限审批按钮）"
```

---

## Task 3: WebSocket 守护进程 (`lib/daemon.js`)

**Files:**
- Create: `lib/daemon.js`
- Modify: `package.json` (添加 @larksuiteoapi/node-sdk 依赖)
- Test: `tests/daemon.test.js` (新建)

**Step 1: 安装依赖**

```bash
cd /share/geshijia/claude-code-hooks-feishu
npm install @larksuiteoapi/node-sdk
```

**Step 2: 写失败测试**

创建 `tests/daemon.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-test-'));
process.env.CLAUDE_HOOKS_FEISHU_HOME = tmpDir;
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = path.join(tmpDir, 'ipc');

const { handleCardAction, handleMessage, getPidPath, isRunning } = require('../lib/daemon');

test('getPidPath returns path under config dir', () => {
  const p = getPidPath();
  assert.ok(p.includes('daemon.pid'));
});

test('isRunning returns false when no pid file', () => {
  assert.strictEqual(isRunning(), false);
});

test('handleCardAction writes response for allow action', () => {
  const reqId = 'card-test-001';
  // 先创建请求文件
  const { writeRequest } = require('../lib/ipc');
  writeRequest(reqId, { requestId: reqId, type: 'permission' });

  handleCardAction({
    action: { value: JSON.stringify({ action: 'allow', requestId: reqId }) },
    operator: { open_id: 'ou_test123' }
  });

  const { respPath } = require('../lib/ipc');
  const rp = respPath(reqId);
  assert.ok(fs.existsSync(rp), '应创建响应文件');
  const resp = JSON.parse(fs.readFileSync(rp, 'utf-8'));
  assert.strictEqual(resp.action, 'allow');
});

test('handleCardAction writes response for message action with input', () => {
  const reqId = 'card-test-002';
  const { writeRequest } = require('../lib/ipc');
  writeRequest(reqId, { requestId: reqId, type: 'stop' });

  handleCardAction({
    action: { value: JSON.stringify({ action: 'message', requestId: reqId }) },
    form_value: { user_input: '继续优化代码' },
    operator: { open_id: 'ou_test123' }
  });

  const { respPath } = require('../lib/ipc');
  const resp = JSON.parse(fs.readFileSync(respPath(reqId), 'utf-8'));
  assert.strictEqual(resp.action, 'message');
  assert.strictEqual(resp.content, '继续优化代码');
});

test('handleMessage writes response for text reply', () => {
  const { listPendingRequests, writeRequest, respPath } = require('../lib/ipc');
  const reqId = 'msg-test-001';
  writeRequest(reqId, { requestId: reqId, type: 'stop', timestamp: Date.now() });

  handleMessage({
    message: {
      message_type: 'text',
      content: JSON.stringify({ text: '请继续' })
    },
    sender: { sender_id: { open_id: 'ou_test456' } }
  });

  // 应匹配最新的 pending request
  const rp = respPath(reqId);
  assert.ok(fs.existsSync(rp));
  const resp = JSON.parse(fs.readFileSync(rp, 'utf-8'));
  assert.strictEqual(resp.action, 'message');
  assert.strictEqual(resp.content, '请继续');
});
```

**Step 3: 运行测试验证失败**

Run: `node --test tests/daemon.test.js`
Expected: FAIL — lib/daemon.js 不存在

**Step 4: 实现 `lib/daemon.js`**

```javascript
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
    process.kill(pid, 0); // 检查进程是否存在
    return true;
  } catch {
    // 进程不存在，清理 pid 文件
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

/**
 * 处理飞书卡片按钮回调
 * data.action.value 是按钮的 value（JSON 字符串）
 * data.form_value.user_input 是输入框内容（如有）
 */
function handleCardAction(data) {
  try {
    const btnValue = JSON.parse(data.action?.value || '{}');
    const { action, requestId } = btnValue;
    if (!requestId) return;

    const operatorId = data.operator?.open_id || 'unknown';
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

/**
 * 处理飞书消息（用户直接发文本消息）
 * 匹配最新的 pending stop request
 */
function handleMessage(data) {
  try {
    const msgType = data.message?.message_type;
    if (msgType !== 'text') return;

    const content = JSON.parse(data.message.content || '{}');
    const text = content.text || '';
    if (!text.trim()) return;

    const senderId = data.sender?.sender_id?.open_id || 'unknown';

    // 找到最新的 pending request
    const pending = listPendingRequests()
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    if (pending.length === 0) {
      log(`Message from ${senderId} but no pending requests: "${text}"`);
      return;
    }

    const latest = pending[0];
    writeResponse(latest.requestId, {
      requestId: latest.requestId,
      action: 'message',
      content: text,
      operatorId: senderId
    });
    log(`Message "${text}" matched to ${latest.requestId} by ${senderId}`);
  } catch (e) {
    log(`Message handler error: ${e.message}`);
  }
}

/**
 * 启动 WebSocket 守护进程
 * 使用 @larksuiteoapi/node-sdk 的 WSClient
 */
async function startDaemon(appId, appSecret) {
  if (isRunning()) {
    console.log('守护进程已在运行');
    return;
  }

  const lark = require('@larksuiteoapi/node-sdk');

  const eventDispatcher = new lark.EventDispatcher({}).register({
    'im.message.receive_v1': (data) => {
      log(`Received message event`);
      handleMessage(data);
      return {};
    },
    'card.action.trigger': (data) => {
      log(`Received card action event`);
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
  writePid,
  removePid,
  log
};
```

**Step 5: 运行测试验证通过**

Run: `node --test tests/daemon.test.js`
Expected: 全部 PASS

**Step 6: 提交**

```bash
git add lib/daemon.js tests/daemon.test.js package.json package-lock.json
git commit -m "feat: 添加 WebSocket 守护进程，处理飞书卡片回调和消息"
```

---

## Task 4: 交互式 Hook (`hooks/interactive.js`)

**Files:**
- Create: `hooks/interactive.js`
- Test: `tests/interactive.test.js` (新建)

**Step 1: 写失败测试**

创建 `tests/interactive.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-test-'));
const tmpIpc = path.join(tmpHome, 'ipc');
process.env.CLAUDE_HOOKS_FEISHU_HOME = tmpHome;
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpIpc;

// 写入一个最小配置
const { saveConfig, defaultConfig } = require('../lib/config');
const cfg = defaultConfig();
cfg.app.enabled = true;
cfg.app.appId = 'test_app_id';
cfg.app.appSecret = 'test_secret';
cfg.app.receiverId = 'ou_test';
saveConfig(cfg);

const { buildInteractivePayload, processResponse } = require('../hooks/interactive');

test('buildInteractivePayload for Stop event returns stop card JSON', () => {
  const data = {
    hook_event_name: 'Stop',
    session_id: 'sess-1',
    cwd: '/project',
    last_assistant_message: 'All done!',
    transcript_path: '/tmp/t.jsonl'
  };
  const { cardContent, requestId } = buildInteractivePayload(data);
  assert.ok(requestId, '应生成 requestId');
  assert.ok(typeof cardContent === 'string');
  const parsed = JSON.parse(cardContent);
  assert.strictEqual(parsed.header.template, 'green');
  assert.ok(JSON.stringify(parsed).includes('All done!'));
});

test('buildInteractivePayload for Notification event returns permission card', () => {
  const data = {
    hook_event_name: 'Notification',
    session_id: 'sess-2',
    cwd: '/project',
    title: '权限请求',
    message: '是否允许执行 Bash?',
    notification_type: 'permission_prompt'
  };
  const { cardContent, requestId } = buildInteractivePayload(data);
  const parsed = JSON.parse(cardContent);
  assert.strictEqual(parsed.header.template, 'yellow');
  assert.ok(JSON.stringify(parsed).includes('允许'));
});

test('processResponse for message action returns block decision', () => {
  const result = processResponse('Stop', {
    action: 'message',
    content: '继续优化代码'
  });
  assert.strictEqual(result.decision, 'block');
  assert.ok(result.reason.includes('继续优化代码'));
});

test('processResponse for dismiss action returns null (allow stop)', () => {
  const result = processResponse('Stop', { action: 'dismiss' });
  assert.strictEqual(result, null);
});

test('processResponse for allow action returns exitCode 0', () => {
  const result = processResponse('Notification', { action: 'allow' });
  assert.strictEqual(result.exitCode, 0);
});

test('processResponse for deny action returns exitCode 2', () => {
  const result = processResponse('Notification', { action: 'deny' });
  assert.strictEqual(result.exitCode, 2);
  assert.ok(result.stderr);
});

test('processResponse for timeout returns null', () => {
  const result = processResponse('Stop', null);
  assert.strictEqual(result, null);
});
```

**Step 2: 运行测试验证失败**

Run: `node --test tests/interactive.test.js`
Expected: FAIL — hooks/interactive.js 不存在

**Step 3: 实现 `hooks/interactive.js`**

```javascript
#!/usr/bin/env node
const crypto = require('node:crypto');
const { loadConfig } = require('../lib/config');
const { buildStopCard, buildPermissionCard } = require('../lib/card-builder');
const { writeRequest, pollResponse } = require('../lib/ipc');
const { buildAppCardContent, sendAppMessage } = require('../lib/feishu-app');
const { buildCardPayload, sendWebhook } = require('../lib/feishu-webhook');
const { resolveEventType } = require('../lib/sender');
const { isRunning } = require('../lib/daemon');

function generateRequestId() {
  return crypto.randomUUID();
}

function buildInteractivePayload(data) {
  const hookEvent = data.hook_event_name || 'Stop';
  const requestId = generateRequestId();
  const sessionId = data.session_id || '';
  const cwd = data.cwd || process.cwd();

  let cardContent;
  if (hookEvent === 'Stop') {
    cardContent = buildStopCard({
      requestId,
      sessionId,
      cwd,
      message: data.last_assistant_message || '',
      transcriptPath: data.transcript_path
    });
  } else {
    // Notification (permission_prompt)
    cardContent = buildPermissionCard({
      requestId,
      sessionId,
      cwd,
      title: data.title || '',
      message: data.message || '',
      notificationType: data.notification_type || ''
    });
  }

  return { cardContent, requestId, hookEvent, sessionId, cwd };
}

function processResponse(hookEvent, response) {
  if (!response) return null; // 超时，正常退出

  if (hookEvent === 'Stop') {
    if (response.action === 'message' && response.content) {
      return {
        decision: 'block',
        reason: `用户通过飞书下达新指令: ${response.content}`
      };
    }
    return null; // dismiss 或其他，正常退出
  }

  // Notification (permission_prompt)
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

  // stop_hook_active 时跳过交互，防无限循环
  if (data.stop_hook_active) {
    process.exit(0);
    return;
  }

  const config = loadConfig();

  // 如果 daemon 未运行，回退到普通通知模式
  if (!isRunning()) {
    const { send } = require('../lib/sender');
    const type = resolveEventType(hookEvent, {});
    const { buildFields } = require('./notify');
    const fields = buildFields(hookEvent, data);
    await send({ type, cwd: data.cwd || process.cwd(), fields });
    process.exit(0);
    return;
  }

  // 构建交互卡片并发送
  const { cardContent, requestId, cwd } = buildInteractivePayload(data);

  // 写入 IPC 请求
  writeRequest(requestId, {
    requestId,
    type: hookEvent === 'Stop' ? 'stop' : 'permission',
    sessionId: data.session_id || '',
    hookEvent
  });

  // 发送交互卡片
  if (config.app.enabled && config.app.appId) {
    try {
      await sendAppMessage(
        config.app.appId, config.app.appSecret,
        config.app.receiverId, config.app.receiverType,
        cardContent
      );
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

  // 轮询等待响应
  const timeoutMs = hookEvent === 'Stop' ? 300000 : 120000; // Stop 5分钟, Permission 2分钟
  const response = await pollResponse(requestId, { timeoutMs, intervalMs: 500 });

  const result = processResponse(hookEvent, response);

  if (!result) {
    process.exit(0);
    return;
  }

  if (result.decision === 'block') {
    // Stop hook: 输出 JSON 到 stdout 让 Claude 继续
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

// 导出供测试使用
module.exports = { buildInteractivePayload, processResponse, generateRequestId };

if (require.main === module) {
  main().catch((e) => {
    console.error('[interactive]', e.message);
    process.exit(0);
  });
}
```

**Step 4: 运行测试验证通过**

Run: `node --test tests/interactive.test.js`
Expected: 全部 PASS

**Step 5: 运行全部测试**

Run: `node --test tests/`
Expected: 全部 PASS

**Step 6: 提交**

```bash
git add hooks/interactive.js tests/interactive.test.js
git commit -m "feat: 添加交互式 hook，支持 Stop 继续对话和权限审批"
```

---

## Task 5: CLI 增加 daemon 管理命令

**Files:**
- Modify: `bin/cli.js`
- Test: 手动测试 `--daemon start/stop/status`

**Step 1: 修改 `bin/cli.js`**

在文件末尾的参数处理部分（第188行起），增加 `--daemon` 分支：

在 `} else if (args.includes('--remove')) {` 之前插入：

```javascript
} else if (args.includes('--daemon')) {
  const { loadConfig } = require('../lib/config');
  const cfg = loadConfig();
  const sub = args[args.indexOf('--daemon') + 1] || 'status';

  if (sub === 'start') {
    if (!cfg.app.enabled || !cfg.app.appId) {
      console.log('❌ 请先配置飞书应用 (appId/appSecret)');
      console.log('运行: npx claude-code-hooks-feishu');
      process.exit(1);
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
      const fs = require('node:fs');
      const pid = fs.readFileSync(getPidPath(), 'utf-8').trim();
      console.log(`PID: ${pid}`);
    }
    console.log(`日志: ${getLogPath()}`);
  }
```

同时在安装向导中，复制 hooks 脚本时增加 `interactive.js`：

在第73行的 hooks 文件列表中增加 `'interactive.js'`:
```javascript
for (const f of ['notify.js', 'guard.js', 'interactive.js', 'format-python.sh', 'code-review.sh']) {
```

在第82行的 lib 文件列表中增加新模块:
```javascript
for (const f of ['config.js', 'feishu-webhook.js', 'feishu-app.js', 'sender.js', 'ipc.js', 'card-builder.js', 'daemon.js']) {
```

在安装向导末尾的帮助信息中增加 daemon 命令:
```javascript
console.log('  npx claude-code-hooks-feishu --daemon start  # 启动交互守护进程');
console.log('  npx claude-code-hooks-feishu --daemon stop   # 停止守护进程');
console.log('  npx claude-code-hooks-feishu --daemon status # 查看状态');
```

**Step 2: 在安装向导中增加交互 hook 配置选项**

在 hooks 选择部分（第46-54行之后）增加:

```javascript
const h5 = await ask('  飞书双向交互 (Stop后继续对话/权限审批) [Y/n]: ');
config.hooks.interactive = h5.trim().toLowerCase() !== 'n';
```

在注入 hooks 到 settings.json 的部分，增加 interactive hook 注入逻辑:

```javascript
if (config.hooks.interactive) {
  // interactive hook 替代 notify hook 处理 Stop 和 Notification
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
```

**Step 3: 手动测试**

```bash
# 测试 daemon status
node bin/cli.js --daemon status
# Expected: 守护进程状态: ❌ 未运行

# 测试 daemon start (需要有效的 appId/appSecret)
node bin/cli.js --daemon start
# Expected: 守护进程已启动 (PID: xxx)

# 测试 daemon stop
node bin/cli.js --daemon stop
# Expected: 守护进程已停止
```

**Step 4: 提交**

```bash
git add bin/cli.js
git commit -m "feat: CLI 增加 --daemon start/stop/status 和交互 hook 安装"
```

---

## Task 6: 更新配置、README、package.json

**Files:**
- Modify: `lib/config.js` — defaultConfig 增加 interactive 字段
- Modify: `package.json` — 版本号、files 字段
- Modify: `README.md` — 增加双向交互文档

**Step 1: 更新 `lib/config.js`**

在 `defaultConfig()` 的 hooks 对象中增加:

```javascript
hooks: {
  notify: true,
  guard: true,
  interactive: true,  // 新增
  formatPython: true,
  codeReview: true
},
```

**Step 2: 更新 `package.json`**

```json
{
  "version": "2.0.0",
  "description": "飞书双向交互 + 通知 + 危险命令拦截 for Claude Code",
  "dependencies": {
    "@larksuiteoapi/node-sdk": "^0.6.0"
  }
}
```

**Step 3: 更新 `README.md`**

在功能表格后增加双向交互章节:

```markdown
## 双向交互（v2.0 新功能）

通过飞书与 Claude Code 实时交互：

| 场景 | 飞书卡片 | 操作 |
|------|---------|------|
| 任务完成 | 绿色卡片 + 输入框 | 输入新指令继续对话 / 结束会话 |
| 权限请求 | 黄色卡片 + 按钮 | 一键允许 / 拒绝 |

### 前置条件

- 飞书自建应用（需要 appId + appSecret）
- 应用开启「机器人」能力
- 应用订阅 `im.message.receive_v1` 事件
- 应用开启「卡片回调」能力

### 使用方式

```bash
# 1. 安装并配置（如已配置可跳过）
npx claude-code-hooks-feishu

# 2. 启动守护进程
npx claude-code-hooks-feishu --daemon start

# 3. 正常使用 Claude Code，飞书会收到交互卡片

# 4. 停止守护进程
npx claude-code-hooks-feishu --daemon stop
```

### 工作原理

```
Claude Code Hook → 发送交互卡片到飞书 → 等待用户操作
                                          ↓
飞书用户操作 → WebSocket 守护进程接收 → 写入响应文件
                                          ↓
Hook 读取响应 → 输出决策给 Claude Code ← 继续/停止
```
```

在命令部分增加:

```markdown
npx claude-code-hooks-feishu --daemon start   # 启动交互守护进程
npx claude-code-hooks-feishu --daemon stop    # 停止守护进程
npx claude-code-hooks-feishu --daemon status  # 查看守护进程状态
```

**Step 4: 运行全部测试**

Run: `node --test tests/`
Expected: 全部 PASS

**Step 5: 提交**

```bash
git add lib/config.js package.json README.md
git commit -m "feat: 更新配置、文档和版本号，发布 v2.0.0"
```

---

## Task 7: 集成测试 & 发布

**Step 1: 运行全部单元测试**

```bash
cd /share/geshijia/claude-code-hooks-feishu
node --test tests/
```
Expected: 全部 PASS

**Step 2: 本地端到端测试**

```bash
# 重新安装到本地
npm install -g .

# 测试 daemon
claude-code-hooks-feishu --daemon status
claude-code-hooks-feishu --daemon start
# 在飞书上验证收到消息后操作按钮
claude-code-hooks-feishu --daemon stop

# 测试通知（不截断）
echo '{"hook_event_name":"Stop","last_assistant_message":"'$(python3 -c "print('A'*2000)")'"}'  | node hooks/notify.js
```

**Step 3: 发布到 npm**

```bash
npm publish
```

**Step 4: Git push**

```bash
https_proxy=http://127.0.0.1:7890 git push
```

**Step 5: 验证 npx 安装**

```bash
npx claude-code-hooks-feishu@latest --daemon status
```

---

## 依赖关系

```
Task 0 (移除截断) ← 无依赖，可立即开始
Task 1 (IPC) ← 无依赖
Task 2 (卡片构建器) ← 无依赖
Task 3 (Daemon) ← 依赖 Task 1 (IPC)
Task 4 (交互Hook) ← 依赖 Task 0, 1, 2, 3
Task 5 (CLI) ← 依赖 Task 3, 4
Task 6 (配置/文档) ← 依赖 Task 5
Task 7 (集成测试) ← 依赖全部
```

Task 0、1、2 可并行开发。
