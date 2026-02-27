// tests/ws-client.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { WebSocketServer } = require('ws');
const { WsClient } = require('../lib/ws-client');

test('connects and sends register', (t, done) => {
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'register') {
        assert.equal(msg.machineId, 'test-machine');
        wss.close();
        done();
      }
    });
  });
  wss.on('listening', () => {
    const { port } = wss.address();
    const client = new WsClient({
      url: `ws://localhost:${port}/ws`,
      machineToken: 'test-token',
      machineId: 'test-machine',
      ptyManager: { create: () => {}, write: () => {}, resize: () => {}, destroy: () => {} }
    });
    client.connect();
    t.after(() => client.disconnect());
  });
});

test('handles pty_input message', (t, done) => {
  const wss = new WebSocketServer({ port: 0 });
  const written = [];
  const mockPty = {
    create: () => {},
    write: (id, data) => { written.push({ id, data }); },
    resize: () => {},
    destroy: () => {}
  };

  wss.on('connection', (ws) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'register') {
        // 发送 pty_input 给客户端
        ws.send(JSON.stringify({
          type: 'pty_input',
          sessionId: 'sess1',
          data: Buffer.from('ls\n').toString('base64')
        }));
        setTimeout(() => {
          assert.equal(written.length, 1);
          assert.equal(written[0].id, 'sess1');
          assert.equal(written[0].data, 'ls\n');
          wss.close();
          done();
        }, 100);
      }
    });
  });

  wss.on('listening', () => {
    const { port } = wss.address();
    const client = new WsClient({
      url: `ws://localhost:${port}/ws`,
      machineToken: 'test-token',
      machineId: 'test-machine',
      ptyManager: mockPty
    });
    client.connect();
    t.after(() => client.disconnect());
  });
});
