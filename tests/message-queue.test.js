const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-test-'));
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpDir;

const {
  enqueue,
  dequeue,
  peekQueue,
  getQueueDir
} = require('../lib/message-queue');

test('enqueue creates message file in queue dir', () => {
  const msg = enqueue({
    targetMachine: 'machine-1',
    targetSession: 'sess-aaa',
    content: '帮我写个函数',
    action: 'message',
    senderId: 'ou_123'
  });
  assert.ok(msg.id);
  assert.ok(msg.timestamp > 0);
  assert.strictEqual(msg.content, '帮我写个函数');
  assert.strictEqual(msg.consumed, false);

  const files = fs.readdirSync(getQueueDir());
  assert.ok(files.some(f => f.includes(msg.id)));
});

test('peekQueue returns messages for specific session', () => {
  enqueue({ targetMachine: 'machine-1', targetSession: 'sess-aaa', content: '第二条', action: 'message', senderId: 'ou_123' });
  enqueue({ targetMachine: 'machine-2', targetSession: 'sess-bbb', content: '其他会话', action: 'message', senderId: 'ou_456' });

  const msgs = peekQueue('machine-1', 'sess-aaa');
  assert.ok(msgs.length >= 2);
  assert.ok(msgs.every(m => m.targetMachine === 'machine-1' && m.targetSession === 'sess-aaa'));
  for (let i = 1; i < msgs.length; i++) {
    assert.ok(msgs[i].timestamp >= msgs[i - 1].timestamp);
  }
});

test('dequeue returns and removes oldest message for session', () => {
  const before = peekQueue('machine-1', 'sess-aaa');
  const countBefore = before.length;
  assert.ok(countBefore >= 1);

  const msg = dequeue('machine-1', 'sess-aaa');
  assert.ok(msg);
  assert.strictEqual(msg.content, '帮我写个函数');

  const after = peekQueue('machine-1', 'sess-aaa');
  assert.strictEqual(after.length, countBefore - 1);
});

test('dequeue returns null when queue is empty', () => {
  const msg = dequeue('machine-99', 'sess-nonexistent');
  assert.strictEqual(msg, null);
});

test('peekQueue with no args returns all unconsumed messages', () => {
  const all = peekQueue();
  assert.ok(all.length >= 1);
});
