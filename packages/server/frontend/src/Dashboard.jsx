import { useState, useEffect, useRef } from 'react';
import TerminalPanel from './TerminalPanel';
import AddUser from './AddUser';
import SessionTabs from './SessionTabs';
import FileBrowser from './FileBrowser';
import PixelView from './PixelView';

export default function Dashboard({ token, onLogout }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [historySessions, setHistorySessions] = useState([]);
  const [active, setActive] = useState(null);
  const [wsReady, setWsReady] = useState(false);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [viewMode, setViewMode] = useState('terminal'); // 'terminal' | 'pixel'
  const wsRef = useRef(null);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsReady(true);
      // 请求历史 session（用第一个在线机器）
      ws.send(JSON.stringify({ type: 'scan_history', machineId: '_all' }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'session_list') setSessions(msg.sessions || []);
        if (msg.type === 'active_sessions') setActiveSessions((msg.sessions || []).map(s => ({ ...s, machineId: msg.machineId })));
        if (msg.type === 'session_history') setHistorySessions(msg.sessions || []);
      } catch {}
    };
    ws.onclose = () => setWsReady(false);

    return () => ws.close();
  }, [token]);

  function openTerminal(machineId, sessionId, command, cwd) {
    setActive({ machineId, sessionId });
    setShowFileBrowser(false);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'open_terminal', machineId, sessionId,
        cols: 220, rows: 50,
        command: command || ['claude'],
        cwd: cwd || undefined,
      }));
    }
  }

  function launchInDir(cwd) {
    const machineId = wsRef.current ? '_local' : 'local';
    // 用时间戳生成临时 sessionId
    const sessionId = `new-${Date.now()}`;
    openTerminal(machineId, sessionId, ['claude'], cwd);
  }

  return (
    <>
    <div style={{ display: 'flex', height: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'monospace', overflow: 'hidden' }}>
      {/* 左侧面板 */}
      <div style={{ width: '220px', background: '#161b22', borderRight: '1px solid #30363d', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* 顶部工具栏 */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#8b949e' }}>SESSIONS</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: wsReady ? '#3fb950' : '#f85149', display: 'inline-block' }} />
            <span onClick={() => setShowFileBrowser(v => !v)} title="新建终端" style={{ color: '#8b949e', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>＋</span>
            <span onClick={() => setShowAddUser(true)} title="添加用户" style={{ color: '#8b949e', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1 }}>👤</span>
            <button onClick={onLogout} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 4px' }}>退出</button>
          </div>
        </div>

        {/* 文件浏览器（展开时） */}
        {showFileBrowser && (
          <FileBrowser
            ws={wsRef.current}
            machineId={sessions[0]?.machineId || 'local'}
            historySessions={historySessions}
            onLaunch={launchInDir}
            onClose={() => setShowFileBrowser(false)}
          />
        )}

        {/* Session Tabs */}
        <SessionTabs
          sessions={sessions}
          activeSessions={activeSessions}
          historySessions={historySessions}
          active={active}
          onOpen={openTerminal}
        />
      </div>

      {/* 右侧终端/像素区域 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* 切换按钮 */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          {['terminal', 'pixel'].map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              background: viewMode === mode ? '#21262d' : 'none',
              border: '1px solid ' + (viewMode === mode ? '#30363d' : 'transparent'),
              color: viewMode === mode ? '#e6edf3' : '#6e7681',
              borderRadius: '4px', cursor: 'pointer', padding: '2px 10px', fontSize: '0.75rem', marginLeft: '4px'
            }}>{mode === 'terminal' ? '⌨ 终端' : '🎮 像素'}</button>
          ))}
        </div>
        {viewMode === 'pixel' ? (
          <PixelView ws={wsRef.current} activeSessions={activeSessions} />
        ) : active ? (
          <TerminalPanel
            key={`${active.machineId}-${active.sessionId}`}
            machineId={active.machineId}
            sessionId={active.sessionId}
            ws={wsRef.current}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontSize: '2rem' }}>⌨</div>
            <div style={{ fontSize: '0.9rem' }}>从左侧选择 session 或点击 ＋ 新建终端</div>
          </div>
        )}
      </div>
    </div>
    {showAddUser && <AddUser token={token} onClose={() => setShowAddUser(false)} />}
    </>
  );
}
