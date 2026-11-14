// Integração com banco, usando pg-mem: um PostgreSQL em memória, em JavaScript,
// só para os testes. Não substitui o Postgres real, mas executa o SQL de verdade
// (INSERT ... RETURNING, transação, FOR UPDATE, UPDATE com CASE) e pega erro de
// coluna, de tipo e de ordem de operações.
//
// O schema usado aqui espelha dados/leilao_db.sql, sem as partes que o pg-mem
// não implementa (CITEXT, ENUM, trigger). A compatibilidade das colunas é
// conferida no último teste, lendo o arquivo real.

process.env.JWT_SECRET = 'segredo-de-teste';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { newDb, DataType } = require('pg-mem');
const db = require('../src/db');
const userStore = require('../src/users/userStore');
const store = require('../src/auctions/store');

const DDL = `
  CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(320) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    declared_income NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES users(id),
    name VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(id),
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    starting_price NUMERIC(12,2) NOT NULL,
    current_price NUMERIC(12,2) NOT NULL,
    min_next_bid NUMERIC(12,2) NOT NULL,
    leader_id UUID REFERENCES users(id),
    winner_id UUID REFERENCES users(id),
    bid_count INTEGER NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ NOT NULL,
    original_ends_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL REFERENCES auctions(id),
    bidder_id UUID NOT NULL REFERENCES users(id),
    amount NUMERIC(12,2) NOT NULL,
    idempotency_key UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (bidder_id, idempotency_key),
    UNIQUE (auction_id, amount)
  );
`;

function prepararBanco() {
  const mem = newDb();
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    impure: true,
    implementation: () => crypto.randomUUID(),
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  db.definirPool(new pg.Pool());
}

const iso = (ms) => new Date(ms).toISOString();

test('usuários: cadastro, busca por e-mail e e-mail duplicado', async () => {
  prepararBanco();

  const dona = await userStore.criar({ nome: 'Dona', email: 'dona@exemplo.com', senhaHash: 'hash' });
  assert.match(dona.id, /^[0-9a-f-]{36}$/i);
  assert.strictEqual(dona.nome, 'Dona');

  const achada = await userStore.buscarPorEmail('dona@exemplo.com');
  assert.strictEqual(achada.nome, 'Dona');
  assert.strictEqual(achada.senhaHash, 'hash');

  await assert.rejects(
    () => userStore.criar({ nome: 'Outra', email: 'dona@exemplo.com', senhaHash: 'hash2' }),
    /já cadastrado/
  );

  // id inválido não deve estourar erro de sintaxe do Postgres
  assert.strictEqual(await userStore.buscarPorId('nao-e-uuid'), null);
});

test('fluxo do leilão: agenda, abre, recebe lance, fecha vendido', async () => {
  prepararBanco();

  const dona = await userStore.criar({ nome: 'Dona', email: 'dona@exemplo.com', senhaHash: 'h' });
  const ana = await userStore.criar({ nome: 'Ana', email: 'ana@exemplo.com', senhaHash: 'h' });

  const agora = Date.now();
  const leilao = await store.criar({
    titulo: 'Bicicleta aro 29',
    descricao: 'Usada, revisada',
    categoria: 'Esportes',
    precoInicial: 100,
    inicio: iso(agora),
    fim: iso(agora + 60000),
    dono: dona,
  });

  assert.strictEqual(leilao.status, 'SCHEDULED');
  assert.strictEqual(leilao.categoria, 'Esportes');
  assert.strictEqual(leilao.proximoMinimo, 100);
  assert.strictEqual(leilao.incrementoAtual, 5);

  await assert.rejects(
    () => store.darLance({ leilaoId: leilao.id, usuario: ana, valor: 100 }),
    /não começou/
  );

  const { abertos } = await store.atualizarEstados();
  assert.ok(abertos.includes(leilao.id), 'o leilão deveria ter sido aberto');

  const lance = await store.darLance({ leilaoId: leilao.id, usuario: ana, valor: 100 });
  assert.strictEqual(lance.lance.valor, 100);
  assert.strictEqual(lance.leilao.lanceAtual, 100);
  assert.strictEqual(lance.leilao.proximoMinimo, 105);
  assert.strictEqual(lance.leilao.maiorLance.usuarioNome, 'Ana');

  await assert.rejects(
    () => store.darLance({ leilaoId: leilao.id, usuario: dona, valor: 105 }),
    /próprio leilão/
  );
  await assert.rejects(
    () => store.darLance({ leilaoId: leilao.id, usuario: ana, valor: 105 }),
    /maior lance/
  );

  const historico = await store.historico(leilao.id);
  assert.strictEqual(historico.length, 1);
  assert.strictEqual(historico[0].valor, 100);

  const lista = await store.listar();
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].titulo, 'Bicicleta aro 29');

  // força o término e deixa o relógio fechar
  await db.consultar('UPDATE auctions SET ends_at = $1 WHERE id = $2', [
    new Date(Date.now() - 1000),
    leilao.id,
  ]);

  const { encerrados } = await store.atualizarEstados();
  assert.strictEqual(encerrados.find((e) => e.id === leilao.id)?.status, 'SOLD');

  const vendido = await store.buscar(leilao.id);
  assert.strictEqual(vendido.status, 'SOLD');
  assert.strictEqual(vendido.vencedor.usuarioNome, 'Ana');
  assert.strictEqual(vendido.vencedor.valor, 100);
  assert.ok(vendido.encerradoEm);

  await assert.rejects(
    () => store.darLance({ leilaoId: leilao.id, usuario: ana, valor: 200 }),
    /encerrado/
  );
});

test('leilão sem lance termina como ENDED_NO_BIDS', async () => {
  prepararBanco();
  const dona = await userStore.criar({ nome: 'Dona', email: 'd@exemplo.com', senhaHash: 'h' });

  const agora = Date.now();
  const leilao = await store.criar({
    titulo: 'Item sem lance',
    descricao: '',
    precoInicial: 50,
    inicio: iso(agora),
    fim: iso(agora + 30000),
    dono: dona,
  });

  await store.atualizarEstados(); // abre
  await db.consultar('UPDATE auctions SET ends_at = $1 WHERE id = $2', [
    new Date(Date.now() - 1000),
    leilao.id,
  ]);
  await store.atualizarEstados(); // fecha

  const final = await store.buscar(leilao.id);
  assert.strictEqual(final.status, 'ENDED_NO_BIDS');
  assert.strictEqual(final.vencedor, null);
});

test('o SQL usa colunas que existem no schema real do projeto', () => {
  const arquivo = path.join(__dirname, '..', '..', 'dados', 'leilao_db.sql');
  const schema = fs.readFileSync(arquivo, 'utf8');
  const colunas = [
    'display_name',
    'password_hash',
    'declared_income',
    'seller_id',
    'starting_price',
    'current_price',
    'min_next_bid',
    'leader_id',
    'winner_id',
    'bid_count',
    'starts_at',
    'original_ends_at',
    'ends_at',
    'idempotency_key',
  ];
  for (const coluna of colunas) {
    assert.ok(schema.includes(coluna), `o schema real não tem a coluna ${coluna}`);
  }
});
