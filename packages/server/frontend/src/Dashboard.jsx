import { useState, useEffect, useRef } from 'react';
import TerminalPanel from './TerminalPanel';
import AddUser from './AddUser';
import SessionTabs from './SessionTabs';
import FileBrowser from './FileBrowser';
import PixelView from './PixelView';
import { useTheme } from './theme';

export default function Dashboard({ token, onLogout, isDark, onToggleTheme }) {
  const T = useTheme();
  const [sessions, setSessions]             = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [historySessions, setHistorySessions] = useState([]);
  const [active, setActive]                 = useState(null);
  const [wsReady, setWsReady]               = useState(false);
  const [showAddUser, setShowAddUser]       = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [viewMode, setViewMode]             = useState('terminal');
  const wsRef = useRef(null);

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const basePath = location.pathname.replace(/\/+$/, '');
    const wsUrl = `${proto}://${location.host}${basePath}/ws?token=${token}`;
    console.log('[dashboard] WebSocket connecting to:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => {
      console.log('[dashboard] WebSocket connected');
      setWsReady(true);
      ws.send(JSON.stringify({ type: 'scan_history', machineId: '_all' }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log('[dashboard] ←', msg.type);
        if (msg.type === 'session_list')    setSessions(msg.sessions || []);
        if (msg.type === 'active_sessions') setActiveSessions((msg.sessions || []).map(s => ({ ...s, machineId: msg.machineId })));
        if (msg.type === 'session_history') setHistorySessions((msg.sessions || []).map(s => ({ ...s, machineId: s.machineId || msg.machineId })));
      } catch {}
    };
    ws.onerror = (e) => console.error('[dashboard] WebSocket error:', e);
    ws.onclose = (e) => {
      console.log('[dashboard] WebSocket closed:', e.code, e.reason);
      setWsReady(false);
      // Token 无效时自动登出，让用户重新登录
      if (e.code === 4001) onLogout();
    };
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
    const machineId = sessions[0]?.machineId || activeSessions[0]?.machineId || 'local-dev';
    const sessionId = `new-${Date.now()}`;
    openTerminal(machineId, sessionId, ['claude'], cwd);
  }

  const machineId = sessions[0]?.machineId || activeSessions[0]?.machineId;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .sidebar-btn:hover { background: ${T.bgHover} !important; color: ${T.textPrimary} !important; }
        .view-pill:hover { background: ${T.bgHover} !important; }
        .topbar-btn:hover { background: ${T.bgHover} !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes slideIn { from{opacity:0;transform:translateX(-8px)} to{opacity:1;transform:translateX(0)} }
      `}</style>

      <div style={{
        display: 'flex', height: '100vh',
        background: T.bgBase, color: T.textPrimary,
        fontFamily: T.fontSans, overflow: 'hidden',
      }}>
        {/* ── 左侧面板 ── */}
        <div style={{
          width: '240px', flexShrink: 0,
          background: T.bgPanel,
          borderRight: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
          animation: 'slideIn 0.3s ease',
        }}>
          {/* 顶部 Logo + 状态 */}
          <div style={{
            padding: '0.875rem 1rem',
            borderBottom: `1px solid ${T.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '6px',
                background: `linear-gradient(135deg, ${T.accent}, #818cf8)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', flexShrink: 0,
              }}>⌨</div>
              <span style={{ fontWeight: 600, fontSize: '0.875rem', letterSpacing: '-0.01em' }}>Claude Code</span>
            </div>

            {/* 连接状态 badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '3px 8px', borderRadius: T.radiusPill,
              background: wsReady ? T.successDim : T.dangerDim,
              border: `1px solid ${wsReady ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
              fontSize: '0.7rem', fontWeight: 500,
              color: wsReady ? T.success : T.danger,
            }}>
              <span style={{
                width: '5px', height: '5px', borderRadius: '50%',
                background: wsReady ? T.success : T.danger,
                animation: wsReady ? 'none' : 'pulse 1.5s infinite',
                display: 'inline-block',
              }} />
              {wsReady ? (machineId || '已连接') : '连接中…'}
            </div>
          </div>

          {/* 工具栏 */}
          <div style={{
            padding: '0.5rem 0.75rem',
            borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: '4px',
          }}>
            <span style={{
              flex: 1, fontSize: '0.68rem', fontWeight: 600,
              color: T.textMuted, letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>Sessions</span>
            <button
              className="sidebar-btn"
              onClick={() => setShowFileBrowser(v => !v)}
              title="新建终端"
              style={{
                background: showFileBrowser ? T.accentDim : 'none',
                border: `1px solid ${showFileBrowser ? T.borderAccent : 'transparent'}`,
                color: showFileBrowser ? T.accent : T.textMuted,
                borderRadius: T.radiusSm, cursor: 'pointer',
                padding: '3px 7px', fontSize: '0.8rem',
                transition: 'all 0.15s',
              }}>＋</button>
            <button
              className="sidebar-btn"
              onClick={() => setShowAddUser(true)}
              title="添加用户"
              style={{
                background: 'none', border: '1px solid transparent',
                color: T.textMuted, borderRadius: T.radiusSm,
                cursor: 'pointer', padding: '3px 6px', fontSize: '0.78rem',
                transition: 'all 0.15s',
              }}>👤</button>
            <button
              className="sidebar-btn"
              onClick={onLogout}
              title="退出登录"
              style={{
                background: 'none', border: '1px solid transparent',
                color: T.textMuted, borderRadius: T.radiusSm,
                cursor: 'pointer', padding: '3px 6px', fontSize: '0.72rem',
                transition: 'all 0.15s',
              }}>⏻</button>
          </div>

          {/* 文件浏览器 */}
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

        {/* ── 右侧主区域 ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 顶栏 */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            padding: '6px 12px',
            borderBottom: `1px solid ${T.border}`,
            background: T.bgPanel, flexShrink: 0,
            gap: '4px',
          }}>
            {/* 主题切换 */}
          <button
            className="view-pill"
            onClick={onToggleTheme}
            title={isDark ? '切换到日间模式' : '切换到夜间模式'}
            style={{
              background: 'none',
              border: `1px solid transparent`,
              color: T.textMuted,
              borderRadius: T.radiusPill,
              cursor: 'pointer', padding: '3px 10px',
              fontSize: '0.85rem',
              transition: 'all 0.15s',
              marginRight: '4px',
            }}
          >
            {isDark ? '☀' : '🌙'}
          </button>
          {['terminal', 'pixel'].map(mode => (
              <button
                key={mode}
                className="view-pill"
                onClick={() => setViewMode(mode)}
                style={{
                  background: viewMode === mode ? T.bgHover : 'none',
                  border: `1px solid ${viewMode === mode ? T.border : 'transparent'}`,
                  color: viewMode === mode ? T.textPrimary : T.textMuted,
                  borderRadius: T.radiusPill,
                  cursor: 'pointer', padding: '3px 12px',
                  fontSize: '0.72rem', fontWeight: 500,
                  fontFamily: T.fontSans,
                  transition: 'all 0.15s',
                }}
              >
                {mode === 'terminal' ? '⌨ 终端' : '🎮 像素'}
              </button>
            ))}
          </div>

          {/* 内容区 */}
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
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: '0.75rem',
              color: T.textMuted,
            }}>
              <div style={{
                width: '56px', height: '56px', borderRadius: '14px',
                background: T.bgCard, border: `1px solid ${T.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.5rem', marginBottom: '0.25rem',
              }}>⌨</div>
              <div style={{ fontSize: '0.9rem', color: T.textSecondary, fontWeight: 500 }}>
                选择 Session 或新建终端
              </div>
              <div style={{ fontSize: '0.78rem', color: T.textMuted }}>
                从左侧面板选择，或点击 ＋ 按钮
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddUser && <AddUser token={token} onClose={() => setShowAddUser(false)} />}
    </>
  );
}
