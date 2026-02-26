# claude-code-hooks-feishu

Claude Code 飞书通知 hooks —— 任务完成通知、危险命令拦截告警、Python 格式化、Commit 审查。

## 安装

```bash
npx claude-code-hooks-feishu
```

交互式向导会引导你完成配置。

## 功能

| Hook | 触发事件 | 说明 | 飞书通知 |
|------|---------|------|---------|
| 任务完成 | Stop | Claude 完成响应时通知 | ✅ |
| 权限请求 | Notification | 需要用户确认时通知 | ✅ |
| 工具失败 | PostToolUseFailure | 工具执行失败时通知 | ✅ |
| 危险拦截 | PreToolUse (Bash) | 拦截 rm -rf 等危险命令 | ✅ |
| Python 格式化 | PostToolUse (Edit/Write) | 自动格式化 .py 文件 | ❌ |
| Commit 审查 | PreToolUse (Bash) | git commit 前检查代码风格 | ❌ |

## 飞书通知方式

- **群机器人 Webhook**: 在飞书群添加自定义机器人，获取 Webhook URL
- **自建应用**: 创建飞书应用，通过 API 发送个人消息

两种方式可同时启用。

## 通知卡片示例

| 事件 | 卡片标题 | 颜色 |
|------|---------|------|
| 任务完成 | ✅ Claude Code 任务完成 | 🟢 绿色 |
| 权限请求 | ⚠️ Claude Code 需要确认 | 🟡 黄色 |
| 工具失败 | ❌ Claude Code 工具执行失败 | 🟠 橙色 |
| 危险拦截 | 🚨 危险命令已拦截 | 🔴 红色 |

## 命令

```bash
npx claude-code-hooks-feishu          # 安装/重新配置
npx claude-code-hooks-feishu --test   # 发送测试消息
npx claude-code-hooks-feishu --remove # 卸载
```

## 配置文件

配置存储在 `~/.claude-hooks-feishu/config.json`（不含在仓库中）。

## 危险命令拦截规则

默认拦截以下命令模式（可在配置中自定义）：

- `rm -rf` / `rm -r /`
- `git push --force` / `git push -f`
- `git reset --hard`
- `DROP TABLE` / `DROP DATABASE`
- `mkfs` / `dd if=` / `> /dev/sda`

## Plugin Marketplace

本项目支持 Claude Code Plugin marketplace 分发：

```bash
/plugin marketplace add Tigerdwgth/claude-code-hooks-feishu
```

## License

MIT
