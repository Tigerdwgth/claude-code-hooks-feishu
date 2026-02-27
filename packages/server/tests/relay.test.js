// packages/server/tests/relay.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { RelayServer } = require('../relay');

test('machine registration', () => {
  const relay = new RelayServer();
  relay.registerMachine('dev-a', { send: () => {}, readyState: 1 });
  assert.ok(relay.getMachine('dev-a'));
  relay.unregisterMachine('dev-a');
  assert.equal(relay.getMachine('dev-a'), undefined);
});

test('session list update', () => {
  const relay = new RelayServer();
  relay.registerMachine('dev-a', { send: () => {}, readyState: 1 });
  relay.updateSessions('dev-a', [{ id: 'sess1', cwd: '/project' }]);
  const sessions = relay.getAllSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].machineId, 'dev-a');
});

test('handleMachineMessage session_list', () => {
  const relay = new RelayServer();
  relay.registerMachine('dev-a', { send: () => {}, readyState: 1 });
  relay.handleMachineMessage('dev-a', JSON.stringify({
    type: 'session_list',
    sessions: [{ id: 'abc', cwd: '/home' }]
  }));
  const sessions = relay.getAllSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'abc');
});

test('pty_attach only updates watching, no pty_open sent', () => {
  const relay = new RelayServer();
  const sent = [];
  const machineWs = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  relay.registerMachine('m1', machineWs);
  const browserWs = { readyState: 1, send: () => {} };
  const bid = relay._addBrowser(browserWs);
  sent.length = 0;
  relay.handleBrowserMessage(bid, JSON.stringify({
    type: 'pty_attach', machineId: 'm1', sessionId: 's1'
  }));
  assert.strictEqual(sent.length, 0, 'should NOT send pty_open to machine');
  const browser = relay.browsers.get(bid);
  assert.strictEqual(browser.watchingSession, 's1');
});

test('close_terminal forwards pty_close to machine', () => {
  const relay = new RelayServer();
  const sent = [];
  const machineWs = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  relay.registerMachine('m1', machineWs);
  const browserWs = { readyState: 1, send: () => {} };
  const bid = relay._addBrowser(browserWs);
  sent.length = 0;
  relay.handleBrowserMessage(bid, JSON.stringify({
    type: 'close_terminal', machineId: 'm1', sessionId: 's1'
  }));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, 'pty_close');
  assert.strictEqual(sent[0].sessionId, 's1');
});

test('delete_session forwards to machine', () => {
  const relay = new RelayServer();
  const sent = [];
  const machineWs = { readyState: 1, send: (d) => sent.push(JSON.parse(d)) };
  relay.registerMachine('m1', machineWs);
  const browserWs = { readyState: 1, send: () => {} };
  const bid = relay._addBrowser(browserWs);
  sent.length = 0;
  relay.handleBrowserMessage(bid, JSON.stringify({
    type: 'delete_session', machineId: 'm1', sessionId: 's1'
  }));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].type, 'delete_session');
  assert.strictEqual(sent[0].sessionId, 's1');
});
