import { useState } from 'react';
import { useTheme } from './theme';
import FileBrowser from './FileBrowser';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const itemStyle = (T, selected) => ({
  padding: '0.35rem 0.6rem',
  cursor: 'pointer',
  borderRadius: T.radiusSm,
  fontSize: '0.78rem',
  background: selected ? T.accentDim : 'transparent',
  color: selected ? T.accent : T.textSecondary,
  borderLeft: `2px solid ${selected ? T.accent : 'transparent'}`,
  transition: 'all 0.12s',
  display: 'flex', alignItems: 'center', gap: '6px',
});

const machineBadge = (T) => ({
  display: 'inline-flex', alignItems: 'center', gap: '4px',
  padding: '2px 7px', borderRadius: T.radiusPill,
  background: T.successDim,
  border: '1px solid rgba(16,185,129,0.2)',
  color: T.success, fontSize: '0.65rem', fontWeight: 600,
  marginBottom: '4px', marginTop: '2px',
});

// ── 已打开 Tab ──────────────────────────────────────────────────
function OpenedTab({ openTerminals, active, onOpen, onStop }) {
  const T = useTheme();
  const byMachine = openTerminals.reduce((acc, t) => {
    const mid = t.machineId || 'local';
    (acc[mid] = acc[mid] || []).push(t);
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
      <style>{`.sess-item:hover { background: ${T.bgHover} !important; color: ${T.textPrimary} !important; }`}</style>
      {Object.entries(byMachine).map(([machineId, terms]) => (
        <div key={machineId} style={{ marginBottom: '0.75rem' }}>
          <div style={machineBadge(T)}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: T.accent, display: 'inline-block' }} />
            {machineId}
          </div>
          {terms.map(t => (
            <div
              key={t.sessionId}
              className="sess-item"
              onClick={() => onOpen(machineId, t.sessionId)}
              style={itemStyle(T, active?.sessionId === t.sessionId && active?.machineId === machineId)}
            >
              <span style={{ fontFamily: T.fontMono, fontSize: '0.72rem', opacity: 0.7 }}>{t.sessionId.slice(0, 7)}</span>
              {t.cwd && (
                <span style={{ color: T.textMuted, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {t.cwd.split('/').pop() || '/'}
                </span>
              )}
              {onStop && (
                <button
                  onClick={e => { e.stopPropagation(); onStop(machineId, t.sessionId); }}
                  title="停止此终端"
                  style={{
                    background: 'none', border: 'none', color: T.danger,
                    cursor: 'pointer', padding: '0 3px', fontSize: '0.7rem',
                    flexShrink: 0, transition: 'opacity 0.12s',
                  }}>■</button>
              )}
            </div>
          ))}
        </div>
      ))}
      {openTerminals.length === 0 && <EmptyState text="暂无已打开的终端" />}
    </div>
  );
}

// ── 运行中 Tab ────────────────────────────────────────────────
function RunningTab({ activeSessions, active, onOpen, onStop }) {
  const T = useTheme();
  const byMachine = activeSessions.reduce((acc, s) => {
    const mid = s.machineId || 'local';
    (acc[mid] = acc[mid] || []).push(s);
    return acc;
  }, {});

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
      <style>{`.sess-item:hover { background: ${T.bgHover} !important; color: ${T.textPrimary} !important; }`}</style>
      {Object.entries(byMachine).map(([machineId, sess]) => (
        <div key={machineId} style={{ marginBottom: '0.75rem' }}>
          <div style={machineBadge(T)}>
            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: T.success, display: 'inline-block' }} />
            {machineId}
          </div>
          {sess.map(s => (
            <div
              key={s.sessionId}
              className="sess-item"
              onClick={() => onOpen(machineId, s.sessionId, ['claude', '--resume', s.sessionId], s.cwd)}
              style={itemStyle(T, active?.sessionId === s.sessionId)}
            >
              <span style={{ fontFamily: T.fontMono, fontSize: '0.72rem', opacity: 0.7 }}>{s.sessionId.slice(0, 7)}</span>
              <span style={{ color: T.textMuted, fontSize: '0.72rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.cwd?.split('/').pop() || '/'}
              </span>
              {s._optimistic && (
                <span style={{ color: T.warning, fontSize: '0.62rem', animation: 'pulse 1.5s infinite', flexShrink: 0 }}>恢复中…</span>
              )}
              <span style={{ color: T.textMuted, fontSize: '0.65rem', flexShrink: 0 }}>{timeAgo(s.mtime)}</span>
              {onStop && (
                <button
                  onClick={e => { e.stopPropagation(); onStop(machineId, s.sessionId); }}
                  title="停止此 session"
                  style={{
                    background: 'none', border: 'none', color: T.danger,
                    cursor: 'pointer', padding: '0 3px', fontSize: '0.7rem',
                    flexShrink: 0, transition: 'opacity 0.12s',
                  }}>■</button>
              )}
            </div>
          ))}
        </div>
      ))}
      {activeSessions.length === 0 && <EmptyState text="无活跃 CC session" />}
    </div>
  );
}

