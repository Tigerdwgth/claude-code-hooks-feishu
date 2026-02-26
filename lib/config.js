const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const CONFIG_DIR_NAME = '.claude-hooks-feishu';

function getBaseDir() {
  return process.env.CLAUDE_HOOKS_FEISHU_HOME ||
    path.join(os.homedir(), CONFIG_DIR_NAME);
}

function getConfigPath() {
  return path.join(getBaseDir(), 'config.json');
}

function getHooksDir() {
  return path.join(getBaseDir(), 'hooks');
}

function defaultConfig() {
  return {
    webhook: {
      enabled: false,
      url: '',
      secret: ''
    },
    app: {
      enabled: false,
      appId: '',
      appSecret: '',
      receiverId: '',
      receiverType: 'open_id'
    },
    hooks: {
      notify: true,
      guard: true,
      interactive: true,
      formatPython: true,
      codeReview: true
    },
    pythonFormatter: 'black',
    dangerousPatterns: [
      'rm -r /', 'git push --force', 'git push -f',
      'git reset --hard', 'DROP TABLE', 'DROP DATABASE',
      'mkfs', 'dd if=', '> /dev/sda'
    ]
  };
}

function loadConfig() {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return { ...defaultConfig(), ...JSON.parse(raw) };
  }
  return defaultConfig();
}

function saveConfig(config) {
  const baseDir = getBaseDir();
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(
    getConfigPath(),
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}

module.exports = {
  loadConfig,
  saveConfig,
  getConfigPath,
  getHooksDir,
  getBaseDir,
  defaultConfig
};
