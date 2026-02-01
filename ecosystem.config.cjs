module.exports = {
  apps: [{
    name: 'claude-terminal',
    script: 'bun',
    args: 'run src/index.ts',
    cwd: '/Users/lucas/Desktop/claude-terminal',

    // Restart on crash
    autorestart: true,
    max_restarts: 10,
    restart_delay: 1000,

    // Watch for changes (optional, disable in production)
    watch: false,

    // Logging
    error_file: '/Users/lucas/Desktop/claude-terminal/logs/error.log',
    out_file: '/Users/lucas/Desktop/claude-terminal/logs/out.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',

    // Environment
    env: {
      NODE_ENV: 'production'
    }
  }]
};
