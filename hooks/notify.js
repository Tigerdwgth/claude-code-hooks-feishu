#!/usr/bin/env node
const { resolveEventType, send } = require('../lib/sender');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch { /* stdin 可能为空 */ }

  const hookEvent = data.hook_event_name || 'Stop';
  const cwd = data.cwd || process.cwd();
  const type = resolveEventType(hookEvent, {});

  let detail = '';
  if (hookEvent === 'PostToolUseFailure') {
    detail = `工具: ${data.tool_name || 'unknown'}`;
  } else if (hookEvent === 'Notification') {
    detail = data.notification_type || '';
  }

  await send({ type, cwd, detail });
}

main().catch((e) => console.error('[notify]', e.message));
