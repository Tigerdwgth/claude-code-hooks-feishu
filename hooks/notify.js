#!/usr/bin/env node
const { resolveEventType, send } = require('../lib/sender');

function truncate(str, max = 200) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function extractToolInput(data) {
  const input = data.tool_input || {};
  if (input.command) return input.command;
  if (input.file_path) return input.file_path;
  if (input.pattern) return input.pattern;
  if (input.query) return input.query;
  if (input.url) return input.url;
  return JSON.stringify(input).slice(0, 200);
}

function buildFields(hookEvent, data) {
  const fields = [];
  const sid = data.session_id;
  if (sid) fields.push({ label: '会话ID', value: sid });

  if (hookEvent === 'Stop') {
    const msg = data.last_assistant_message;
    if (msg) fields.push({ label: 'Claude 回复摘要', value: truncate(msg, 300) });
    if (data.transcript_path) fields.push({ label: 'Transcript', value: data.transcript_path });
  } else if (hookEvent === 'Notification') {
    if (data.title) fields.push({ label: '标题', value: data.title });
    if (data.message) fields.push({ label: '内容', value: data.message });
    if (data.notification_type) fields.push({ label: '通知类型', value: data.notification_type });
  } else if (hookEvent === 'PostToolUseFailure') {
    if (data.tool_name) fields.push({ label: '工具', value: data.tool_name });
    fields.push({ label: '输入', value: truncate(extractToolInput(data), 200) });
    if (data.error) fields.push({ label: '错误', value: truncate(data.error, 300) });
  }

  return fields;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch { /* stdin 可能为空 */ }

  const hookEvent = data.hook_event_name || 'Stop';
  const cwd = data.cwd || process.cwd();
  const type = resolveEventType(hookEvent, {});
  const fields = buildFields(hookEvent, data);

  await send({ type, cwd, fields });
}

main().catch((e) => console.error('[notify]', e.message));
