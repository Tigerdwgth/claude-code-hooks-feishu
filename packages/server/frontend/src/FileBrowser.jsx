import { useState, useEffect } from 'react';

const BTN = {
  background: '#21262d', border: '1px solid #30363d', color: '#3fb950',
  borderRadius: '3px', cursor: 'pointer', padding: '1px 6px', fontSize: '0.75rem',
};

function DirTree({ ws, machineId, rootPath, onLaunch }) {
  const [entries, setEntries] = useState(null);
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

  if (!entries) return <div style={{ color: '#6e7681', fontSize: '0.72rem', padding: '0.25rem 0.75rem' }}>加载中…</div>;

  return (
    <div>
      {entries.map(entry => (
        <div key={entry.path}>
          <div style={{ display: 'flex', alignItems: 'center', padding: '0.2rem 0.5rem', gap: '4px' }}>
            <span onClick={() => setExpanded(p => ({ ...p, [entry.path]: !p[entry.path] }))}
              style={{ cursor: 'pointer', color: '#8b949e', fontSize: '0.75rem', userSelect: 'none', width: '12px' }}>
              {expanded[entry.path] ? '▼' : '▶'}
            </span>
            <span style={{ flex: 1, color: '#e6edf3', fontSize: '0.75rem', cursor: 'pointer' }}
              onClick={() => setExpanded(p => ({ ...p, [entry.path]: !p[entry.path] }))}>
              {entry.name}
            </span>
            <button style={BTN} title={`在 ${entry.path} 启动 claude`}
              onClick={() => onLaunch(entry.path)}>▶</button>
          </div>
          {expanded[entry.path] && (
            <div style={{ paddingLeft: '16px' }}>
              <DirTree ws={ws} machineId={machineId} rootPath={entry.path} onLaunch={onLaunch} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function FileBrowser({ ws, machineId, historySessions, onLaunch, onClose }) {
  const [manualPath, setManualPath] = useState('');

  // 最近目录：从历史 session 取前5个唯一 cwd
  const recentDirs = [...new Set((historySessions || []).map(s => s.cwd).filter(Boolean))].slice(0, 5);

  return (
    <div style={{
      background: '#161b22', border: '1px solid #30363d', borderRadius: '6px',
      margin: '0.5rem', padding: '0.5rem', fontSize: '0.78rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ color: '#8b949e', fontWeight: 'bold', fontSize: '0.72rem' }}>新建终端</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: '0.85rem' }}>✕</button>
      </div>

      {/* 最近目录 */}
      {recentDirs.length > 0 && (
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ color: '#6e7681', fontSize: '0.68rem', marginBottom: '0.25rem' }}>最近目录</div>
          {recentDirs.map(dir => (
            <div key={dir} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.15rem 0.25rem' }}>
              <span style={{ color: '#8b949e', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {dir}
              </span>
              <button style={BTN} onClick={() => onLaunch(dir)}>▶</button>
            </div>
          ))}
        </div>
      )}

      {/* 目录树 */}
      <div style={{ marginBottom: '0.5rem', borderTop: '1px solid #30363d', paddingTop: '0.5rem' }}>
        <div style={{ color: '#6e7681', fontSize: '0.68rem', marginBottom: '0.25rem' }}>目录树</div>
        <DirTree ws={ws} machineId={machineId} rootPath="/" onLaunch={onLaunch} />
      </div>

      {/* 手动输入 */}
      <div style={{ borderTop: '1px solid #30363d', paddingTop: '0.5rem', display: 'flex', gap: '4px' }}>
        <input
          value={manualPath}
          onChange={e => setManualPath(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && manualPath && onLaunch(manualPath)}
          placeholder="输入路径…"
          style={{
            flex: 1, background: '#0d1117', border: '1px solid #30363d', color: '#e6edf3',
            borderRadius: '3px', padding: '3px 6px', fontSize: '0.75rem', outline: 'none',
          }}
        />
        <button style={BTN} onClick={() => manualPath && onLaunch(manualPath)}>▶</button>
      </div>
    </div>
  );
}
