const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getIpcDir } = require('./ipc');

function getQueueDir() {
  const dir = path.join(getIpcDir(), 'queue');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function enqueue({ targetMachine, targetSession, content, action, senderId }) {
  const id = crypto.randomUUID();
  const timestamp = Date.now();
  const msg = {
    id,
    targetMachine: targetMachine || '',
    targetSession: targetSession || '',
    content,
    action: action || 'message',
    senderId: senderId || 'unknown',
    timestamp,
    consumed: false
  };
  const fileName = `msg-${timestamp}-${id}.json`;
  fs.writeFileSync(path.join(getQueueDir(), fileName), JSON.stringify(msg), 'utf-8');
  return msg;
}

function listQueueFiles() {
  const dir = getQueueDir();
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('msg-') && f.endsWith('.json'))
    .sort()
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        data._fileName = f;
        return data;
      } catch { return null; }
    })
    .filter(Boolean);
}

function peekQueue(targetMachine, targetSession) {
  const all = listQueueFiles().filter(m => !m.consumed);
  if (targetMachine === undefined && targetSession === undefined) return all;
  return all.filter(m =>
    m.targetMachine === targetMachine && m.targetSession === targetSession
  );
}

function dequeue(targetMachine, targetSession) {
  const msgs = peekQueue(targetMachine, targetSession);
  if (msgs.length === 0) return null;

  const oldest = msgs[0];
  const filePath = path.join(getQueueDir(), oldest._fileName);
  try { fs.unlinkSync(filePath); } catch {}

  delete oldest._fileName;
  return oldest;
}

module.exports = {
  enqueue,
  dequeue,
  peekQueue,
  getQueueDir
};
