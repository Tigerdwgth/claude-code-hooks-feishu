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
