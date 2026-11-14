const { verificarToken } = require('./token');
const usuarios = require('../users/userStore');

async function exigirLogin(req, res, next) {
  const [tipo, token] = (req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    return res.status(401).json({ erro: 'Sessão ausente', codigo: 'SEM_SESSAO' });
  }
  const resultado = verificarToken(token);
  if (!resultado.valido) {
    const expirada = resultado.motivo === 'expirado';
    return res.status(401).json({
      erro: expirada ? 'Sessão expirada' : 'Sessão inválida',
      codigo: expirada ? 'SESSAO_EXPIRADA' : 'SESSAO_INVALIDA',
    });
  }
  const usuario = await usuarios.buscarPorId(resultado.usuarioId);
  if (!usuario) {
    return res.status(401).json({ erro: 'Sessão inválida', codigo: 'SESSAO_INVALIDA' });
  }
  req.usuario = usuario;
  next();
}

module.exports = { exigirLogin };