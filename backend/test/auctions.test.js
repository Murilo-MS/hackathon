process.env.JWT_SECRET = 'segredo-de-teste';
const test = require('node:test');
const assert = require('node:assert');
const regras = require('../src/auctions/regras');

test('tabela de incremento do RF14 (por faixa de preço atual)', () => {
  assert.strictEqual(regras.incrementoPara(0.01), 1);
  assert.strictEqual(regras.incrementoPara(99.99), 1);
  assert.strictEqual(regras.incrementoPara(100), 5);
  assert.strictEqual(regras.incrementoPara(499.99), 5);
  assert.strictEqual(regras.incrementoPara(500), 10);
  assert.strictEqual(regras.incrementoPara(999.99), 10);
  assert.strictEqual(regras.incrementoPara(1000), 50);
  assert.strictEqual(regras.incrementoPara(4999.99), 50);
  assert.strictEqual(regras.incrementoPara(5000), 100);
  assert.strictEqual(regras.incrementoPara(24999.99), 100);
  assert.strictEqual(regras.incrementoPara(25000), 500);
  assert.strictEqual(regras.incrementoPara(1000000), 500);
});

test('primeiro lance iguala o preço inicial; depois soma o incremento', () => {
  assert.strictEqual(regras.proximoMinimo(120, null), 120);
  assert.strictEqual(regras.proximoMinimo(120, 120), 125);
  assert.strictEqual(regras.proximoMinimo(1000, 1000), 1050);
  assert.strictEqual(regras.proximoMinimo(25000, 25000), 25500);
});

test('validarCriacao normaliza e recusa agendamento inválido', () => {
  const agora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const base = { titulo: 'Item de teste', descricao: '', precoInicial: 100 };

  assert.throws(
    () => regras.validarCriacao({ ...base, inicio: iso(agora - 600000), fim: iso(agora + 600000), agora: new Date(agora) }),
    /passado/
  );
  assert.throws(
    () => regras.validarCriacao({ ...base, inicio: iso(agora), fim: iso(agora + 5000), agora: new Date(agora) }),
    /duração mínima/i
  );
  assert.throws(
    () => regras.validarCriacao({ ...base, titulo: 'ab', inicio: iso(agora), fim: iso(agora + 600000), agora: new Date(agora) }),
    /título/i
  );

  const ok = regras.validarCriacao({
    ...base,
    titulo: '  Bicicleta aro 29  ',
    categoria: '',
    inicio: iso(agora),
    fim: iso(agora + 600000),
    agora: new Date(agora),
  });
  assert.strictEqual(ok.titulo, 'Bicicleta aro 29'); // espaço removido
  assert.strictEqual(ok.categoria, 'Geral'); // categoria padrão
  assert.strictEqual(ok.preco, 100);
});

test('validarLance recusa lance de leilão agendado', () => {
  assert.throws(
    () =>
      regras.validarLance({
        leilao: { status: 'SCHEDULED', precoInicial: 100, lanceAtual: null, donoId: 'x', endsAt: new Date() },
        usuario: { id: 'y' },
        valor: 100,
      }),
    /não começou/
  );
});
