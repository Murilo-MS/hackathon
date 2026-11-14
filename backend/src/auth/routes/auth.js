const express = require('express');
const { hashSenha, conferirSenha } = require('../auth/password');
const { gerarToken } = require('../auth/token');
const { exigirLogin } = require('../auth/middleware');
const usuarios = require('../users/userStore');

const router = express.Router();
const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Nunca devolver o hash da senha
const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email });

router.post('/register', async (req, res) => {
  const { nome, email, senha } = req.body || {};
  if (typeof nome !== 'string' || !nome.trim()) {
    return res.status(400).json({ erro: 'Nome de exibição obrigatório' });
  }
  if (typeof email !== 'string' || !EMAIL_VALIDO.test(email)) {
    return res.status(400).json({ erro: 'E-mail inválido' });
  }
  if (typeof senha !== 'string' || senha.length < 8) {
    return res.status(400).json({ erro: 'A senha precisa ter ao menos 8 caracteres' });
  }
  try {
    const usuario = await usuarios.criar({ nome, email, senhaHash: await hashSenha(senha) });
    res.status(201).json({ usuario: publico(usuario), token: gerarToken(usuario) });
  } catch (erro) {
    if (erro.codigo === 'EMAIL_EM_USO') {
      return res.status(409).json({ erro: 'E-mail já cadastrado' });
    }
    throw erro;
  }
});

router.post('/login', async (req, res) => {
  const { email, senha } = req.body || {};
  const usuario = typeof email === 'string' ? await usuarios.buscarPorEmail(email) : null;
  const ok = usuario && typeof senha === 'string' && (await conferirSenha(senha, usuario.senhaHash));
  if (!ok) {
    // Mesma mensagem para e-mail inexistente e senha errada
    return res.status(401).json({ erro: 'E-mail ou senha inválidos' });
  }
  res.json({ usuario: publico(usuario), token: gerarToken(usuario) });
});

router.get('/me', exigirLogin, (req, res) => {
  res.json({ usuario: publico(req.usuario) });
});

module.exports = router;