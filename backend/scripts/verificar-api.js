// Verificação ponta a ponta: agendamento, transições de estado, tabela de
// incremento do RF14, regras de lance e tempo real.
// Uso: node scripts/verificar-api.js
//      BASE_URL=http://200.18.99.113:8080 node scripts/verificar-api.js  (testar o publicado)
// Padrão é localhost:8080 para não criar contas de teste no servidor da demonstração.

const assert = require('node:assert');
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
let ok = 0;
let falhas = 0;

function conferir(nome, condicao, detalhe = '') {
  if (condicao) {
    ok++;
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome} ${detalhe}`);
  }
}

async function chamar(metodo, caminho, { corpo, token } = {}) {
  const headers = {};
  if (corpo) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const resposta = await fetch(BASE + caminho, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resposta.text();
  let dados = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = { bruto: texto };
  }
  return { status: resposta.status, dados };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const email = () => `u${Math.random().toString(36).slice(2, 10)}@exemplo.com`;
const iso = (ms) => new Date(ms).toISOString();

async function novoUsuario(nome) {
  const { dados } = await chamar('POST', '/auth/register', {
    corpo: { nome, email: email(), senha: 'senha12345' },
  });
  return { usuario: dados.usuario, token: dados.token };
}

async function criarLeilao(token, { titulo, preco, inicioMs, fimMs }) {
  return chamar('POST', '/auctions', {
    token,
    corpo: {
      titulo,
      descricao: 'Item de teste automatizado',
      precoInicial: preco,
      inicio: iso(inicioMs),
      fim: iso(fimMs),
    },
  });
}

async function principal() {
  console.log(`Servidor: ${BASE}`);

  conferir('GET /health responde 200', (await chamar('GET', '/health')).status === 200);

  const dono = await novoUsuario('Dono do Item');
  const ana = await novoUsuario('Ana');
  const bruno = await novoUsuario('Bruno');
  conferir('três cadastros retornam token', Boolean(dono.token && ana.token && bruno.token));

  const agora = Date.now();

  // ---------- leilão curto: agenda, abre sozinho e fecha sozinho ----------
  const criadoEm = Date.now();
  const curto = await criarLeilao(dono.token, {
    titulo: 'Bicicleta usada',
    preco: 100,
    inicioMs: criadoEm,
    fimMs: criadoEm + 15000,
  });
  conferir('cria leilão agendado (201)', curto.status === 201, `status=${curto.status}`);
  const leilao = curto.dados.leilao;
  conferir('nasce no estado SCHEDULED', leilao.status === 'SCHEDULED', leilao.status);
  conferir('primeiro lance mínimo = preço inicial', leilao.proximoMinimo === 100);
  conferir('incremento da faixa 100..499,99 = 5', leilao.incrementoAtual === 5);

  const antesDeAbrir = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 100 },
  });
  conferir('lance em leilão agendado é recusado', antesDeAbrir.status === 409, `status=${antesDeAbrir.status}`);

  // cliente escutando a sala
  const eventos = { new_bid: [], auction_started: [], auction_ended: [] };
  const cliente = io(BASE, { transports: ['websocket'] });
  await new Promise((resolver) => cliente.on('connect', resolver));
  cliente.emit('join_auction', leilao.id);
  cliente.on('new_bid', (d) => eventos.new_bid.push(d));
  cliente.on('auction_started', (d) => eventos.auction_started.push(d));
  cliente.on('auction_ended', (d) => eventos.auction_ended.push(d));

  await dormir(1600);
  const abriu = await chamar('GET', `/auctions/${leilao.id}`);
  conferir('abre sozinho no horário (ACTIVE)', abriu.dados.leilao.status === 'ACTIVE', abriu.dados.leilao.status);
  conferir('socket avisou auction_started', eventos.auction_started.length >= 1);

  const lanceAna = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 100 },
  });
  conferir('primeiro lance válido aceito', lanceAna.status === 201, `status=${lanceAna.status}`);
  conferir('próximo mínimo sobe 5 (100 -> 105)', lanceAna.dados.leilao.proximoMinimo === 105);

  const abaixo = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 104 },
  });
  conferir('lance abaixo do mínimo é recusado', abaixo.status === 400, `status=${abaixo.status}`);

  const lanceBruno = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 105 },
  });
  conferir('lance no valor mínimo é aceito', lanceBruno.status === 201);
  conferir('próximo mínimo sobe para 110', lanceBruno.dados.leilao.proximoMinimo === 110);

  const lanceAna2 = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 110 },
  });
  conferir('Ana cobre o lance de Bruno', lanceAna2.status === 201);

  const repetido = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 115 },
  });
  conferir('líder não pode cobrir a si mesmo', repetido.status === 409, `status=${repetido.status}`);

  const doDono = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: dono.token,
    corpo: { valor: 120 },
  });
  conferir('dono não pode dar lance no próprio leilão', doDono.status === 403);

  const detalhe = await chamar('GET', `/auctions/${leilao.id}`);
  conferir('histórico tem 3 lances', detalhe.dados.historico.length === 3, `len=${detalhe.dados.historico.length}`);
  conferir('histórico do mais recente para o mais antigo', detalhe.dados.historico[0].valor === 110);

  // ---------- espera o término ----------
  await dormir(Math.max(0, criadoEm + 16500 - Date.now()));
  const fechado = await chamar('GET', `/auctions/${leilao.id}`);
  conferir('fecha sozinho e fica SOLD', fechado.dados.leilao.status === 'SOLD', fechado.dados.leilao.status);
  conferir('vencedor é quem liderava', fechado.dados.leilao.vencedor?.usuarioNome === 'Ana', JSON.stringify(fechado.dados.leilao.vencedor));
  conferir('socket avisou auction_ended', eventos.auction_ended.length >= 1);
  conferir('socket recebeu os 3 lances', eventos.new_bid.length >= 3, `eventos=${eventos.new_bid.length}`);
  conferir('último new_bid trouxe próximo mínimo 115', eventos.new_bid.at(-1)?.proximoMinimo === 115, JSON.stringify(eventos.new_bid.at(-1)));

  const depoisDoFim = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 200 },
  });
  conferir('lance após o término é recusado', depoisDoFim.status === 409, `status=${depoisDoFim.status}`);

  cliente.close();

  // ---------- outras faixas da tabela, pela API ----------
  const agora2 = Date.now();
  const caro = await criarLeilao(dono.token, {
    titulo: 'Notebook',
    preco: 5000,
    inicioMs: agora2,
    fimMs: agora2 + 3600000,
  });
  conferir('faixa de 5.000 usa incremento de 100', caro.dados.leilao.incrementoAtual === 100, `inc=${caro.dados.leilao.incrementoAtual}`);

  const muitoCaro = await criarLeilao(dono.token, {
    titulo: 'Carro',
    preco: 25000,
    inicioMs: agora2,
    fimMs: agora2 + 3600000,
  });
  conferir('faixa de 25.000 usa incremento de 500', muitoCaro.dados.leilao.incrementoAtual === 500, `inc=${muitoCaro.dados.leilao.incrementoAtual}`);

  // ---------- validações de agendamento ----------
  const noPassado = await criarLeilao(dono.token, {
    titulo: 'Tarde demais',
    preco: 100,
    inicioMs: agora2 - 600000,
    fimMs: agora2 + 600000,
  });
  conferir('início no passado é recusado', noPassado.status === 400, `status=${noPassado.status}`);

  const curtoDemais = await criarLeilao(dono.token, {
    titulo: 'Rápido demais',
    preco: 100,
    inicioMs: agora2,
    fimMs: agora2 + 3000,
  });
  conferir('duração abaixo do mínimo é recusada', curtoDemais.status === 400, `status=${curtoDemais.status}`);

  const tituloCurto = await chamar('POST', '/auctions', {
    token: dono.token,
    corpo: { titulo: 'ab', precoInicial: 10, inicio: iso(agora2), fim: iso(agora2 + 600000) },
  });
  conferir('título curto é recusado', tituloCurto.status === 400);

  console.log(`\n${ok} verificações ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((erro) => {
  console.error('Erro inesperado:', erro);
  process.exit(1);
});
