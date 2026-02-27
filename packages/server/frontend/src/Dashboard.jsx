import { useState, useEffect, useRef } from 'react';
import TerminalPanel from './TerminalPanel';

export default function Dashboard({ token, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [active, setActive] = useState(null); // { machineId, sessionId }
  const [wsReady, setWsReady] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => setWsReady(true);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'session_list') setSessions(msg.sessions || []);
      } catch {}
    };
    ws.onclose = () => setWsReady(false);

    return () => ws.close();
  }, [token]);

  function openTerminal(machineId, sessionId) {
    setActive({ machineId, sessionId });
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'open_terminal', machineId, sessionId, cols: 220, rows: 50
      }));
    }
  }

  // 按机器分组
  const byMachine = sessions.reduce((acc, s) => {
    (acc[s.machineId] = acc[s.machineId] || []).push(s);
    return acc;
  }, {});

  return (
    <div style={{ display:'flex', height:'100vh', background:'#0d1117', color:'#e6edf3', fontFamily:'monospace', overflow:'hidden' }}>
      {/* 左侧 session 列表 */}
      <div style={{ width:'220px', background:'#161b22', borderRight:'1px solid #30363d', display:'flex', flexDirection:'column', flexShrink:0 }}>
        <div style={{ padding:'0.75rem 1rem', borderBottom:'1px solid #30363d', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontWeight:'bold', fontSize:'0.85rem', color:'#8b949e' }}>SESSIONS</span>
          <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            <span style={{ width:'6px', height:'6px', borderRadius:'50%', background: wsReady ? '#3fb950' : '#f85149', display:'inline-block' }} />
            <button
              onClick={onLogout}
              style={{ background:'none', border:'none', color:'#8b949e', cursor:'pointer', fontSize:'0.75rem', padding:'2px 4px' }}
            >退出</button>
          </div>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'0.5rem' }}>
          {Object.entries(byMachine).map(([machineId, sess]) => (
            <div key={machineId} style={{ marginBottom:'0.75rem' }}>
              <div style={{ color:'#3fb950', fontSize:'0.75rem', padding:'0.25rem 0.5rem', marginBottom:'0.25rem' }}>
                ● {machineId}
              </div>
              {sess.map(s => (
                <div
                  key={s.id}
                  onClick={() => openTerminal(machineId, s.id)}
                  style={{
                    padding:'0.3rem 0.75rem',
                    cursor:'pointer',
                    borderRadius:'4px',
                    fontSize:'0.78rem',
                    background: active?.sessionId === s.id && active?.machineId === machineId ? '#21262d' : 'transparent',
                    color: active?.sessionId === s.id && active?.machineId === machineId ? '#58a6ff' : '#8b949e',
                    borderLeft: active?.sessionId === s.id && active?.machineId === machineId ? '2px solid #58a6ff' : '2px solid transparent'
                  }}
                >
                  {s.id.slice(0, 8)}…
                  {s.cwd ? <span style={{ color:'#6e7681', marginLeft:'4px' }}>({s.cwd.split('/').pop() || '/'})</span> : null}
                </div>
              ))}
            </div>
          ))}
          {sessions.length === 0 && (
            <div style={{ color:'#6e7681', fontSize:'0.78rem', padding:'0.5rem', textAlign:'center' }}>
              等待开发机连接…
            </div>
          )}
        </div>
      </div>

      {/* 右侧终端区域 */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {active ? (
          <TerminalPanel
            key={`${active.machineId}-${active.sessionId}`}
            machineId={active.machineId}
            sessionId={active.sessionId}
            ws={wsRef.current}
          />
        ) : (
          <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', color:'#6e7681', flexDirection:'column', gap:'0.5rem' }}>
            <div style={{ fontSize:'2rem' }}>⌨</div>
            <div style={{ fontSize:'0.9rem' }}>从左侧选择一个 session 打开终端</div>
          </div>
        )}
      </div>
    </div>
  );
}
