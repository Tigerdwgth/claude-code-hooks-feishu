import { useState } from 'react';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (res.ok) {
        const { token } = await res.json();
        onLogin(token);
      } else {
        setError('用户名或密码错误');
      }
    } catch {
      setError('连接服务器失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background:'#0d1117' }}>
      <form onSubmit={handleSubmit} style={{ background:'#161b22', padding:'2rem', borderRadius:'8px', minWidth:'320px', border:'1px solid #30363d' }}>
        <h2 style={{ color:'#e6edf3', marginBottom:'1.5rem', textAlign:'center', fontSize:'1.2rem' }}>Claude Code Dashboard</h2>
        {error && <p style={{ color:'#f85149', marginBottom:'1rem', fontSize:'0.85rem' }}>{error}</p>}
        <input
          placeholder="用户名"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoFocus
          style={{ display:'block', width:'100%', marginBottom:'0.75rem', padding:'0.5rem 0.75rem', borderRadius:'6px', border:'1px solid #30363d', background:'#0d1117', color:'#e6edf3', boxSizing:'border-box' }}
        />
        <input
          type="password"
          placeholder="密码"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ display:'block', width:'100%', marginBottom:'1rem', padding:'0.5rem 0.75rem', borderRadius:'6px', border:'1px solid #30363d', background:'#0d1117', color:'#e6edf3', boxSizing:'border-box' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ width:'100%', padding:'0.5rem', background: loading ? '#21262d' : '#238636', color:'#e6edf3', border:'1px solid #2ea043', borderRadius:'6px', cursor: loading ? 'not-allowed' : 'pointer', fontSize:'0.9rem' }}
        >
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
