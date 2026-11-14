// Conexão com o PostgreSQL.
// Um único pool para o processo inteiro: abrir conexão por requisição esgota o
// servidor rápido e é a causa clássica de "too many clients already".

const { Pool } = require('pg');

let pool = null;

function obterPool() {
  if (pool) return pool;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL ausente. Configure no .env, por exemplo:\n' +
        'DATABASE_URL=postgresql://hackathon_user:hackathon_password@127.0.0.1:5432/leilao_db'
    );
  }

  pool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30000 });
  // Um erro no pool não pode derrubar o processo sem log
  pool.on('error', (erro) => console.error('Erro no pool do PostgreSQL:', erro.message));
  return pool;
}

// Usado nos testes (pg-mem) e em scripts que precisam trocar a conexão
function definirPool(novoPool) {
  pool = novoPool;
}

async function consultar(texto, parametros = []) {
  return obterPool().query(texto, parametros);
}

// Executa fn dentro de BEGIN ... COMMIT, com ROLLBACK em qualquer erro.
// É aqui que o lance garante a regra RF11: validação e gravação na mesma transação.
async function transacao(fn) {
  const cliente = await obterPool().connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (erro) {
    try {
      await cliente.query('ROLLBACK');
    } catch (erroRollback) {
      console.error('Falha no ROLLBACK:', erroRollback.message);
    }
    throw erro;
  } finally {
    cliente.release();
  }
}

async function verificarConexao() {
  const { rows } = await consultar('SELECT 1 AS ok');
  return rows[0]?.ok === 1;
}

async function fecharPool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { obterPool, definirPool, consultar, transacao, verificarConexao, fecharPool };
