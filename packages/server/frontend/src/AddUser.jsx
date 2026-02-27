import { useState } from 'react';

export default function AddUser({ token, onClose }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccess(`用户 "${data.username}" 创建成功`);
        setUsername(''); setPassword('');
      } else {
        setError(data.error || '创建失败');
      }
    } catch {
      setError('连接失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
      <div style={{ background:'#161b22', border:'1px solid #30363d', borderRadius:'8px', padding:'1.5rem', minWidth:'300px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem' }}>
          <span style={{ color:'#e6edf3', fontWeight:'bold' }}>添加用户</span>
          <span onClick={onClose} style={{ color:'#8b949e', cursor:'pointer', fontSize:'1.2rem', lineHeight:1 }}>×</span>
        </div>
        {error && <p style={{ color:'#f85149', fontSize:'0.85rem', margin:'0 0 0.75rem' }}>{error}</p>}
        {success && <p style={{ color:'#3fb950', fontSize:'0.85rem', margin:'0 0 0.75rem' }}>{success}</p>}
        <form onSubmit={handleSubmit}>
          <input
            placeholder="用户名"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="密码（至少6个字符）"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={inputStyle}
          />
          <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.25rem' }}>
            <button type="submit" disabled={loading} style={{ flex:1, padding:'0.4rem', background:'#238636', color:'#e6edf3', border:'1px solid #2ea043', borderRadius:'6px', cursor:'pointer', fontSize:'0.85rem' }}>
              {loading ? '创建中…' : '创建'}
            </button>
            <button type="button" onClick={onClose} style={{ flex:1, padding:'0.4rem', background:'none', color:'#8b949e', border:'1px solid #30363d', borderRadius:'6px', cursor:'pointer', fontSize:'0.85rem' }}>
              关闭
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle = {
  display:'block', width:'100%', marginBottom:'0.75rem', padding:'0.4rem 0.75rem',
  borderRadius:'6px', border:'1px solid #30363d', background:'#0d1117',
  color:'#e6edf3', boxSizing:'border-box', outline:'none', fontSize:'0.85rem'
};
