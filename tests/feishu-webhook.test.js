const { test } = require('node:test');
const assert = require('node:assert');
const { generateSign, buildCardPayload } = require('../lib/feishu-webhook');

test('generateSign produces valid base64 string', () => {
  const { timestamp, sign } = generateSign('test-secret');
  assert.ok(typeof timestamp === 'string');
  assert.ok(timestamp.length > 0);
  assert.match(sign, /^[A-Za-z0-9+/]+=*$/);
});

test('buildCardPayload returns correct structure for task_complete', () => {
  const payload = buildCardPayload({
    type: 'task_complete',
    cwd: '/home/user/project',
    detail: ''
  });
  assert.strictEqual(payload.msg_type, 'interactive');
  assert.ok(payload.card.header.title.content.includes('任务完成'));
  assert.strictEqual(payload.card.header.template, 'green');
});

test('buildCardPayload returns correct structure for danger_blocked', () => {
  const payload = buildCardPayload({
    type: 'danger_blocked',
    cwd: '/home/user/project',
    detail: 'rm -rf /'
  });
  assert.ok(payload.card.header.title.content.includes('拦截'));
  assert.strictEqual(payload.card.header.template, 'red');
});

test('buildCardPayload returns correct structure for tool_failure', () => {
  const payload = buildCardPayload({
    type: 'tool_failure',
    cwd: '/home/user/project',
    detail: 'Bash: command not found'
  });
  assert.ok(payload.card.header.title.content.includes('失败'));
  assert.strictEqual(payload.card.header.template, 'orange');
});

test('buildCardPayload returns correct structure for permission_request', () => {
  const payload = buildCardPayload({
    type: 'permission_request',
    cwd: '/home/user/project',
    detail: 'permission_prompt'
  });
  assert.ok(payload.card.header.title.content.includes('确认'));
  assert.strictEqual(payload.card.header.template, 'yellow');
});
