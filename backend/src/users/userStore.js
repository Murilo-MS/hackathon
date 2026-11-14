const db = require('../db');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Converte a linha do banco (colunas em inglês) para o formato que o resto do back-end já usa
const paraUsuario = (r) =>
  r ? { id: r.id, nome: r.display_name, email: r.email, senhaHash: r.password_hash } : null;

async function criar({ nome, email, senhaHash }) {
  try {
    const { rows } = await db.query(
      `INSERT INTO users (display_name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, display_name, email, password_hash`,
      [nome.trim(), email.trim().toLowerCase(), senhaHash]
    );
    return paraUsuario(rows[0]);
  } catch (e) {
    // 23505 = violação de UNIQUE: o e-mail já existe
    if (e.code === '23505') {
      const erro = new Error('E-mail já cadastrado');
      erro.codigo = 'EMAIL_EM_USO';
      throw erro;
    }
    throw e;
  }
}

async function buscarPorEmail(email) {
  const { rows } = await db.query(
    'SELECT id, display_name, email, password_hash FROM users WHERE email = $1',
    [email.trim()]
  );
  return paraUsuario(rows[0]);
}

async function buscarPorId(id) {
  if (!UUID.test(String(id))) return null; // id que não é UUID nunca existe
  const { rows } = await db.query(
    'SELECT id, display_name, email, password_hash FROM users WHERE id = $1',
    [id]
  );
  return paraUsuario(rows[0]);
}

module.exports = { criar, buscarPorEmail, buscarPorId };
