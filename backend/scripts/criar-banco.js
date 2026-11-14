// Prepara o banco: aplica o schema e, opcionalmente, os dados de demonstração.
//
//   node scripts/criar-banco.js          -> cria o schema se ainda não existir
//   node scripts/criar-banco.js --dados  -> cria o schema e carrega dados/seed.sql
//
// É idempotente: rodar duas vezes não quebra nada.

require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db');

const RAIZ = path.join(__dirname, '..', '..');
const SCHEMA = path.join(RAIZ, 'dados', 'leilao_db.sql');
const DADOS = path.join(RAIZ, 'dados', 'seed.sql');

async function schemaExiste() {
  const { rows } = await db.consultar(`SELECT to_regclass('public.users') AS tabela`);
  return rows[0]?.tabela != null;
}

async function aplicar(arquivo, rotulo) {
  const sql = fs.readFileSync(arquivo, 'utf8');
  console.log(`Aplicando ${rotulo} (${(sql.length / 1024).toFixed(1)} KB)...`);
  // Sem parâmetros, o driver envia o arquivo inteiro num único comando (protocolo simples)
  await db.consultar(sql);
  console.log(`${rotulo} aplicado.`);
}

async function contagem(comDados) {
  const tabelas = comDados
    ? ['users', 'items', 'auctions', 'bids']
    : ['users', 'auctions'];
  for (const tabela of tabelas) {
    const { rows } = await db.consultar(`SELECT count(*)::int AS total FROM ${tabela}`);
    console.log(`  ${tabela}: ${rows[0].total} registro(s)`);
  }
}

(async () => {
  const comDados = process.argv.includes('--dados');

  try {
    await db.verificarConexao();
    console.log('Conectado ao PostgreSQL.');

    if (await schemaExiste()) {
      console.log('Schema já existe (tabela users encontrada), pulando criação.');
    } else {
      await aplicar(SCHEMA, 'schema');
    }

    if (comDados) {
      const { rows } = await db.consultar('SELECT count(*)::int AS total FROM users');
      if (rows[0].total > 0) {
        console.log('Já existem usuários, então não recarrego os dados de demonstração.');
      } else {
        await aplicar(DADOS, 'dados de demonstração');
        console.log('Contas de demonstração: carlos@demo.com, ana@demo.com, bruno@demo.com, carla@demo.com (senha: senha123)');
      }
    }

    console.log('Estado do banco:');
    await contagem(comDados);
  } catch (erro) {
    console.error('Falhou:', erro.message);
    if (erro.code === '42501') {
      console.error('Dica: o usuário do banco precisa ser dono do schema ou superusuário para criar a extensão citext.');
    }
    process.exitCode = 1;
  } finally {
    await db.fecharPool().catch(() => {});
  }
})();
