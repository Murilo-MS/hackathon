const bcrypt = require('bcryptjs');

const RODADAS = 10; 

async function hashSenha(senha) {
  return bcrypt.hash(senha, RODADAS);
}

async function conferirSenha(senha, hash) {
  return bcrypt.compare(senha, hash);
}

module.exports = { hashSenha, conferirSenha };