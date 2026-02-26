const { test } = require('node:test');
const assert = require('node:assert');
const { buildStopCard, buildPermissionCard, buildStatusUpdateCard } = require('../lib/card-builder');

test('buildStopCard contains buttons and reply hint', () => {
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
  const content = JSON.stringify(parsed);
  assert.ok(content.includes('Task completed successfully'));
  assert.ok(content.includes('发送指令'));
  assert.ok(content.includes('@机器人'));
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

test('buildPermissionCard contains buttons and reply hint', () => {
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
