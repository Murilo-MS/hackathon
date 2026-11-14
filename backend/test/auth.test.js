process.env.JWT_SECRET = 'segredo-de-teste';
// config.js exige DATABASE_URL; nos testes de unidade o banco não é usado
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://teste:teste@127.0.0.1:5432/teste';
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { hashSenha, conferirSenha } = require('../src/auth/password');
const { gerarToken, verificarToken } = require('../src/auth/token');

test('a senha nunca é guardada em texto puro', async () => {
  const hash = await hashSenha('minhaSenha123');
  assert.notStrictEqual(hash, 'minhaSenha123');
  assert.ok(await conferirSenha('minhaSenha123', hash));
  assert.ok(!(await conferirSenha('outraSenha', hash)));
});

test('token válido devolve o id do usuário', () => {
  const token = gerarToken({ id: 42 });
  assert.deepStrictEqual(verificarToken(token), { valido: true, usuarioId: '42' });
});

test('token expirado é recusado', () => {
  const expirado = jwt.sign(
    { sub: '42', exp: Math.floor(Date.now() / 1000) - 10 },
    'segredo-de-teste'
  );
  assert.deepStrictEqual(verificarToken(expirado), { valido: false, motivo: 'expirado' });
});

test('token assinado com outro segredo é recusado', () => {
  const falso = jwt.sign({ sub: '42' }, 'outro-segredo');
  assert.strictEqual(verificarToken(falso).valido, false);
});