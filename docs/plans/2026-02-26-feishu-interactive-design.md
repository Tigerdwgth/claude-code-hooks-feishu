# 飞书双向交互：消息队列 + 多机多会话路由 设计文档

日期: 2026-02-26

## 目标

将当前 PULL 模式（hook 发起 → 等待用户回复）升级为 PUSH+PULL 混合模式，支持用户随时发送消息并路由到正确的 Claude Code 会话。同时支持多台机器、多用户、多会话共享一个飞书应用。

## 核心问题

1. 用户在飞书发消息时如果没有 pending request，消息被丢弃（"no pending requests"）
2. 多台机器连接同一飞书应用时无法区分目标会话
3. 同一台机器上 `claude -p` 开启的多个 session 无法区分

## 架构

```
飞书用户
   │
   ▼
┌─────────────────┐
│  飞书 WSClient    │  ← 单实例 daemon
│  (daemon.js)     │
└───────┬─────────┘
        │ 读写共享 IPC 目录
        ▼
┌────────────────────────────────────┐
│  共享 IPC 目录 (可配置路径)            │
│                                      │
│  sessions/                           │  ← 会话注册表
│    {machineId}_{sessionId}.json      │
│                                      │
│  queue/                              │  ← 消息队列
│    msg-{timestamp}-{uuid}.json       │
│                                      │
│  req-{requestId}.json                │  ← pending request
│  resp-{requestId}.json               │  ← response
└────────────────────────────────────┘
        ▲
        │ 读写
┌───────┴─────────┐
│  Hooks            │  ← 任意机器上的 Claude Code
│  (guard/interactive/notify)
└─────────────────┘
```

## 会话寻址

唯一地址 = `machineId:sessionId`

- `machineId`: 环境变量 `CLAUDE_HOOKS_MACHINE_ID` 或 `os.hostname()`
- `sessionId`: Claude Code 传入的 `session_id`

## 消息路由规则

1. 回复卡片消息 → 路由到卡片对应的 session（卡片 metadata 含 machineId + sessionId）
2. 有 pending request → 匹配最新的 pending request（现有逻辑）
3. 无 pending request → 进入消息队列
   - 1 个活跃 session → 自动路由
   - 多个活跃 session → 发卡片让用户选择
   - 前缀格式：`#session简称 指令内容`

## 消息队列消费

Hook 触发时：
1. 注册/更新 session 信息
2. 检查队列中属于自己 session 的消息
3. 有排队消息 → 直接消费最早一条，不发卡片
4. 无排队消息 → 正常发卡片等待用户回复

## 新增模块

| 模块 | 职责 |
|------|------|
| `lib/session-registry.js` | 会话注册/注销/查询/心跳 |
| `lib/message-queue.js` | 消息入队/出队/按 session 查询 |

## 卡片变化

所有卡片增加机器和会话标识：
```
**机器**: dev-server-01
**会话**: abc123 (项目: /share/project-a)
```

多 session 选择卡片（新增）：
```
📋 当前活跃会话：
[1] dev-server-01 : session-abc (/share/project-a) - 2分钟前
[2] dev-server-02 : session-def (/home/user/app) - 5分钟前
回复数字选择目标会话
```

## 配置变化

`config.json` 新增字段：
```json
{
  "ipcDir": "/share/geshijia/claude-hooks-feishu-ipc",
  "machineId": ""
}
```

## Session 生命周期

- 注册：hook 首次触发时自动注册
- 心跳：每次 hook 触发更新 `lastActivity`
- 过期：超过 7 天无活动标记为 inactive
- 清理：daemon 定期清理过期 session 文件

## IPC 文件格式

### Session 文件 (`sessions/{machineId}_{sessionId}.json`)
```json
{
  "machineId": "dev-server-01",
  "sessionId": "abc-123",
  "cwd": "/share/project-a",
  "pid": 12345,
  "lastActivity": 1740000000000,
  "registeredAt": 1740000000000
}
```

### 队列消息文件 (`queue/msg-{timestamp}-{uuid}.json`)
```json
{
  "id": "uuid",
  "targetMachine": "dev-server-01",
  "targetSession": "abc-123",
  "content": "用户指令内容",
  "action": "message",
  "senderId": "ou_xxx",
  "timestamp": 1740000000000,
  "consumed": false
}
```

### Request 文件变化 (`req-{requestId}.json`)
新增字段：
```json
{
  "machineId": "dev-server-01",
  "sessionId": "abc-123"
}
```

## 依赖

无新增外部依赖，仍使用 `@larksuiteoapi/node-sdk`。

## 文件变更

新增:
- `lib/session-registry.js` — 会话注册表
- `lib/message-queue.js` — 消息队列

修改:
- `lib/ipc.js` — IPC 目录支持配置化，request 增加 machineId/sessionId
- `lib/config.js` — 新增 ipcDir、machineId 配置
- `lib/daemon.js` — handleMessage 增加队列写入和多 session 路由
- `lib/card-builder.js` — 卡片增加机器/会话标识，新增 session 选择卡片
- `hooks/interactive.js` — 注册 session，消费队列消息
- `hooks/guard.js` — 注册 session，request 带 machineId/sessionId
- `hooks/notify.js` — 注册 session
