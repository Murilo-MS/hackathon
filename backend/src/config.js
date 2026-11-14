require('dotenv').config();

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return valor;
}

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: exigir('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
};
