const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'interactive-test-'));
const tmpIpc = path.join(tmpHome, 'ipc');
process.env.CLAUDE_HOOKS_FEISHU_HOME = tmpHome;
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpIpc;

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

test('processResponse for dismiss action returns null', () => {
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
