// packages/server/index.js
const express = require('express');
const path = require('node:path');
const { createUser, verifyPassword, generateToken, authMiddleware, listUsers } = require('./auth');

const app = express();
app.use(express.json());

// 静态前端（Task 5 填充）
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// 注册（仅当无用户时开放，或管理员已登录时可创建新用户）
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 2) return res.status(400).json({ error: '用户名至少2个字符' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6个字符' });
  // 仅当系统无用户时允许开放注册（首次初始化）
  const users = await listUsers();
  if (users.length > 0) return res.status(403).json({ error: '注册已关闭，请联系管理员' });
  try {
    const user = await createUser(username, password);
    const token = generateToken(user);
    res.json({ token, username: user.username });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' });
    res.status(500).json({ error: '注册失败' });
  }
});

// 管理员创建用户
app.post('/api/admin/users', authMiddleware, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少6个字符' });
  try {
    const user = await createUser(username, password);
    res.json({ id: user.id, username: user.username });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: '用户名已存在' });
    res.status(500).json({ error: '创建失败' });
  }
});

// 登录
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const user = await verifyPassword(username, password);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const token = generateToken(user);
  res.json({ token, username: user.username });
});

// 当前用户信息
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ username: req.user.username });
});

// SPA fallback
app.get('*', (req, res) => {
  const dist = path.join(__dirname, 'frontend/dist/index.html');
  const fs = require('node:fs');
  if (fs.existsSync(dist)) res.sendFile(dist);
  else res.send('<h1>Frontend not built yet. Run: cd frontend && npm run build</h1>');
});

const PORT = process.env.PORT || 3000;

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--create-user') {
    const username = args[1];
    if (!username) {
      console.error('Usage: node index.js --create-user <username>');
      process.exit(1);
    }
    const readline = require('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Password for ${username}: `, async (password) => {
      rl.close();
      await createUser(username, password);
      console.log(`User "${username}" created.`);
      process.exit(0);
    });
    return;
  }

  const http = require('node:http');
  const { RelayServer } = require('./relay');
  const relay = new RelayServer();
  const server = http.createServer(app);
  relay.attachToHttpServer(server);
  server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}

main().catch(console.error);
module.exports = { app };
