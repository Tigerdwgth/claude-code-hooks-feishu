// Shim: 替换 VS Code API，用 WebSocket 消息代替
// pixel-agents 组件通过 vscode.postMessage 发消息，我们不需要这个方向
// 只需要 window.addEventListener('message', ...) 方向（从服务端推送）
export const vscode = {
  postMessage: (_msg: unknown) => { /* no-op: 我们不需要从 webview 发消息给 extension */ },
};
