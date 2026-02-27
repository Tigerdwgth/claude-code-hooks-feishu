import { useEffect, useRef } from 'react';
import PixelApp from './PixelApp';

// session ID (string) → numeric agent ID
const sessionToId = new Map();
let nextAgentId = 1;
function getAgentId(sessionId) {
  if (!sessionToId.has(sessionId)) sessionToId.set(sessionId, nextAgentId++);
  return sessionToId.get(sessionId);
}

export default function PixelView({ ws, activeSessions }) {
  const initializedRef = useRef(false);

  // 把 activeSessions 转成 pixel-agents 期望的 window message
  useEffect(() => {
    // 即使 activeSessions 为空也要初始化 layout
    if (!initializedRef.current) {
      initializedRef.current = true;
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'layoutLoaded', layout: null }
      }));
    }
    const agentIds = activeSessions.map(s => getAgentId(s.sessionId));
    // 发送 existingAgents
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'existingAgents', agents: agentIds, agentMeta: {} }
    }));
  }, [activeSessions.map(s => s.sessionId).join(',')]);

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
