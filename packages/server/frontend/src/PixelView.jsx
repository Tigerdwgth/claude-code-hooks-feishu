import { useEffect, useRef } from 'react';
import PixelApp from './PixelApp';

// session ID (string) → numeric agent ID（双向映射）
const sessionToId = new Map();
const idToSession = new Map();
let nextAgentId = 1;
function getAgentId(sessionId) {
  if (!sessionToId.has(sessionId)) {
    const id = nextAgentId++;
    sessionToId.set(sessionId, id);
    idToSession.set(id, sessionId);
  }
  return sessionToId.get(sessionId);
}

export default function PixelView({ ws, activeSessions, onFocusSession }) {
  const initializedRef = useRef(false);

  // 把 activeSessions 转成 pixel-agents 期望的 window message
  useEffect(() => {
    const agentIds = activeSessions.map(s => getAgentId(s.sessionId));
    // 必须先发 existingAgents（buffer），再发 layoutLoaded（触发 addAgent）
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'existingAgents', agents: agentIds, agentMeta: {} }
    }));
    if (!initializedRef.current) {
      initializedRef.current = true;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'layoutLoaded', layout: null }
      }));
    }
  }, [activeSessions.map(s => s.sessionId).join(',')]);

  // 监听 vscode.postMessage 转发的 pixel:postMessage 事件
  useEffect(() => {
    function onPixelMessage(e) {
      const msg = e.detail;
      if (msg?.type === 'focusAgent') {
        const sessionId = idToSession.get(msg.id);
        if (sessionId && onFocusSession) {
          onFocusSession(sessionId);
        }
      }
    }
    window.addEventListener('pixel:postMessage', onPixelMessage);
    return () => window.removeEventListener('pixel:postMessage', onPixelMessage);
  }, [onFocusSession]);

  // 监听 hook:event（来自 Dashboard ws 消息），更新小人状态
  useEffect(() => {
    function onHookEvent(e) {
      const { hookEvent, sessionId } = e.detail || {};
      if (!sessionId) return;
      const id = getAgentId(sessionId);
      // Stop → idle，Notification → waiting（用 'idle' 表示等待用户）
      const status = hookEvent === 'Stop' ? 'idle' : 'waiting';
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'agentStatus', id, status }
      }));
    }
    window.addEventListener('hook:event', onHookEvent);
    return () => window.removeEventListener('hook:event', onHookEvent);
  }, []);

  // WebSocket agent_status → pixel-agents window messages
  useEffect(() => {
    if (!ws) return;
    function onMessage(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'agent_status') {
          const id = getAgentId(msg.sessionId);
          if (msg.status === 'active' && msg.toolStatus) {
            window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'agentToolStart', id, toolId: msg.toolId || `t-${id}`, status: msg.toolStatus }
            }));
          } else {
            window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'agentStatus', id, status: msg.status || 'active' }
            }));
          }
        }
      } catch {}
    }
    ws.addEventListener('message', onMessage);
    return () => ws.removeEventListener('message', onMessage);
  }, [ws]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <PixelApp />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: '0.6rem', color: '#333', textAlign: 'center', padding: '2px', background: 'rgba(0,0,0,0.5)' }}>
        Pixel art inspired by{' '}
        <a href="https://github.com/georgetrad/pixel-agents" target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>Pixel Agents</a>
        {' '}by Pablo De Lucca — MIT License
      </div>
    </div>
  );
}

