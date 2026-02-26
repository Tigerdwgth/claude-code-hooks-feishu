const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// 用临时目录模拟 HOME
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-test-'));
process.env.CLAUDE_HOOKS_FEISHU_HOME = tmpHome;

const { loadConfig, saveConfig, getConfigPath, getHooksDir } = require('../lib/config');

test('getConfigPath returns correct path', () => {
  const p = getConfigPath();
  assert.ok(p.endsWith('config.json'));
  assert.ok(p.includes('.claude-hooks-feishu') || p.includes('hooks-test-'));
});

test('getHooksDir returns correct path', () => {
  const p = getHooksDir();
  assert.ok(p.endsWith('hooks'));
});

test('loadConfig returns default when no config exists', () => {
  const config = loadConfig();
  assert.strictEqual(config.webhook.enabled, false);
  assert.strictEqual(config.app.enabled, false);
  assert.ok(Array.isArray(config.dangerousPatterns));
});

test('saveConfig and loadConfig roundtrip', () => {
  const config = loadConfig();
  config.webhook.enabled = true;
  config.webhook.url = 'https://example.com/hook';
  saveConfig(config);
  const loaded = loadConfig();
  assert.strictEqual(loaded.webhook.enabled, true);
  assert.strictEqual(loaded.webhook.url, 'https://example.com/hook');
});
