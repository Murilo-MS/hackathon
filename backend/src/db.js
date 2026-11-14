const { Pool } = require('pg');
const config = require('./config');

// Um pool de conexões compartilhado por todo o back-end
const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (erro) => {
  console.error('Erro inesperado no pool do PostgreSQL:', erro.message);
});

module.exports = pool;
