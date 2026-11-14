// Usuários no PostgreSQL (tabela users de dados/leilao_db.sql).
// A senha nunca é guardada: chega aqui o hash do bcrypt.

const { consultar } = require('../db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const paraApi = (linha) => ({ id: linha.id, nome: linha.display_name, email: linha.email });

async function criar({ nome, email, senhaHash }) {
  try {
    const { rows } = await consultar(
      `INSERT INTO users (display_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, display_name, email`,
      [nome.trim(), email.trim(), senhaHash]
    );
    return paraApi(rows[0]);
  } catch (erro) {
    // 23505 = unique_violation. O e-mail é CITEXT, então a unicidade já ignora
    // maiúsculas/minúsculas no próprio banco.
    if (erro.code === '23505') {
      const e = new Error('E-mail já cadastrado');
      e.codigo = 'EMAIL_EM_USO';
      throw e;
    }
    throw erro;
  }
}

async function buscarPorEmail(email) {
  if (typeof email !== 'string') return null;
  const { rows } = await consultar(
    `SELECT id, display_name, email, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [email.trim()]
  );
  if (!rows[0]) return null;
  return {
    id: rows[0].id,
    nome: rows[0].display_name,
    email: rows[0].email,
    senhaHash: rows[0].password_hash,
  };
}

async function buscarPorId(id) {
  // Um token forjado com "sub" que não é UUID faria o Postgres responder erro
  // 22P02 e viraria 500. Aqui vira "sessão inválida", que é o correto.
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const { rows } = await consultar(`SELECT id, display_name, email FROM users WHERE id = $1`, [id]);
  return rows[0] ? paraApi(rows[0]) : null;
}

module.exports = { criar, buscarPorEmail, buscarPorId };
