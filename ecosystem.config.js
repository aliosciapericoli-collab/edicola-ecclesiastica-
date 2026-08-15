module.exports = {
  apps: [{
    name: 'edicola-ecclesiastica',
    script: 'server.js',
    cwd: '/home/work/edicola-giuridica/ecclesiastica',
    env: {
      NODE_ENV: 'production',
      PORT: 3202
    },
    max_memory_restart: '2G',
    min_uptime: 60000,
    restart_delay: 5000,
    max_restarts: 10,
    autorestart: true,
  }]
};
