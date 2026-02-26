#!/usr/bin/env node
const { loadConfig } = require('../lib/config');
const { send } = require('../lib/sender');

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  let data = {};
  try { data = JSON.parse(input); } catch { process.exit(0); }

  const command = data.tool_input?.command || '';
  if (!command) process.exit(0);

  const config = loadConfig();
  const patterns = config.dangerousPatterns || [];

  for (const pattern of patterns) {
    if (command.includes(pattern)) {
      // 发飞书告警
      await send({
        type: 'danger_blocked',
        cwd: data.cwd || process.cwd(),
        detail: `命令: \`${command}\`\n匹配规则: \`${pattern}\``
      });
      // exit 2 = 阻止执行，stderr 作为反馈
      process.stderr.write(
        `已拦截危险命令: "${command}" (匹配规则: ${pattern})`
      );
      process.exit(2);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('[guard]', e.message);
  process.exit(0);
});
