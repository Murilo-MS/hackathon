const usuarios = [];
let proximoId = 1;

async function criar({ nome, email, senhaHash }) {
  const emailNormalizado = email.trim().toLowerCase();
  if (usuarios.some((u) => u.email === emailNormalizado)) {
    const erro = new Error('E-mail já cadastrado');
    erro.codigo = 'EMAIL_EM_USO';
    throw erro;
  }
  const usuario = { id: proximoId++, nome: nome.trim(), email: emailNormalizado, senhaHash };
  usuarios.push(usuario);
  return usuario;
}

async function buscarPorEmail(email) {
  return usuarios.find((u) => u.email === email.trim().toLowerCase()) || null;
}

async function buscarPorId(id) {
  return usuarios.find((u) => String(u.id) === String(id)) || null;
}

module.exports = { criar, buscarPorEmail, buscarPorId };