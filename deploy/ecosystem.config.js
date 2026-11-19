// PM2 process definition for the Rooster Reminder backend.
// Secrets live in /opt/rooster/.env (created by setup.sh), loaded via --env-file.
module.exports = {
  apps: [
    {
      name: 'rooster-server',
      cwd: '/opt/rooster/server',
      script: 'src/index.js',
      node_args: '--env-file=/opt/rooster/.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      env: { TZ: 'Asia/Shanghai' },
      out_file: '/var/log/rooster/out.log',
      error_file: '/var/log/rooster/error.log',
      merge_logs: true,
      time: true
    }
  ]
};