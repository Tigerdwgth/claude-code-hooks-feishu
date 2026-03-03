import { useState, useEffect, useRef } from 'react';
import { useTheme } from './theme';

const CLI_CMDS = [
  { label: 'claude', cmd: ['claude'] },
  { label: 'codex',  cmd: ['codex'] },
  { label: 'gemini', cmd: ['gemini'] },
];

function LaunchMenu({ path, onLaunch, T }) {
  const [hovered, setHovered] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  function handleMouseEnter() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: r.top + r.height / 2, left: r.right + 4 });
    }
    setHovered(true);
  }

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={btnRef}
        className="dir-launch"
        title={`在 ${path} 启动`}
        onClick={() => onLaunch(path, ['claude'])}
        style={{
          background: 'none', border: `1px solid ${T.border}`,
          color: T.textMuted, borderRadius: '4px',
          cursor: 'pointer', padding: '1px 5px', fontSize: '0.65rem',
          flexShrink: 0, transition: 'all 0.12s',
        }}
      >▶</button>
      {hovered && (
        <div style={{
          position: 'fixed',
          top: menuPos.top,
          left: menuPos.left,
          transform: 'translateY(-50%)',
          display: 'flex', gap: '3px', zIndex: 9999,
        }}>
          {CLI_CMDS.map(({ label, cmd }) => (
            <button
              key={label}
              onMouseDown={e => { e.preventDefault(); onLaunch(path, cmd); }}
              style={{
                background: T.bgCard, border: `1px solid ${T.borderAccent}`,
                color: T.accent, borderRadius: '4px',
                cursor: 'pointer', padding: '1px 6px', fontSize: '0.65rem',
                fontFamily: 'monospace', whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function DirTree({ ws, machineId, rootPath, onLaunch, onPreviewMd }) {
  const T = useTheme();
  const [entries, setEntries]   = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (!ws || !machineId) return;
    const handler = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'dir_entries' && msg.path === rootPath) {
          setEntries(msg.entries || []);
        }
      } catch {}
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ type: 'list_dir', machineId, path: rootPath }));
    return () => ws.removeEventListener('message', handler);
  }, [ws, machineId, rootPath]);

  if (!entries) return (
    <div style={{ color: T.textMuted, fontSize: '0.72rem', padding: '0.25rem 0.75rem' }}>加载中…</div>
  );

  const isMd = (name) => name.endsWith('.md') || name.endsWith('.markdown');

  return (
    <div>
      <style>{`.dir-row:hover { background: ${T.bgHover} !important; } .dir-launch:hover { background: ${T.accentDim} !important; color: ${T.accent} !important; }`}</style>
      {entries.map(entry => (
        <div key={entry.path}>
          <div
            className="dir-row"
            style={{
              display: 'flex', alignItems: 'center', padding: '0.2rem 0.4rem',
              gap: '4px', borderRadius: T.radiusSm, cursor: 'pointer',
              transition: 'background 0.1s',
            }}
          >
            {entry.type === 'dir' ? (
              <>
                <span
                  onClick={() => setExpanded(p => ({ ...p, [entry.path]: !p[entry.path] }))}
                  style={{ color: T.textMuted, fontSize: '0.6rem', width: '10px', userSelect: 'none', flexShrink: 0 }}
                >
                  {expanded[entry.path] ? '▼' : '▶'}
                </span>
                <span style={{ fontSize: '0.72rem' }}>📁</span>
                <span
                  style={{ flex: 1, color: T.textSecondary, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => setExpanded(p => ({ ...p, [entry.path]: !p[entry.path] }))}
                >
                  {entry.name}
                </span>
                <LaunchMenu path={entry.path} onLaunch={onLaunch} T={T} />
              </>
            ) : (
              <>
                <span style={{ width: '10px', flexShrink: 0 }} />
                <span style={{ fontSize: '0.72rem' }}>{isMd(entry.name) ? '📄' : '📃'}</span>
                <span
                  style={{
                    flex: 1, fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: isMd(entry.name) ? T.accent : T.textMuted,
                    cursor: isMd(entry.name) ? 'pointer' : 'default',
                  }}
                  onClick={() => isMd(entry.name) && onPreviewMd?.(entry.path)}
                >
                  {entry.name}
                </span>
              </>
            )}
          </div>
          {entry.type === 'dir' && expanded[entry.path] && (
            <div style={{ paddingLeft: '14px' }}>
              <DirTree ws={ws} machineId={machineId} rootPath={entry.path} onLaunch={onLaunch} onPreviewMd={onPreviewMd} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function FileBrowser({ ws, machineId, historySessions, onLaunch, onPreviewMd }) {
  const T = useTheme();
  const [manualPath, setManualPath] = useState('');

  const recentDirs = [...new Set((historySessions || []).map(s => s.cwd).filter(Boolean))].slice(0, 5);

  return (
    <div style={{
      flex: 1, overflowY: 'auto',
      padding: '0.5rem',
      fontSize: '0.78rem',
    }}>
      <style>{`.recent-tag:hover { background: ${T.accentDim} !important; border-color: ${T.borderAccent} !important; color: ${T.accent} !important; } .path-input:focus { border-color: ${T.borderAccent} !important; box-shadow: 0 0 0 2px ${T.accentDim}; }`}</style>

      {/* 最近目录 — 标签云 */}
      {recentDirs.length > 0 && (
        <div style={{ marginBottom: '0.6rem' }}>
          <div style={{ color: T.textMuted, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>最近</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {recentDirs.map(dir => (
              <button
                key={dir}
                className="recent-tag"
                onClick={() => onLaunch(dir)}
                title={dir}
                style={{
                  background: T.bgHover, border: `1px solid ${T.border}`,
                  color: T.textSecondary, borderRadius: T.radiusPill,
                  cursor: 'pointer', padding: '2px 8px', fontSize: '0.68rem',
                  fontFamily: T.fontSans, transition: 'all 0.12s',
                  maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {dir.split('/').pop() || dir}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 目录树 */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: '0.5rem', marginBottom: '0.5rem' }}>
        <div style={{ color: T.textMuted, fontSize: '0.65rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>目录树</div>
        <DirTree ws={ws} machineId={machineId} rootPath="/" onLaunch={onLaunch} onPreviewMd={onPreviewMd} />
      </div>

      {/* 手动输入 */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: '0.5rem', display: 'flex', gap: '4px', alignItems: 'center' }}>
        <input
          className="path-input"
          value={manualPath}
          onChange={e => setManualPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && manualPath && onLaunch(manualPath, ['claude'])}
          placeholder="输入路径…"
          style={{
            flex: 1, background: T.bgInput, border: `1px solid ${T.border}`,
            color: T.textPrimary, borderRadius: T.radiusSm,
            padding: '4px 8px', fontSize: '0.75rem', outline: 'none',
            fontFamily: T.fontMono, transition: 'border-color 0.15s',
          }}
        />
        <LaunchMenu
          path={manualPath}
          onLaunch={(path, cmd) => path && onLaunch(path, cmd)}
          T={T}
        />
      </div>
    </div>
  );
}
