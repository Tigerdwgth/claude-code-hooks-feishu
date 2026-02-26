const { test } = require('node:test');
const assert = require('node:assert');
const { buildAppCardContent, buildTokenRequestBody } = require('../lib/feishu-app');

test('buildTokenRequestBody returns correct structure', () => {
  const body = buildTokenRequestBody('app123', 'secret456');
  assert.strictEqual(body.app_id, 'app123');
  assert.strictEqual(body.app_secret, 'secret456');
});

test('buildAppCardContent returns stringified JSON', () => {
  const content = buildAppCardContent({
    type: 'task_complete',
    cwd: '/project',
    detail: ''
  });
  assert.strictEqual(typeof content, 'string');
  const parsed = JSON.parse(content);
  assert.ok(parsed.header);
  assert.ok(parsed.elements);
  assert.ok(parsed.config);
});

test('buildAppCardContent for danger_blocked has red template', () => {
  const content = buildAppCardContent({
    type: 'danger_blocked',
    cwd: '/project',
    detail: 'rm -rf /'
  });
  const parsed = JSON.parse(content);
  assert.strictEqual(parsed.header.template, 'red');
  assert.ok(parsed.header.title.content.includes('拦截'));
});
