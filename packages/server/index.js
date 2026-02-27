// packages/server/index.js
const express = require('express');
const path = require('node:path');
const { createUser, verifyPassword, generateToken, authMiddleware } = require('./auth');

const app = express();
app.use(express.json());

// 静态前端（Task 5 填充）
app.use(express.static(path.join(__dirname, 'frontend/dist')));

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
