import { useState } from 'react';

const TAB_STYLE = (active) => ({
  flex: 1, padding: '0.4rem 0', fontSize: '0.72rem', textAlign: 'center',
  cursor: 'pointer', borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
  color: active ? '#58a6ff' : '#6e7681', background: 'none', border: 'none',
  borderBottom: active ? '2px solid #58a6ff' : '2px solid transparent',
});

const ITEM_STYLE = (selected) => ({
  padding: '0.3rem 0.75rem', cursor: 'pointer', borderRadius: '4px',
  fontSize: '0.78rem', position: 'relative',
  background: selected ? '#21262d' : 'transparent',
  color: selected ? '#58a6ff' : '#8b949e',
  borderLeft: selected ? '2px solid #58a6ff' : '2px solid transparent',
});

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  return `${Math.floor(h / 24)}天前`;
}

// ── 活跃 Tab ──────────────────────────────────────────────────
function ActiveTab({ sessions, active, onOpen }) {
  const byMachine = sessions.reduce((acc, s) => {
    (acc[s.machineId] = acc[s.machineId] || []).push(s);
    return acc;
  }, {});
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
      {Object.entries(byMachine).map(([machineId, sess]) => (
        <div key={machineId} style={{ marginBottom: '0.75rem' }}>
          <div style={{ color: '#3fb950', fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>● {machineId}</div>
          {sess.map(s => (
            <div key={s.id} onClick={() => onOpen(machineId, s.id, ['claude'], s.cwd)}
              style={ITEM_STYLE(active?.sessionId === s.id && active?.machineId === machineId)}>
              {s.id.slice(0, 8)}…
              {s.cwd && <span style={{ color: '#6e7681', marginLeft: '4px' }}>({s.cwd.split('/').pop() || '/'})</span>}
            </div>
          ))}
        </div>
      ))}
      {sessions.length === 0 && (
        <div style={{ color: '#6e7681', fontSize: '0.75rem', padding: '0.5rem', textAlign: 'center' }}>等待开发机连接…</div>
      )}
    </div>
  );
}

// ── 运行中 Tab ────────────────────────────────────────────────
function RunningTab({ activeSessions, active, onOpen }) {
  const byMachine = activeSessions.reduce((acc, s) => {
    const mid = s.machineId || 'local';
    (acc[mid] = acc[mid] || []).push(s);
    return acc;
  }, {});
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
      {Object.entries(byMachine).map(([machineId, sess]) => (
        <div key={machineId} style={{ marginBottom: '0.75rem' }}>
          <div style={{ color: '#3fb950', fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>● {machineId}</div>
          {sess.map(s => (
            <div key={s.sessionId}
              onClick={() => onOpen(machineId, s.sessionId, ['claude', '--resume', s.sessionId], s.cwd)}
              style={ITEM_STYLE(active?.sessionId === s.sessionId)}>
              {s.sessionId.slice(0, 8)}…
              <span style={{ color: '#6e7681', marginLeft: '4px' }}>({s.cwd?.split('/').pop() || '/'})</span>
              <span style={{ color: '#6e7681', fontSize: '0.68rem', marginLeft: '4px' }}>
                {timeAgo(s.mtime)}
              </span>
            </div>
          ))}
        </div>
      ))}
      {activeSessions.length === 0 && (
        <div style={{ color: '#6e7681', fontSize: '0.75rem', padding: '0.5rem', textAlign: 'center' }}>无活跃 CC session</div>
      )}
    </div>
  );
}

// ── 历史 Tab ──────────────────────────────────────────────────
function HistoryTab({ historySessions, active, onOpen }) {
  const [hovered, setHovered] = useState(null);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
      {historySessions.map(s => (
        <div key={s.sessionId}
          onMouseEnter={() => setHovered(s.sessionId)}
          onMouseLeave={() => setHovered(null)}
          style={{ ...ITEM_STYLE(active?.sessionId === s.sessionId), display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ color: '#58a6ff', fontSize: '0.75rem' }}>{s.cwd?.split('/').pop() || '/'}</span>
              {s.gitBranch && <span style={{ color: '#3fb950', fontSize: '0.65rem' }}>{s.gitBranch}</span>}
              <span style={{ color: '#6e7681', fontSize: '0.65rem', marginLeft: 'auto' }}>{s.timestamp?.slice(0, 10)}</span>
            </div>
            {s.summary && (
              <div style={{ color: '#6e7681', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.summary}
              </div>
            )}
          </div>
          {hovered === s.sessionId && (
            <div style={{ display: 'flex', gap: '4px', marginLeft: '6px', flexShrink: 0 }}>
              <button title="在此目录启动 claude"
                onClick={(e) => { e.stopPropagation(); onOpen(s.machineId || 'local', s.sessionId, ['claude'], s.cwd); }}
                style={{ background: '#21262d', border: '1px solid #30363d', color: '#3fb950', borderRadius: '3px', cursor: 'pointer', padding: '1px 5px', fontSize: '0.75rem' }}>▶</button>
              <button title={`claude --resume ${s.sessionId}`}
                onClick={(e) => { e.stopPropagation(); onOpen(s.machineId || 'local', s.sessionId, ['claude', '--resume', s.sessionId], s.cwd); }}
                style={{ background: '#21262d', border: '1px solid #30363d', color: '#58a6ff', borderRadius: '3px', cursor: 'pointer', padding: '1px 5px', fontSize: '0.75rem' }}>↩</button>
            </div>
          )}
        </div>
      ))}
      {historySessions.length === 0 && (
        <div style={{ color: '#6e7681', fontSize: '0.75rem', padding: '0.5rem', textAlign: 'center' }}>无历史 session</div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
export default function SessionTabs({ sessions, activeSessions, historySessions, active, onOpen }) {
  const [tab, setTab] = useState('active');
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
        {[['active', '活跃'], ['running', '运行中'], ['history', '历史']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={TAB_STYLE(tab === key)}>{label}</button>
        ))}
      </div>
      {tab === 'active' && <ActiveTab sessions={sessions} active={active} onOpen={onOpen} />}
      {tab === 'running' && <RunningTab activeSessions={activeSessions} active={active} onOpen={onOpen} />}
      {tab === 'history' && <HistoryTab historySessions={historySessions} active={active} onOpen={onOpen} />}
    </div>
  );
}
