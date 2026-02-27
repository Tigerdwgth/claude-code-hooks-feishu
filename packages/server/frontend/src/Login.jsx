import { useState } from 'react';
import { useTheme, makeInputBase } from './theme';

const GRID_BG = (isDark) => isDark
  ? `radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.18) 0%, transparent 70%),
     linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
     linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`
  : `radial-gradient(ellipse 80% 60% at 50% -10%, rgba(99,102,241,0.1) 0%, transparent 70%),
     linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
     linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)`;

export default function Login({ onLogin, onRegister, isDark, onToggleTheme }) {
  const T = useTheme();
  const inputBase = makeInputBase(T);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [focused, setFocused]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const { token } = await res.json();
        onLogin(token);
      } else {
        const { error: msg } = await res.json();
        setError(msg || '用户名或密码错误');
      }
    } catch {
      setError('连接服务器失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      height: '100vh', background: T.bgBase,
      backgroundImage: GRID_BG(isDark !== false),
      backgroundSize: '100% 100%, 32px 32px, 32px 32px',
      fontFamily: T.fontSans,
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
        .login-input:focus { border-color: ${T.borderAccent} !important; box-shadow: 0 0 0 3px ${T.accentDim}; }
        .login-btn:hover:not(:disabled) { background: ${T.accentHover} !important; transform: translateY(-1px); box-shadow: 0 4px 20px rgba(99,102,241,0.35); }
        .login-btn { transition: all 0.15s ease; }
        .login-card { animation: fadeUp 0.4s ease both; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      <div className="login-card" style={{
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg,
        padding: '2.25rem 2rem',
        width: '100%',
        maxWidth: '360px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
        position: 'relative',
      }}>
        {/* 主题切换 */}
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            title={isDark !== false ? '切换到日间模式' : '切换到夜间模式'}
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              background: 'none', border: `1px solid ${T.border}`,
              color: T.textMuted, borderRadius: T.radiusSm,
              cursor: 'pointer', padding: '3px 8px', fontSize: '0.85rem',
            }}
          >{isDark !== false ? '☀' : '🌙'}</button>
        )}
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '44px', height: '44px', borderRadius: '10px',
            background: `linear-gradient(135deg, ${T.accent}, #818cf8)`,
            marginBottom: '0.75rem',
            boxShadow: `0 8px 24px rgba(99,102,241,0.4)`,
          }}>
            <span style={{ fontSize: '1.25rem' }}>⌨</span>
          </div>
          <div style={{ color: T.textPrimary, fontWeight: 600, fontSize: '1.05rem', letterSpacing: '-0.01em' }}>
            Claude Code
          </div>
          <div style={{ color: T.textMuted, fontSize: '0.78rem', marginTop: '2px' }}>Dashboard</div>
        </div>

        {error && (
          <div style={{
            background: T.dangerDim, border: `1px solid rgba(239,68,68,0.25)`,
            borderRadius: T.radiusSm, padding: '0.5rem 0.75rem',
            color: '#fca5a5', fontSize: '0.82rem', marginBottom: '1rem',
          }}>{error}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', color: T.textSecondary, fontSize: '0.78rem', marginBottom: '0.35rem', fontWeight: 500 }}>用户名</label>
            <input
              className="login-input"
              placeholder="输入用户名"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              style={{ ...inputBase, border: `1px solid ${focused === 'u' ? T.borderAccent : T.border}` }}
              onFocus={() => setFocused('u')}
              onBlur={() => setFocused('')}
            />
          </div>
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', color: T.textSecondary, fontSize: '0.78rem', marginBottom: '0.35rem', fontWeight: 500 }}>密码</label>
            <input
              className="login-input"
              type="password"
              placeholder="输入密码"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ ...inputBase, border: `1px solid ${focused === 'p' ? T.borderAccent : T.border}` }}
              onFocus={() => setFocused('p')}
              onBlur={() => setFocused('')}
            />
          </div>
          <button
            className="login-btn"
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '0.6rem',
              background: loading ? T.bgHover : T.accent,
              color: '#fff', border: 'none',
              borderRadius: T.radiusSm, cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: 600, fontFamily: T.fontSans,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? '登录中…' : '登录'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.8rem', color: T.textMuted }}>
          没有账号？
          <span onClick={onRegister} style={{ color: T.accent, cursor: 'pointer', marginLeft: '4px', fontWeight: 500 }}>注册</span>
        </p>
      </div>
    </div>
  );
}
