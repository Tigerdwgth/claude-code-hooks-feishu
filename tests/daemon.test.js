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
  const { writeRequest, respPath, reqPath } = require('../lib/ipc');
  // 清理前面测试遗留的 request 文件，避免 listPendingRequests 返回旧条目干扰排序
  for (const old of ['card-test-001', 'card-test-002']) {
    try { fs.unlinkSync(reqPath(old)); } catch {}
    try { fs.unlinkSync(respPath(old)); } catch {}
  }
  const reqId = 'msg-test-001';
  writeRequest(reqId, { requestId: reqId, type: 'stop', timestamp: Date.now() });

  handleMessage({
    message: {
      message_type: 'text',
      content: JSON.stringify({ text: '请继续' })
    },
    sender: { sender_id: { open_id: 'ou_test456' } }
  });

  const rp = respPath(reqId);
  assert.ok(fs.existsSync(rp));
  const resp = JSON.parse(fs.readFileSync(rp, 'utf-8'));
  assert.strictEqual(resp.action, 'message');
  assert.strictEqual(resp.content, '请继续');
});
