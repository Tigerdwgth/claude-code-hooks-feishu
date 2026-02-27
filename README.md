# claude-code-hooks-feishu

Claude Code 飞书双向交互 hooks —— 通过飞书与 Claude Code 实时交互、任务通知、危险命令拦截。

## 安装

### 方式一：npx 一键安装（推荐）

```bash
npx claude-code-hooks-feishu
```

### 方式二：从 GitHub 安装

```bash
git clone https://github.com/Tigerdwgth/claude-code-hooks-feishu.git
cd claude-code-hooks-feishu && node bin/cli.js
```

交互式向导会自动完成所有配置（包括 `~/.claude/settings.json`），无需手动编辑任何文件。

## 功能

| Hook | 触发事件 | 说明 | 飞书通知 |
|------|---------|------|---------|
| 任务完成 | Stop | Claude 完成响应时通知 | ✅ |
| 权限请求 | Notification | 需要用户确认时通知 | ✅ |
| 工具失败 | PostToolUseFailure | 工具执行失败时通知 | ✅ |
| 危险拦截 | PreToolUse (Bash) | 拦截 rm -rf 等危险命令 | ✅ |
| 双向交互 | Stop / Notification | 飞书上继续对话/审批权限 | ✅ |
| Python 格式化 | PostToolUse (Edit/Write) | 自动格式化 .py 文件 | ❌ |
| Commit 审查 | PreToolUse (Bash) | git commit 前检查代码风格 | ❌ |

## 通知详情

每条通知包含完整上下文信息：

| 事件 | 包含字段 |
|------|---------|
| 任务完成 | 项目目录、时间、会话ID、Claude回复（完整）、Transcript路径 |
| 权限请求 | 项目目录、时间、会话ID、通知标题、通知内容、通知类型 |
| 工具失败 | 项目目录、时间、会话ID、工具名、输入参数、错误信息 |
| 危险拦截 | 项目目录、时间、完整命令、匹配规则、会话ID |

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
npx claude-code-hooks-feishu                # 安装/重新配置
npx claude-code-hooks-feishu --test         # 发送测试消息
npx claude-code-hooks-feishu --remove       # 卸载
npx claude-code-hooks-feishu --daemon start # 启动交互守护进程
npx claude-code-hooks-feishu --daemon stop  # 停止守护进程
npx claude-code-hooks-feishu --daemon status# 查看守护进程状态
```

## 双向交互（v2.0）

通过飞书与 Claude Code 实时交互：

| 场景 | 飞书卡片 | 操作 |
|------|---------|------|
| 任务完成 | 绿色卡片 + 输入框 | 输入新指令继续对话 / 结束会话 |
| 权限请求 | 黄色卡片 + 按钮 | 一键允许 / 拒绝 |

### 前置条件

- 飞书自建应用（需要 appId + appSecret）
- 应用开启「机器人」能力
- 应用订阅 `im.message.receive_v1` 事件
- 应用开启「卡片回调」能力

### 使用方式

```bash
# 1. 安装并配置
npx claude-code-hooks-feishu

# 2. 启动守护进程
npx claude-code-hooks-feishu --daemon start

# 3. 正常使用 Claude Code，飞书会收到交互卡片

# 4. 停止守护进程
npx claude-code-hooks-feishu --daemon stop
```

### 工作原理

```
Claude Code Hook → 发送交互卡片到飞书 → 等待用户操作
                                          ↓
飞书用户操作 → WebSocket 守护进程接收 → 写入响应文件
                                          ↓
Hook 读取响应 → 输出决策给 Claude Code ← 继续/停止
```

守护进程未运行时，自动回退到普通通知模式。

## Web Dashboard（v4.0）

通过浏览器管理多台开发机的 Claude Code session，支持完整 PTY 终端交互。

### 部署中央服务器

```bash
cd packages/server
npm install

# 构建前端
cd frontend && npm install && npm run build && cd ..

# 创建管理员账号
node index.js --create-user admin

# 启动（建议用 nginx 反代）
MACHINE_TOKENS=your-uuid-token JWT_SECRET=your-secret node index.js --port 3000
```

### nginx 反代配置（支持 WebSocket）

```nginx
location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```

### 配置开发机

```bash
# 重新运行配置向导，选择启用 Web Dashboard
npx claude-code-hooks-feishu

# 启动 daemon（自动连接中央服务器）
npx claude-code-hooks-feishu --daemon start
```

### 访问

浏览器打开 `https://your-server/`，用管理员账号登录，即可看到所有已连接开发机的 session 列表，点击 session 打开完整 PTY 终端。

## 配置文件

配置存储在 `~/.claude-hooks-feishu/config.json`（不含在仓库中）。

## 危险命令拦截规则

默认拦截以下命令模式（可在配置中自定义）：

- `rm -rf` / `rm -r /`
- `git push --force` / `git push -f`
- `git reset --hard`
- `DROP TABLE` / `DROP DATABASE`
- `mkfs` / `dd if=` / `> /dev/sda`

## License

MIT
