import { useState, useEffect, useRef, useMemo } from 'react';
import TerminalPanel from './TerminalPanel';
import AddUser from './AddUser';
import SessionTabs from './SessionTabs';
import PixelView from './PixelView';
import MarkdownPreview from './MarkdownPreview';
import MachineSelector from './MachineSelector';
import { useTheme } from './theme';
import useResizable from './useResizable';
import { playSound } from './sound';

export default function Dashboard({ token, onLogout, isDark, onToggleTheme }) {
  const T = useTheme();
  const sidebar = useResizable({ min: 160, max: 400, defaultWidth: 240 });
  const [sessions, setSessions]             = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [historySessions, setHistorySessions] = useState([]);
  const [active, setActive]                 = useState(null);
  const [wsReady, setWsReady]               = useState(false);
  const [showAddUser, setShowAddUser]       = useState(false);
  const [viewMode, setViewMode]             = useState('terminal');
  const [mdPreview, setMdPreview]           = useState(null); // { path, content } or null
  const [openTerminals, setOpenTerminals]   = useState([]); // [{machineId, sessionId, cwd}]
  const [splitTerminals, setSplitTerminals] = useState([]); // 并列显示的 sessionId 列表
  const [splitMode, setSplitMode]           = useState(false);
  const [isMobile, setIsMobile]             = useState(() => window.innerWidth < 768);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState('');
  const wsRef = useRef(null);

  const machines = useMemo(() => {
    const map = new Map();
    sessions.forEach(s => {
      if (!map.has(s.machineId)) {
        map.set(s.machineId, { machineId: s.machineId, sessionCount: 0 });
      }
      map.get(s.machineId).sessionCount++;
    });
    return Array.from(map.values());
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (!selectedMachine) return sessions;
    return sessions.filter(s => s.machineId === selectedMachine);
  }, [sessions, selectedMachine]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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
        if (msg.type === 'active_sessions') {
          const mid = msg.machineId;
          const serverSessions = (msg.sessions || []).map(s => ({ ...s, machineId: mid }));
          setActiveSessions(prev => {
            // 保留其他机器的 session，只替换当前机器的
            const otherMachines = prev.filter(s => s.machineId !== mid && !s._optimistic);
            const optimistic = prev.filter(s => s._optimistic && !serverSessions.some(ss => ss.sessionId === s.sessionId));
            return [...otherMachines, ...serverSessions, ...optimistic];
          });
        }
        if (msg.type === 'session_history') setHistorySessions((msg.sessions || []).map(s => ({ ...s, machineId: s.machineId || msg.machineId })));
        if (msg.type === 'session_deleted') setHistorySessions(prev => prev.filter(s => s.sessionId !== msg.sessionId));
        if (msg.type === 'file_content') {
          if (msg.error) { alert(`文件读取失败: ${msg.error}`); }
          else { setMdPreview({ path: msg.path, content: msg.content }); setViewMode('markdown'); }
        }
        if (msg.type === 'hook_event') {
          // 播放声音提醒
          playSound(msg.hookEvent);
          // 通知 PixelView 更新小人状态
          window.dispatchEvent(new CustomEvent('hook:event', { detail: msg }));
        }
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
    const isResume = command?.includes('--resume');
    const exists = openTerminals.some(t => t.sessionId === sessionId);
    if (!exists) {
      setOpenTerminals(prev => [...prev, { machineId, sessionId, cwd }]);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'open_terminal', machineId, sessionId,
          cols: 220, rows: 50,
          command: command || ['claude'],
          cwd: cwd || undefined,
        }));
      }
      // 乐观更新：恢复的 session 立即出现在运行中 Tab
      if (isResume) {
        setActiveSessions(prev => {
          if (prev.some(s => s.sessionId === sessionId)) return prev;
          return [...prev, { sessionId, machineId, cwd, mtime: new Date().toISOString(), _optimistic: true }];
        });
        setTimeout(() => {
          setActiveSessions(prev => prev.filter(s => !(s.sessionId === sessionId && s._optimistic)));
        }, 10000);
      }
    } else {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'pty_attach', machineId, sessionId,
        }));
      }
    }
    if (splitMode) {
      setSplitTerminals(prev =>
        prev.includes(sessionId) ? prev.filter(id => id !== sessionId) : [...prev, sessionId]
      );
    }
    setActive({ machineId, sessionId });
    setViewMode('terminal');
    if (isMobile) setMobileMenuOpen(false);
  }

  function launchInDir(cwd, command) {
    const mid = sessions[0]?.machineId || activeSessions[0]?.machineId || 'local-dev';
    const sessionId = `new-${Date.now()}`;
    openTerminal(mid, sessionId, command || ['claude'], cwd);
  }

  function previewMd(filePath) {
    const mid = sessions[0]?.machineId || activeSessions[0]?.machineId || 'local-dev';
    wsRef.current?.send(JSON.stringify({ type: 'read_file', machineId: mid, path: filePath }));
  }

  function deleteSession(machineId, sessionId) {
    if (!confirm('确定删除此 session？')) return;
    wsRef.current?.send(JSON.stringify({ type: 'delete_session', machineId, sessionId }));
    setHistorySessions(prev => prev.filter(s => s.sessionId !== sessionId));
  }

  function stopSession(machineId, sessionId) {
    if (!confirm('确定停止此 session？claude 进程将被终止。')) return;
    wsRef.current?.send(JSON.stringify({ type: 'stop_terminal', machineId, sessionId }));
    setOpenTerminals(prev => prev.filter(t => t.sessionId !== sessionId));
    if (active?.sessionId === sessionId) setActive(null);
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
        @media (max-width: 768px) {
          button, [role="button"], a { min-height: 44px; min-width: 44px; }
          .sess-item { padding: 0.5rem 0.6rem !important; }
        }
      `}</style>

      <div style={{
        display: 'flex', height: '100vh',
        background: T.bgBase, color: T.textPrimary,
        fontFamily: T.fontSans, overflow: 'hidden',
      }}>
        {/* 移动端汉堡按钮 */}
        {isMobile && (
          <button onClick={() => setMobileMenuOpen(true)}
            style={{
              position: 'fixed', top: 8, left: 8, zIndex: 1001,
              background: T.bgCard, border: `1px solid ${T.border}`,
              color: T.textPrimary, borderRadius: T.radiusSm,
              cursor: 'pointer', padding: '6px 10px', fontSize: '1rem',
            }}>
            ☰
          </button>
        )}

        {/* 移动端遮罩层 */}
        {isMobile && mobileMenuOpen && (
          <div onClick={() => setMobileMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />
        )}

        {/* ── 左侧面板 ── */}
        <div style={{
          width: isMobile ? '280px' : `${sidebar.width}px`,
          flexShrink: 0,
          background: T.bgPanel,
          borderRight: `1px solid ${T.border}`,
          display: 'flex', flexDirection: 'column',
          transition: sidebar.dragging ? 'none' : 'width 0.2s ease, transform 0.25s ease',
          overflow: 'hidden', position: isMobile ? 'fixed' : 'relative',
          ...(isMobile ? {
            top: 0, left: 0, bottom: 0, zIndex: 1000,
            transform: mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)',
            boxShadow: mobileMenuOpen ? '4px 0 24px rgba(0,0,0,0.5)' : 'none',
          } : {}),
          animation: isMobile ? 'none' : 'slideIn 0.3s ease',
        }}>
          {/* 折叠按钮 */}
          <button
            onClick={sidebar.toggle}
            style={{
              position: 'absolute', top: '8px', right: '6px', zIndex: 2,
              background: 'none', border: 'none', color: T.textMuted,
              cursor: 'pointer', fontSize: '0.8rem', padding: '2px 4px',
              borderRadius: T.radiusSm, transition: 'color 0.15s',
            }}
            title={sidebar.collapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            {sidebar.collapsed ? '›' : '‹'}
          </button>
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
              <span style={{ fontWeight: 600, fontSize: '0.875rem', letterSpacing: '-0.01em', display: sidebar.collapsed ? 'none' : 'inline' }}>Claude Code</span>
            </div>

            {/* 连接状态 badge */}
            {!sidebar.collapsed && (
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
            )}
          </div>

          {/* 工具栏 */}
          {!sidebar.collapsed && (
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
          )}

          {/* Session Tabs */}
          {!sidebar.collapsed ? (
            <>
              <MachineSelector
                machines={machines}
                currentMachine={selectedMachine}
                onSelect={setSelectedMachine}
              />
              <SessionTabs
                sessions={filteredSessions}
                activeSessions={activeSessions}
                historySessions={historySessions}
                openTerminals={openTerminals}
                active={active}
                onOpen={openTerminal}
                onDelete={deleteSession}
                onStop={stopSession}
                ws={wsRef.current}
                machineId={sessions[0]?.machineId || activeSessions[0]?.machineId || 'local'}
                onLaunch={launchInDir}
                onPreviewMd={previewMd}
              />
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
              <button className="sidebar-btn" onClick={() => sidebar.toggle()} title="活跃" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: '1rem', padding: '6px' }}>📡</button>
              <button className="sidebar-btn" onClick={() => sidebar.toggle()} title="运行中" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: '1rem', padding: '6px' }}>⚡</button>
              <button className="sidebar-btn" onClick={() => sidebar.toggle()} title="历史" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: '1rem', padding: '6px' }}>📁</button>
            </div>
          )}

          {/* 拖拽手柄 */}
          <div
            onMouseDown={sidebar.onMouseDown}
            onDoubleClick={sidebar.onDoubleClick}
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0,
              width: '4px', cursor: 'col-resize',
              background: sidebar.dragging ? T.accent : 'transparent',
              transition: 'background 0.15s',
            }}
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
          {[
            { key: 'terminal', label: '⌨ 终端' },
            { key: 'pixel', label: '🎮 像素' },
            ...(mdPreview ? [{ key: 'markdown', label: '📄 预览' }] : []),
          ].map(({ key, label }) => (
              <button
                key={key}
                className="view-pill"
                onClick={() => setViewMode(key)}
                style={{
                  background: viewMode === key ? T.bgHover : 'none',
                  border: `1px solid ${viewMode === key ? T.border : 'transparent'}`,
                  color: viewMode === key ? T.textPrimary : T.textMuted,
                  borderRadius: T.radiusPill,
                  cursor: 'pointer', padding: '3px 12px',
                  fontSize: '0.72rem', fontWeight: 500,
                  fontFamily: T.fontSans,
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            ))}
            <button
              className="view-pill"
              onClick={() => {
                if (!splitMode) {
                  setSplitTerminals(active ? [active.sessionId] : []);
                  setSplitMode(true);
                } else {
                  setSplitMode(false);
                  setSplitTerminals([]);
                }
              }}
              style={{
                background: splitMode ? T.accentDim : 'none',
                border: `1px solid ${splitMode ? T.borderAccent : 'transparent'}`,
                color: splitMode ? T.accent : T.textMuted,
                borderRadius: T.radiusPill,
                cursor: 'pointer', padding: '3px 12px',
                fontSize: '0.72rem', fontWeight: 500,
                fontFamily: T.fontSans,
                transition: 'all 0.15s',
              }}
            >
              {splitMode ? '⊡ 单窗口' : '⊞ 并列'}
            </button>
          </div>

          {/* 内容区：终端始终挂载，避免切视图时 xterm 实例被销毁 */}
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
            {/* 终端层（始终挂载，仅在非终端视图时隐藏） */}
            <div style={{ flex: 1, display: viewMode === 'terminal' ? 'flex' : 'none', overflow: 'hidden' }}>
              {openTerminals.map(t => (
                <TerminalPanel
                  key={t.sessionId}
                  machineId={t.machineId}
                  sessionId={t.sessionId}
                  ws={wsRef.current}
                  visible={splitMode
                    ? splitTerminals.includes(t.sessionId)
                    : active?.sessionId === t.sessionId}
                  style={splitMode && splitTerminals.includes(t.sessionId)
                    ? { flex: 1, borderRight: `1px solid ${T.border}` }
                    : {}}
                />
              ))}
              {!active && (
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
                    从左侧面板选择，或点击"目录" Tab
                  </div>
                </div>
              )}
            </div>

            {/* 像素视图层 */}
            {viewMode === 'pixel' && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <PixelView ws={wsRef.current} activeSessions={(() => {
                  // 合并 activeSessions（服务器扫描）和 openTerminals（浏览器打开），去重
                  const merged = [...activeSessions];
                  for (const t of openTerminals) {
                    if (!merged.some(s => s.sessionId === t.sessionId)) merged.push(t);
                  }
                  return merged;
                })()} onFocusSession={(sessionId) => {
                  // 找到对应 session，切换到终端视图并激活
                  const found = [...openTerminals, ...activeSessions].find(s => s.sessionId === sessionId);
                  if (found) {
                    setActive({ machineId: found.machineId, sessionId });
                    setViewMode('terminal');
                  } else {
                    // session 不在已打开列表，直接切回终端视图
                    setViewMode('terminal');
                  }
                }} />
              </div>
            )}

            {/* Markdown 预览层 */}
            {viewMode === 'markdown' && mdPreview && (
              <div style={{ position: 'absolute', inset: 0, background: T.bgBase, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <MarkdownPreview
                  path={mdPreview.path}
                  content={mdPreview.content}
                  onClose={() => { setMdPreview(null); setViewMode('terminal'); }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddUser && <AddUser token={token} onClose={() => setShowAddUser(false)} />}
    </>
  );
}
