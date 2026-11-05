// PM2 process for the DOS Radio API on borg.tools. Secrets: /home/vizi/apps/dosradio-api/.env (chmod 600).
module.exports = {
  apps: [{
    name: 'dosradio-api',
    cwd: '/home/vizi/apps/dosradio-api',
    script: './start.sh',
    interpreter: 'bash',
    max_memory_restart: '400M',
    autorestart: true,
  }],
};
