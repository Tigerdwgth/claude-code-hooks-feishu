# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 常用命令

```bash
# 运行测试
node --test tests/*.test.js

# 安装/重新配置
node bin/cli.js

# 测试飞书通知
node bin/cli.js --test

# 启动/停止 daemon（飞书交互 + ws-client）
node bin/cli.js --daemon start
node bin/cli.js --daemon stop
node bin/cli.js --daemon status

# 启动/停止 Web Dashboard 服务器
node bin/cli.js --server start
node bin/cli.js --server stop

# 构建前端
cd packages/server/frontend && npm install && npm run build

# 手动启动 server（带认证 token）
MACHINE_TOKENS=<uuid> JWT_SECRET=<secret> node packages/server/index.js --port 3000

# 创建管理员账号
node packages/server/index.js --create-user admin
```

## 架构概览

### 整体结构

```
claude-code-hooks-feishu/
├── bin/cli.js              # CLI 入口（安装向导、daemon/server 控制）
├── hooks/                  # Claude Code hook 脚本（被 ~/.claude/settings.json 引用）
│   ├── notify.js           # Stop/Notification/PostToolUseFailure → 飞书通知
│   ├── guard.js            # PreToolUse(Bash) → 危险命令拦截
│   ├── interactive.js      # Stop/Notification → 等待飞书用户操作（双向交互）
│   ├── format-python.sh    # PostToolUse(Edit/Write) → 自动格式化 .py
│   ├── code-review.sh      # PreToolUse(Bash) → git commit 前代码审查
│   └── fix-write-path.js   # PreToolUse(Write) → 路径修正
├── lib/                    # 核心库
│   ├── config.js           # 配置读写（~/.claude-hooks-feishu/config.json）
│   ├── feishu-webhook.js   # 飞书群机器人 Webhook 发送
│   ├── feishu-app.js       # 飞书自建应用 API（发消息、处理事件）
│   ├── card-builder.js     # 飞书消息卡片模板构建
│   ├── sender.js           # 统一发送入口（webhook + app 两路）
│   ├── daemon.js           # daemon 进程管理（飞书 WS + ws-client）
│   ├── ipc.js              # Hook ↔ Daemon IPC（文件锁 + 临时文件）
│   ├── message-queue.js    # 消息队列（确保飞书消息顺序发送）
│   ├── session-registry.js # 扫描 ~/.claude/projects/**/*.jsonl 得到活跃 session 列表
│   ├── pty-manager.js      # node-pty 管理（spawn/resize/kill PTY 进程）
│   └── ws-client.js        # WebSocket 客户端（连接中央服务器、转发 PTY 数据）
├── packages/server/        # Web Dashboard 中央服务器
│   ├── index.js            # Express HTTP + 用户认证 API
│   ├── auth.js             # JWT + bcrypt 用户认证（SQLite 存储）
│   ├── relay.js            # WebSocket relay（浏览器 ↔ 开发机）
│   └── frontend/src/       # React + Vite 前端
│       ├── App.jsx          # 路由根组件
│       ├── Dashboard.jsx    # 主面板（session 列表 + 侧边栏）
│       ├── TerminalPanel.jsx # xterm.js PTY 终端
│       ├── SessionTabs.jsx  # 打开的 session tab 管理
│       ├── FileBrowser.jsx  # 远程文件浏览
│       └── MarkdownPreview.jsx # Markdown 预览
└── tests/                  # 单元测试（node:test）
```

### 关键数据流

**飞书 Hook 通知**：
`Claude Code 触发事件 → hooks/*.js → lib/sender.js → 飞书 Webhook/App API`

**双向交互**：
`hooks/interactive.js → ipc.js 写临时文件 → daemon.js 轮询读取 → 飞书卡片 → 用户操作 → daemon 写回响应文件 → hook 读取响应`

**Web Dashboard PTY 流**：
`浏览器 WS → relay.js（browser 协议）→ relay 翻译消息类型 → ws-client.js（machine 协议）→ pty-manager.js（node-pty）→ Claude Code 进程`

### 配置系统

配置文件位于 `~/.claude-hooks-feishu/config.json`（可用 `CLAUDE_HOOKS_FEISHU_HOME` 覆盖路径）。

关键配置项：
- `webhook`：群机器人 Webhook（可选）
- `app`：飞书自建应用（appId + appSecret，双向交互必需）
- `centralServer`：连接中央 Web Dashboard 服务器
- `server.machineTokens`：允许连接的开发机 token 列表
- `fileAccess.blockedDirs`：黑名单目录（安全策略）
- `dangerousPatterns`：危险命令正则列表

### WebSocket 协议分层

**浏览器 → relay**：`terminal_input` / `terminal_resize`
**relay → 开发机（ws-client）**：`pty_input` / `pty_resize`
relay 负责协议翻译，两层命名不同，修改时注意两端同步。

### session 多机合并

前端按 `machineId` 分区合并 session 列表：收到某台机器的 `active_sessions` 时，只替换该机器的数据，不能全量替换（否则会清空其他机器的 session）。

## 注意事项

- `node:test` 内置测试框架，运行单个测试：`node --test tests/sender.test.js`
- Python 格式化工具默认 `black`，可在配置中改为 `pycodestyle`
- `filter-branch` 等历史重写操作前，务必手动备份 untracked 文件（git stash 在此场景不可靠）
- 阅读 `LESSONS_LEARNED.md` 了解已踩过的坑
