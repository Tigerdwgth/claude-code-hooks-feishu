import { useEffect, useRef, useCallback } from 'react';
import { OfficeState } from './pixel-office/engine/officeState.js';
import { OfficeCanvas } from './pixel-office/components/OfficeCanvas.js';
import { useExtensionMessages } from './pixel-hooks/useExtensionMessages.js';
import { playDoneSound } from './pixel-notificationSound.js';

// session ID (string) → numeric agent ID
const sessionToId = new Map();
let nextAgentId = 1;

function getAgentId(sessionId) {
  if (!sessionToId.has(sessionId)) sessionToId.set(sessionId, nextAgentId++);
  return sessionToId.get(sessionId);
}

const officeStateRef = { current: null };
function getOfficeState() {
  if (!officeStateRef.current) officeStateRef.current = new OfficeState();
  return officeStateRef.current;
}

export default function PixelView({ ws, activeSessions }) {
  const dispatchRef = useRef(null);

  // useExtensionMessages 监听 window 'message' 事件
  // 我们通过 dispatchRef 手动 dispatch 消息
  const { agents, agentTools, agentStatuses } = useExtensionMessages(getOfficeState);

  // 把 WebSocket 消息转换成 pixel-agents 期望的 window message 格式
  useEffect(() => {
    if (!ws) return;
    function onMessage(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'agent_status') {
          const id = getAgentId(msg.sessionId);
          // 派发为 window message，useExtensionMessages 会处理
          window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'agentStatus', id, status: msg.status }
          }));
          if (msg.toolStatus) {
            window.dispatchEvent(new MessageEvent('message', {
              data: { type: 'agentToolStart', id, toolId: msg.toolId || msg.sessionId, status: msg.toolStatus }
            }));
          }
        }
      } catch {}
    }
    ws.addEventListener('message', onMessage);
    return () => ws.removeEventListener('message', onMessage);
  }, [ws]);

  // 同步 activeSessions → pixel agents
  useEffect(() => {
    for (const s of activeSessions) {
      const id = getAgentId(s.sessionId);
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'existingAgents', agents: [id], agentMeta: {} }
      }));
    }
    // 发送默认 layout
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'layoutLoaded', layout: null }
    }));
  }, [activeSessions.map(s => s.sessionId).join(',')]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#0d1117' }}>
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <OfficeCanvas
          getOfficeState={getOfficeState}
          agents={agents}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentCharacters={[]}
          selectedAgent={null}
          onAgentClick={() => {}}
          isEditMode={false}
          editorState={null}
          onEditorAction={null}
          zoom={1}
        />
      </div>
      <div style={{ fontSize: '0.65rem', color: '#444', textAlign: 'center', padding: '4px', borderTop: '1px solid #21262d' }}>
        Pixel art inspired by{' '}
        <a href="https://github.com/georgetrad/pixel-agents" target="_blank" rel="noreferrer" style={{ color: '#58a6ff' }}>
          Pixel Agents
        </a>
        {' '}by Pablo De Lucca — MIT License
      </div>
    </div>
  );
}