// ── 历史 Tab ──────────────────────────────────────────────────
function HistoryTab({ historySessions, active, onOpen, onDelete }) {
  const T = useTheme();
  const [hovered, setHovered] = useState(null);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
      <style>{`
        .hist-item:hover { background: ${T.bgHover} !important; }
        .hist-actions { opacity: 0; transition: opacity 0.15s; }
        .hist-item:hover .hist-actions { opacity: 1 !important; }
        .hist-btn:hover { background: ${T.bgBase} !important; }
      `}</style>
      {historySessions.map(s => (
        <div
          key={s.sessionId}
          className="hist-item"
          onMouseEnter={() => setHovered(s.sessionId)}
          onMouseLeave={() => setHovered(null)}
          style={{
            ...itemStyle(T, active?.sessionId === s.sessionId),
            flexDirection: 'column', alignItems: 'stretch', gap: '2px',
            padding: '0.4rem 0.6rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ color: T.textPrimary, fontSize: '0.78rem', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.cwd?.split('/').pop() || '/'}
            </span>
            {s.gitBranch && (
              <span style={{
                background: T.accentDim, color: T.accent,
                borderRadius: T.radiusPill, padding: '1px 6px',
                fontSize: '0.62rem', fontWeight: 500, flexShrink: 0,
              }}>{s.gitBranch}</span>
            )}
            <span style={{ color: T.textMuted, fontSize: '0.62rem', flexShrink: 0 }}>
              {s.timestamp?.slice(0, 10)}
            </span>
          </div>
          {s.summary ? (
            <div style={{ color: T.textMuted, fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.summary}
            </div>
          ) : (
            <span style={{ background: T.bgHover, color: T.textMuted, borderRadius: T.radiusPill, padding: '1px 6px', fontSize: '0.6rem' }}>空会话</span>
          )}
          <div className="hist-actions" style={{ display: 'flex', gap: '4px', marginTop: '3px' }}>
            <button
              className="hist-btn"
              title="在此目录启动 claude"
              onClick={e => { e.stopPropagation(); onOpen(s.machineId || 'local', s.sessionId, ['claude'], s.cwd); }}
              style={{
                background: T.bgCard, border: `1px solid ${T.border}`,
                color: T.success, borderRadius: '4px',
                cursor: 'pointer', padding: '1px 7px', fontSize: '0.7rem',
                fontFamily: T.fontSans, transition: 'background 0.12s',
              }}>▶ 新建</button>
            <button
              className="hist-btn"
              title={`claude --resume ${s.sessionId}`}
              onClick={e => { e.stopPropagation(); onOpen(s.machineId || 'local', s.sessionId, ['claude', '--resume', s.sessionId], s.cwd); }}
              style={{
                background: T.bgCard, border: `1px solid ${T.border}`,
                color: T.accent, borderRadius: '4px',
                cursor: 'pointer', padding: '1px 7px', fontSize: '0.7rem',
                fontFamily: T.fontSans, transition: 'background 0.12s',
              }}>↩ 恢复</button>
            {onDelete && (
            <button
              className="hist-btn"
              title="删除此 session"
              onClick={e => { e.stopPropagation(); onDelete(s.machineId || 'local', s.sessionId); }}
              style={{
                background: T.bgCard, border: `1px solid ${T.border}`,
                color: T.danger, borderRadius: '4px',
                cursor: 'pointer', padding: '1px 7px', fontSize: '0.7rem',
                fontFamily: T.fontSans, transition: 'background 0.12s',
              }}>✕ 删除</button>
            )}
          </div>
        </div>
      ))}
      {historySessions.length === 0 && <EmptyState text="无历史 session" />}
    </div>
  );
}

function EmptyState({ text }) {
  const T = useTheme();
  return (
    <div style={{ textAlign: 'center', padding: '1.5rem 0.5rem', color: T.textMuted, fontSize: '0.75rem' }}>
      {text}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────
export default function SessionTabs({ sessions, activeSessions, historySessions, openTerminals, active, onOpen, onDelete, onStop, ws, machineId, onLaunch, onPreviewMd }) {
  const T = useTheme();
  const [tab, setTab] = useState('opened');

  const tabs = [
    { key: 'opened',  label: '已打开', count: openTerminals.length },
    { key: 'running', label: '运行中', count: activeSessions.length },
    { key: 'history', label: '历史',  count: historySessions.length },
    { key: 'files',   label: '目录' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <style>{`.tab-btn:hover { color: ${T.textPrimary} !important; }`}</style>
      <div style={{
        display: 'flex', gap: '2px',
        padding: '6px 8px',
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
      }}>
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            className="tab-btn"
            onClick={() => setTab(key)}
            style={{
              flex: 1, padding: '4px 0',
              background: tab === key ? T.bgHover : 'none',
              border: `1px solid ${tab === key ? T.border : 'transparent'}`,
              borderRadius: T.radiusSm,
              color: tab === key ? T.textPrimary : T.textMuted,
              cursor: 'pointer', fontSize: '0.72rem', fontWeight: tab === key ? 600 : 400,
              fontFamily: T.fontSans, transition: 'all 0.12s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
            }}
          >
            {label}
            {count > 0 && (
              <span style={{
                background: tab === key ? T.accentDim : 'rgba(128,128,128,0.12)',
                color: tab === key ? T.accent : T.textMuted,
                borderRadius: T.radiusPill,
                padding: '0 5px', fontSize: '0.62rem', fontWeight: 600,
              }}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'opened'  && <OpenedTab  openTerminals={openTerminals} active={active} onOpen={onOpen} onStop={onStop} />}
      {tab === 'running' && <RunningTab activeSessions={activeSessions} active={active} onOpen={onOpen} onStop={onStop} />}
      {tab === 'history' && <HistoryTab historySessions={historySessions} active={active} onOpen={onOpen} onDelete={onDelete} />}
      {tab === 'files'   && <FileBrowser ws={ws} machineId={machineId} historySessions={historySessions} onLaunch={onLaunch} onPreviewMd={onPreviewMd} />}
    </div>
  );
}
