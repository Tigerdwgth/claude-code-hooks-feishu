const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-test-'));
process.env.CLAUDE_HOOKS_FEISHU_IPC_DIR = tmpDir;

const { writeRequest, writeResponse, pollResponse, IPC_DIR } = require('../lib/ipc');

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
  const reqFilePath = writeRequest(reqId, { requestId: reqId, type: 'stop' });
  writeResponse(reqId, { requestId: reqId, action: 'allow' });
  await pollResponse(reqId, { timeoutMs: 1000, intervalMs: 100 });
  assert.ok(!fs.existsSync(reqFilePath));
});
