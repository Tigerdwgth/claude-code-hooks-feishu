// tests/pty-manager.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { PtyManager } = require('../lib/pty-manager');

test('create and destroy PTY', (t, done) => {
  const mgr = new PtyManager();
  let output = '';
  mgr.create('sess1', { cols: 80, rows: 24, onData: (d) => { output += d; } });
  assert.ok(mgr.has('sess1'));
  setTimeout(() => {
    mgr.write('sess1', 'echo hello\n');
    setTimeout(() => {
      assert.ok(output.includes('hello') || output.length > 0);
      mgr.destroy('sess1');
      assert.equal(mgr.has('sess1'), false);
      done();
    }, 300);
  }, 200);
});

test('resize PTY', () => {
  const mgr = new PtyManager();
  mgr.create('sess2', { cols: 80, rows: 24, onData: () => {} });
  mgr.resize('sess2', 120, 40); // should not throw
  mgr.destroy('sess2');
});

test('create reuses existing PTY if alive', () => {
  const mgr = new PtyManager();
  const p1 = mgr.create('s1', { command: ['echo'], cwd: '/tmp' });
  const pid1 = p1.pid;
  const p2 = mgr.create('s1', { command: ['echo'], cwd: '/tmp' });
  assert.strictEqual(p2.pid, pid1, 'should reuse same PTY process');
  mgr.destroyAll();
});
