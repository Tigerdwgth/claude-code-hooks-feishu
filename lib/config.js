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
    ipcDir: '',
    machineId: '',
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
      codeReview: true,
      fixWritePath: true
    },
    centralServer: {
      enabled: false,
      url: '',          // e.g. "ws://your-server:3000/ws"
      machineToken: '', // UUID，在中央服务器配置的 MACHINE_TOKENS 里
      machineId: ''     // 留空则用 getMachineId()
    },
    fileAccess: {
      blockedDirs: ['.ssh', '.gnupg', '.aws', '.config/gcloud', '.env'],
      blockedSystemPaths: ['/etc/shadow', '/etc/passwd', '/proc', '/sys'],
      maxFileSizeKB: 100
    },
    pythonFormatter: 'black',
    dangerousPatterns: [
      'rm -r /', 'git push --force', 'git push -f',
      'git reset --hard', 'DROP TABLE', 'DROP DATABASE',
      'mkfs', 'dd if=', '> /dev/sda'
    ]
  };
}

function getMachineId() {
  if (process.env.CLAUDE_HOOKS_MACHINE_ID) {
    return process.env.CLAUDE_HOOKS_MACHINE_ID;
  }
  const cfg = loadConfig();
  if (cfg.machineId) {
    return cfg.machineId;
  }
  return os.hostname();
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
  defaultConfig,
  getMachineId
};
