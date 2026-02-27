import { useState } from 'react';
import Login from './Login';
import Register from './Register';
import Dashboard from './Dashboard';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [page, setPage] = useState('login'); // 'login' | 'register'

  function handleLogin(t) {
    localStorage.setItem('token', t);
    setToken(t);
  }

  function handleLogout() {
    localStorage.removeItem('token');
    setToken(null);
    setPage('login');
  }

  if (token) return <Dashboard token={token} onLogout={handleLogout} />;
  if (page === 'register') return <Register onLogin={handleLogin} onBack={() => setPage('login')} />;
  return <Login onLogin={handleLogin} onRegister={() => setPage('register')} />;
}
