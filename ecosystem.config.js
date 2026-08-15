module.exports = {
  apps: [{
    name: 'edicola-ecclesiastica',
    script: 'server.js',
    // Deploy standalone: repo clonato in /home/work/edicola-ecclesiastica
    cwd: '/home/work/edicola-ecclesiastica',
    env: {
      NODE_ENV: 'production',
      PORT: 3202,
      // Percorsi dei DB del progetto madre (per filtro giurisprudenza e schema notizie)
      ECCL_CASSAZIONE_SRC: '/home/work/edicola-giuridica/data/cassazione-corpus.db',
      ECCL_GIURIDICA_SRC: '/home/work/edicola-giuridica/data/giuridica.db'
    },
    max_memory_restart: '2G',
    min_uptime: 60000,
    restart_delay: 5000,
    max_restarts: 10,
    autorestart: true,
  }]
};
