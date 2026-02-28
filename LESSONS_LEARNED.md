# Lessons Learned

## 2026-02-27: Relay 单 session watching 导致并列模式失效

**问题**: relay.js 每个浏览器连接只用单个 `watchingMachine` + `watchingSession` 变量跟踪，并列模式下打开多个终端时后开的会覆盖前一个，导致只有最后一个终端能收到 pty_data。

**修复**: 改用 `Set<"machineId:sessionId">` 支持同时 watch 多个 session。

**教训**: 设计数据路由时，要考虑一对多的场景。单值变量天然不支持多路复用。

## 2026-02-27: scanActiveSessions 无去重导致重复 session

**问题**: `scanActiveSessions()` 遍历所有 `.jsonl` 文件，同一 sessionId 在多个项目目录下有文件时会重复返回。

**修复**: 用 `Map<sessionId, data>` 去重，保留 mtime 最新的。

**教训**: 任何扫描文件系统生成列表的函数，都要考虑去重。

## 2026-02-27: 前端 active_sessions 全量替换丢失多机数据

**问题**: 前端收到某台机器的 `active_sessions` 时，用该机器的数据替换了整个 `activeSessions` 状态，导致其他机器的 session 被清空。

**修复**: 按 `machineId` 分区合并 — 只替换当前机器的 session，保留其他机器的。

**教训**: 处理来自多源的增量更新时，必须按来源分区合并，不能全量替换。

## 2026-02-27: WebSocket 消息类型不匹配导致终端输入失效

**问题**: 浏览器发送 `terminal_input`，relay.js 原样转发给开发机，但 ws-client.js 只处理 `pty_input`。消息类型不匹配导致输入被静默丢弃，PTY 输出正常但无法输入。

**修复**: relay.js 在转发时做类型翻译：`terminal_input` → `pty_input`，`terminal_resize` → `pty_resize`。

**教训**: 当系统有多层协议（浏览器协议 vs 机器协议）时，中间层（relay）必须负责协议翻译。设计时应统一命名，或在 relay 层明确做映射。调试时先检查消息类型是否在每一层都被正确处理。

## 2026-02-27: xterm.js useEffect stale closure 导致 ws 引用过期

**问题**: TerminalPanel 的 `useEffect` 依赖数组为 `[]`，`ws` prop 在 closure 中被捕获为初始值。如果 ws 在组件挂载后才就绪或重连，closure 中的 ws 是 stale 的。

**修复**: 用 `useRef(ws)` + 独立的 `useEffect(() => { wsRef.current = ws }, [ws])` 保持引用最新。所有 ws 操作使用 `wsRef.current`。

**教训**: React useEffect 中引用外部变量时，如果不想把它加入依赖数组（避免重建），必须用 ref 包装。这是 React hooks 的经典陷阱。

## 2026-02-28: "活跃" 和 "运行中" Tab 语义混淆导致用户困惑

**问题**: 原"活跃" Tab 显示的是 hook 系统注册的 claude 进程（IPC 注册），"运行中"显示的是 30s 内写过 jsonl 的进程。两者都是"活跃类"，对用户来说看不出区别，且从 web dashboard 启动的终端不走 hook 注册，导致不出现在"活跃" Tab。

**修复**: 将"活跃" Tab 改为"已打开"（显示当前页面打开的 PTY 终端 `openTerminals`），"运行中"保留（显示机器上活跃的 claude 进程）。两者语义不再重叠。

**教训**: UI Tab 的命名和数据源必须有清晰、不重叠的语义。设计前先问"用户怎么区分这两个 Tab？"，如果连开发者都说不清区别，用户更不可能理解。

## 2026-02-28: Playwright MCP root 环境需要 --no-sandbox

**问题**: 在 root 用户的 Docker/远程环境中，Playwright MCP 的 Chromium 默认启用 sandbox，root 下会直接 crash 并报 `Running as root without --no-sandbox is not supported`。

**修复**: 方式 1 — 修改 `.mcp.json` 加 `--no-sandbox` 参数（需重启会话生效）。方式 2 — 使用 Playwright Node API 直接启动 `chromium.launch({ chromiumSandbox: false, executablePath: '/opt/google/chrome/chrome' })`。

**教训**: 在服务器/容器环境中使用浏览器自动化，sandbox 兼容性是第一个要解决的问题。优先用系统已安装的 Chrome + `chromiumSandbox: false`。

## 2026-02-28: Server 启动缺少 MACHINE_TOKENS 环境变量导致 Dashboard 无 session

**问题**: Web Dashboard server 启动时未设置 `MACHINE_TOKENS` 环境变量，导致开发机 ws-client 连接被拒绝（token 验证失败），浏览器端看不到任何 session。同时 daemon 进程也未启动，没有进程向 server 推送 session 数据。

**完整启动流程**:
1. `MACHINE_TOKENS=<token> node packages/server/index.js` — 启动 server，必须带环境变量
2. 启动 daemon（自动启动 ws-client 连接 server）— `startDaemon(appId, appSecret)`
3. daemon 配置中 `centralServer.machineToken` 必须在 server 的 `MACHINE_TOKENS` 列表中

**教训**: 分布式系统启动时，认证凭据必须两端匹配。Server 端的 `MACHINE_TOKENS` env var 和 client 端的 `centralServer.machineToken` config 缺一不可。建议将启动命令写成脚本或 systemd unit，避免每次手动输入遗漏环境变量。

## 2026-02-28: _readFile 白名单安全检查导致非 home 目录文件无法读取

**问题**: `ws-client.js` 的 `_readFile()` 用 `resolved.startsWith(os.homedir())` 做白名单检查，只允许读取 home 目录（`/root`）下的文件。但实际项目文件在 `/share/geshijia/` 等非 home 路径下，导致所有 MD 预览都返回 `Access denied`。

**根因**: 安全策略用了过于严格的白名单模式，没有考虑到工作目录不在 home 下的场景。

**修复**: 改为黑名单模式 — 只禁止敏感目录（`.ssh`、`.gnupg`、`.aws`、`.env`）和系统关键路径（`/etc/shadow`、`/proc`、`/sys`），其余路径均允许访问。新增 `config.fileAccess` 可配置项，不同机器可自定义黑名单。

**教训**: 文件访问的安全检查应基于"禁止已知敏感路径"（黑名单）而非"仅允许 home 目录"（白名单），因为开发者的工作目录经常不在 home 下（如 `/share`、`/data`、`/workspace`）。

## 2026-02-28: git stash -u + filter-branch + gc 导致 untracked 文件丢失

**问题**: 执行 `git stash -u` 暂存修改（含 untracked 文件），然后 `git filter-branch` 重写历史，再 `git gc --prune=now --aggressive` 清理。stash pop 恢复了 tracked 文件的修改，但 untracked 文件（如 LESSONS_LEARNED.md、MarkdownPreview.jsx）的 blob 被 gc 清除，无法恢复。

**教训**: filter-branch 前应该先手动备份 untracked 文件到安全位置（如 `/tmp`），不要依赖 git stash 在历史重写场景下的可靠性。或者先 commit 所有文件再做 filter-branch。
