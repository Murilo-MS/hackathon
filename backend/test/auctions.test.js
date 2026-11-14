process.env.JWT_SECRET = 'segredo-de-teste';
const test = require('node:test');
const assert = require('node:assert');
const store = require('../src/auctions/store');

test('tabela de incremento do RF14 (por faixa de preço atual)', () => {
  assert.strictEqual(store.incrementoPara(0.01), 1);
  assert.strictEqual(store.incrementoPara(99.99), 1);
  assert.strictEqual(store.incrementoPara(100), 5);
  assert.strictEqual(store.incrementoPara(499.99), 5);
  assert.strictEqual(store.incrementoPara(500), 10);
  assert.strictEqual(store.incrementoPara(999.99), 10);
  assert.strictEqual(store.incrementoPara(1000), 50);
  assert.strictEqual(store.incrementoPara(4999.99), 50);
  assert.strictEqual(store.incrementoPara(5000), 100);
  assert.strictEqual(store.incrementoPara(24999.99), 100);
  assert.strictEqual(store.incrementoPara(25000), 500);
  assert.strictEqual(store.incrementoPara(1000000), 500);
});

test('primeiro lance pode igualar o preço inicial; depois soma o incremento', () => {
  assert.strictEqual(store.proximoMinimo({ precoInicial: 120, maiorLance: null }), 120);
  assert.strictEqual(store.proximoMinimo({ precoInicial: 120, maiorLance: { valor: 120 } }), 125);
  assert.strictEqual(store.proximoMinimo({ precoInicial: 1000, maiorLance: { valor: 1000 } }), 1050);
  assert.strictEqual(store.proximoMinimo({ precoInicial: 25000, maiorLance: { valor: 25000 } }), 25500);
});

test('criar exige agendamento válido e nasce agendado', () => {
  const dono = { id: 1, nome: 'Dono' };
  const agora = Date.now();
  const base = { titulo: 'Item de teste', descricao: '', precoInicial: 100, dono };
  const iso = (ms) => new Date(ms).toISOString();

  assert.throws(
    () => store.criar({ ...base, inicio: iso(agora - 600000), fim: iso(agora + 600000) }),
    /passado/
  );
  assert.throws(
    () => store.criar({ ...base, inicio: iso(agora), fim: iso(agora + 5000) }),
    /duração mínima/i
  );
  assert.throws(
    () => store.criar({ ...base, titulo: 'ab', inicio: iso(agora), fim: iso(agora + 600000) }),
    /título/i
  );

  const leilao = store.criar({ ...base, inicio: iso(agora), fim: iso(agora + 600000) });
  assert.strictEqual(leilao.status, 'SCHEDULED');

  const api = store.paraApi(leilao);
  assert.strictEqual(api.proximoMinimo, 100);
  assert.strictEqual(api.incrementoAtual, 5); // preço 100 cai na faixa 100..499,99
  assert.strictEqual(api.statusRotulo, 'agendado');
});
