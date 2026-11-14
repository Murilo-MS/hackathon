const jwt = require('jsonwebtoken');
const config = require('../config');

function gerarToken(usuario) {
  return jwt.sign({ sub: String(usuario.id) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function verificarToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return { valido: true, usuarioId: payload.sub };
  } catch (erro) {
    const motivo = erro.name === 'TokenExpiredError' ? 'expirado' : 'invalido';
    return { valido: false, motivo };
  }
}

module.exports = { gerarToken, verificarToken };