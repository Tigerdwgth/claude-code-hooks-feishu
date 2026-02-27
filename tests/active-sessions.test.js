// tests/active-sessions.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { scanActiveSessions } = require('../lib/ws-client');

test('scanActiveSessions returns array', () => {
  const result = scanActiveSessions();
  assert.ok(Array.isArray(result));
});

test('active session has required fields', () => {
  const result = scanActiveSessions();
  for (const s of result) {
    assert.ok('sessionId' in s);
    assert.ok('cwd' in s);
    assert.strictEqual(typeof s.mtime, 'number');
  }
});
