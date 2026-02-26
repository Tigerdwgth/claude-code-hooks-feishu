# 飞书双向交互设计

日期: 2026-02-26

## 目标

通过飞书实现与 Claude Code 的双向交互：
1. Claude 完成任务后，在飞书上回复新指令让 Claude 继续工作
2. Claude 请求权限时，在飞书上点按钮允许/拒绝
3. 所有通知消息完整显示，不截断

## 架构

三个组件：

### 1. 飞书 WebSocket 守护进程 (`lib/daemon.js`)

- 常驻后台，通过 `@larksuiteoapi/node-sdk` 建立 WebSocket 长连接
- 接收卡片按钮回调和用户输入
- 将回调数据写入临时响应文件
- 通过 CLI 管理: `--daemon start/stop/status`
- PID 文件: `~/.claude-hooks-feishu/daemon.pid`
- 日志: `~/.claude-hooks-feishu/daemon.log`

### 2. 交互式 Hook (`hooks/interactive.js`)

替代 notify.js 处理 Stop 和 Notification 事件：

**Stop 事件流程:**
1. 发送带输入框+按钮的交互卡片
2. 写入请求文件，轮询响应文件（最多 300 秒）
3. 收到用户回复 → 输出 `{"decision":"block","reason":"用户指令: xxx"}`
4. 超时/点击"结束会话" → 正常退出
5. `stop_hook_active=true` 时跳过交互，防无限循环

**Notification (permission_prompt) 事件流程:**
1. 发送带"允许/拒绝"按钮的卡片
2. 轮询响应文件
3. 允许 → exit 0，拒绝 → exit 2 + stderr

### 3. 文件通信协议

```
请求: /tmp/claude-hooks-feishu/req-{uuid}.json
      { requestId, type, sessionId, timestamp }

响应: /tmp/claude-hooks-feishu/resp-{uuid}.json
      { requestId, action: "allow"|"deny"|"message", content: "..." }
```

Hook 每 500ms 轮询响应文件。Daemon 收到飞书回调后写入响应文件。

## 交互卡片设计

### Stop 卡片（任务完成）

- 绿色卡片，完整显示 Claude 回复（不截断）
- 包含输入框 + "发送"按钮 + "结束会话"按钮
- 用户操作后卡片更新状态（如 "💬 已发送指令: xxx"）

### Notification 卡片（权限审批）

- 黄色卡片，显示权限请求详情
- "✅ 允许" + "❌ 拒绝" 两个按钮
- 操作后卡片更新（如 "✅ 已允许 by 葛士嘉 14:05:30"）

## 消息不截断

- 移除 notify.js 中的 truncate() 限制
- last_assistant_message、error、tool_input 等字段完整显示
- 飞书 lark_md 支持长文本

## 依赖

- `@larksuiteoapi/node-sdk`: 飞书 WebSocket 长连接（唯一外部依赖，仅 daemon 使用）

## 文件变更

新增:
- `lib/daemon.js` — WebSocket 守护进程
- `hooks/interactive.js` — 交互式 hook（Stop + Notification）
- `lib/card-builder.js` — 交互卡片构建（带按钮/输入框）
- `lib/ipc.js` — 文件通信（写请求/轮询响应）

修改:
- `hooks/notify.js` — 移除 truncate，完整显示消息
- `bin/cli.js` — 增加 --daemon 命令，安装时配置交互 hook
- `lib/config.js` — 增加 daemon 和交互相关配置
- `package.json` — 增加 @larksuiteoapi/node-sdk 依赖
- `README.md` — 增加双向交互文档
