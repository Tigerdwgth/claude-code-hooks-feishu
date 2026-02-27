const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-route-test-'));
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpDir;

const { registerSession } = require('../lib/session-registry');
const { peekQueue } = require('../lib/message-queue');
const { writeRequest } = require('../lib/ipc');
const { handleMessage } = require('../lib/daemon');

test('handleMessage queues message when no pending requests and one session', () => {
  registerSession({ machineId: 'test-m', sessionId: 'test-s', cwd: '/tmp', pid: 1 });

  handleMessage({
    message: {
      message_type: 'text',
      chat_type: 'p2p',
      content: JSON.stringify({ text: '帮我写个函数' }),
      message_id: 'msg-001'
    },
    sender: { sender_id: { open_id: 'ou_test' } }
  });

  const queue = peekQueue('test-m', 'test-s');
  assert.ok(queue.length >= 1);
  assert.ok(queue.some(m => m.content === '帮我写个函数'));
});

test('handleMessage matches pending request when available', () => {
  writeRequest('req-match-test', {
    requestId: 'req-match-test',
    type: 'stop',
    machineId: 'test-m',
    sessionId: 'test-s'
  });

  handleMessage({
    message: {
      message_type: 'text',
      chat_type: 'p2p',
      content: JSON.stringify({ text: '继续' }),
      message_id: 'msg-002'
    },
    sender: { sender_id: { open_id: 'ou_test' } }
  });

  const respFile = path.join(tmpDir, 'resp-req-match-test.json');
  assert.ok(fs.existsSync(respFile));
});

test('handleMessage ignores non-text messages', () => {
  handleMessage({
    message: {
      message_type: 'image',
      chat_type: 'p2p',
      content: '{}',
      message_id: 'msg-003'
    },
    sender: { sender_id: { open_id: 'ou_test' } }
  });
  // 不应该报错
});

test('handleMessage ignores group messages without @mention', () => {
  const queueBefore = peekQueue('test-m', 'test-s');
  const countBefore = queueBefore.length;

  handleMessage({
    message: {
      message_type: 'text',
      chat_type: 'group',
      content: JSON.stringify({ text: '普通群消息' }),
      message_id: 'msg-004'
    },
    sender: { sender_id: { open_id: 'ou_test' } }
  });

  const queueAfter = peekQueue('test-m', 'test-s');
  assert.strictEqual(queueAfter.length, countBefore);
});
