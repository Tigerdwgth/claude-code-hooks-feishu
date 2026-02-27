const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-session-test-'));
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpDir;

const { buildInteractivePayload } = require('../hooks/interactive');

test('buildInteractivePayload includes machineId', () => {
  const data = {
    hook_event_name: 'Stop',
    session_id: 'sess-test-1',
    cwd: '/tmp/test-project',
    last_assistant_message: 'done'
  };
  const result = buildInteractivePayload(data);
  assert.ok(result.machineId);
  assert.ok(result.requestId);
  const card = JSON.parse(result.cardContent);
  const text = card.elements[0].text.content;
  assert.ok(text.includes(result.machineId));
});

test('buildInteractivePayload for Notification includes machineId', () => {
  const data = {
    hook_event_name: 'Notification',
    session_id: 'sess-test-2',
    cwd: '/tmp/test-project',
    title: 'Permission needed',
    message: 'Allow?'
  };
  const result = buildInteractivePayload(data);
  assert.ok(result.machineId);
  const card = JSON.parse(result.cardContent);
  const text = card.elements[0].text.content;
  assert.ok(text.includes(result.machineId));
});
