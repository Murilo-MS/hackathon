// Verificação ponta a ponta do Núcleo: agendamento, estados, tabela do RF14,
// regras de lance, idempotência (RF12), frequência (RF13), fotos (RF05/RF07),
// cancelamento (RF08) e tempo real.
//
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

async function chamar(metodo, caminho, { corpo, token, headers = {} } = {}) {
  const cabecalhos = { ...headers };
  if (corpo) cabecalhos['Content-Type'] = 'application/json';
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  const resposta = await fetch(BASE + caminho, {
    method: metodo,
    headers: cabecalhos,
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
const FOTOS = [
  'https://picsum.photos/seed/t1/800/600',
  'https://picsum.photos/seed/t2/800/600',
  'https://picsum.photos/seed/t3/800/600',
];

async function novoUsuario(nome) {
  const { dados } = await chamar('POST', '/auth/register', {
    corpo: { nome, email: email(), senha: 'senha12345' },
  });
  return { usuario: dados.usuario, token: dados.token };
}

async function criarLeilao(token, { titulo, preco, inicioMs, fimMs, fotos = FOTOS }) {
  return chamar('POST', '/auctions', {
    token,
    corpo: {
      titulo,
      descricao: 'Item de teste automatizado',
      categoria: 'Teste',
      fotos,
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
  const ana = await novoUsuario('Ana Souza');
  const bruno = await novoUsuario('Bruno Lima');
  conferir('três cadastros retornam token', Boolean(dono.token && ana.token && bruno.token));

  const agora = Date.now();

  // ---------- fotos (RF05/RF07) ----------
  const semFotos = await criarLeilao(dono.token, {
    titulo: 'Sem fotos',
    preco: 100,
    inicioMs: agora,
    fimMs: agora + 600000,
    fotos: [],
  });
  conferir('criar sem 3 fotos é recusado', semFotos.status === 400, `status=${semFotos.status}`);

  const urlInvalida = await criarLeilao(dono.token, {
    titulo: 'Foto estranha',
    preco: 100,
    inicioMs: agora,
    fimMs: agora + 600000,
    fotos: ['ftp://arquivo/foto.jpg', FOTOS[1], FOTOS[2]],
  });
  conferir('foto fora de http(s) é recusada', urlInvalida.status === 400);

  // ---------- leilão curto: agenda, abre e fecha sozinho ----------
  const criadoEm = Date.now();
  const curto = await criarLeilao(dono.token, {
    titulo: 'Bicicleta usada',
    preco: 100,
    inicioMs: criadoEm,
    fimMs: criadoEm + 15000,
  });
  conferir('cria leilão agendado (201)', curto.status === 201, `status=${curto.status}`);
  const leilao = curto.dados.leilao;
  conferir('nasce SCHEDULED', leilao.status === 'SCHEDULED', leilao.status);
  conferir('traz as 3 fotos na ordem', leilao.fotos?.length === 3 && leilao.fotos[0] === FOTOS[0]);
  conferir('incremento da faixa 100..499,99 = 5', leilao.incrementoAtual === 5);
  conferir('dono aparece mascarado', leilao.donoNome === 'Dono I.', leilao.donoNome);

  const antesDeAbrir = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 100 },
  });
  conferir('lance em leilão agendado é recusado', antesDeAbrir.status === 409);

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
  conferir('total de lances vai para 1', lanceAna.dados.leilao.totalLances === 1);

  const abaixo = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 104 },
  });
  conferir('lance abaixo do mínimo é recusado', abaixo.status === 400);

  const lanceBruno = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 105 },
  });
  conferir('lance no valor mínimo é aceito', lanceBruno.status === 201);

  await dormir(600); // respeita o intervalo do RF13 antes de Ana cobrir
  const lanceAna2 = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 110 },
  });
  conferir('Ana cobre o lance de Bruno', lanceAna2.status === 201);

  const repetido = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 115 },
  });
  conferir('líder não pode cobrir a si mesmo', repetido.status === 409);

  const doDono = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: dono.token,
    corpo: { valor: 120 },
  });
  conferir('dono não pode dar lance no próprio leilão', doDono.status === 403);

  const detalhe = await chamar('GET', `/auctions/${leilao.id}`);
  conferir('histórico tem 3 lances', detalhe.dados.historico.length === 3, `len=${detalhe.dados.historico.length}`);
  conferir('histórico do mais recente para o mais antigo', detalhe.dados.historico[0].valor === 110);

  await dormir(Math.max(0, criadoEm + 16500 - Date.now()));
  const fechado = await chamar('GET', `/auctions/${leilao.id}`);
  conferir('fecha sozinho e fica SOLD', fechado.dados.leilao.status === 'SOLD', fechado.dados.leilao.status);
  conferir('vencedor é quem liderava', fechado.dados.leilao.vencedor?.usuarioNome === 'Ana S.', JSON.stringify(fechado.dados.leilao.vencedor));
  conferir('socket avisou auction_ended', eventos.auction_ended.length >= 1);
  conferir('socket recebeu os 3 lances', eventos.new_bid.length >= 3, `eventos=${eventos.new_bid.length}`);
  const ultimo = eventos.new_bid.at(-1);
  conferir('new_bid traz próximo mínimo e total', ultimo?.proximoMinimo === 115 && ultimo?.totalLances === 3, JSON.stringify(ultimo));

  const depoisDoFim = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 200 },
  });
  conferir('lance após o término é recusado', depoisDoFim.status === 409);

  cliente.close();

  // ---------- leilão para RF12 e RF13 ----------
  const veloz = await criarLeilao(dono.token, {
    titulo: 'Item veloz',
    preco: 100,
    inicioMs: Date.now(),
    fimMs: Date.now() + 3600000,
  });
  const idVeloz = veloz.dados.leilao.id;
  await dormir(1300); // abre no relógio do servidor

  await chamar('POST', `/auctions/${idVeloz}/bids`, { token: ana.token, corpo: { valor: 100 } });
  await chamar('POST', `/auctions/${idVeloz}/bids`, { token: bruno.token, corpo: { valor: 105 } });

  const rapidoDemais = await chamar('POST', `/auctions/${idVeloz}/bids`, {
    token: ana.token,
    corpo: { valor: 110 },
  });
  conferir('dois lances do mesmo usuário em <500 ms é recusado (RF13)', rapidoDemais.status === 429, `status=${rapidoDemais.status}`);

  await dormir(600);
  const chave = '11111111-1111-4111-8111-111111111111';
  const comChave = await chamar('POST', `/auctions/${idVeloz}/bids`, {
    token: ana.token,
    corpo: { valor: 110, idempotencyKey: chave },
  });
  conferir('após 500 ms o lance é aceito', comChave.status === 201, `status=${comChave.status}`);

  const reenvio = await chamar('POST', `/auctions/${idVeloz}/bids`, {
    token: ana.token,
    corpo: { valor: 110, idempotencyKey: chave },
  });
  conferir('reenvio devolve 200, não 201 (RF12)', reenvio.status === 200, `status=${reenvio.status}`);
  conferir('reenvio aponta o mesmo lance', reenvio.dados.lance?.id === comChave.dados.lance?.id);
  conferir('reenvio marcado como repetido', reenvio.dados.repetido === true);

  const historicoVeloz = await chamar('GET', `/auctions/${idVeloz}/bids`);
  conferir('reenvio não criou lance extra', historicoVeloz.dados.historico.length === 3, `len=${historicoVeloz.dados.historico.length}`);

  // ---------- cancelamento (RF08) ----------
  const cancelavel = await criarLeilao(dono.token, {
    titulo: 'Para cancelar',
    preco: 100,
    inicioMs: Date.now(),
    fimMs: Date.now() + 3600000,
  });
  const idCancelavel = cancelavel.dados.leilao.id;

  const porOutro = await chamar('POST', `/auctions/${idCancelavel}/cancelar`, { token: ana.token });
  conferir('só o dono cancela', porOutro.status === 403);

  const cancelado = await chamar('POST', `/auctions/${idCancelavel}/cancelar`, { token: dono.token });
  conferir('dono cancela leilão sem lances', cancelado.status === 200 && cancelado.dados.leilao.status === 'CANCELED', `status=${cancelado.status}`);

  const cancelarDeNovo = await chamar('POST', `/auctions/${idCancelavel}/cancelar`, { token: dono.token });
  conferir('não cancela duas vezes', cancelarDeNovo.status === 409);

  const cancelarComLance = await chamar('POST', `/auctions/${idVeloz}/cancelar`, { token: dono.token });
  conferir('leilão com lances não pode ser cancelado', cancelarComLance.status === 409);

  // ---------- faixas da tabela do RF14 ----------
  const caro = await criarLeilao(dono.token, {
    titulo: 'Notebook',
    preco: 5000,
    inicioMs: Date.now(),
    fimMs: Date.now() + 3600000,
  });
  conferir('faixa de 5.000 usa incremento de 100', caro.dados.leilao.incrementoAtual === 100);

  const muitoCaro = await criarLeilao(dono.token, {
    titulo: 'Carro',
    preco: 25000,
    inicioMs: Date.now(),
    fimMs: Date.now() + 3600000,
  });
  conferir('faixa de 25.000 usa incremento de 500', muitoCaro.dados.leilao.incrementoAtual === 500);

  // ---------- validações de agendamento ----------
  const noPassado = await criarLeilao(dono.token, {
    titulo: 'Tarde demais',
    preco: 100,
    inicioMs: Date.now() - 600000,
    fimMs: Date.now() + 600000,
  });
  conferir('início no passado é recusado', noPassado.status === 400);

  const curtoDemais = await criarLeilao(dono.token, {
    titulo: 'Rápido demais',
    preco: 100,
    inicioMs: Date.now(),
    fimMs: Date.now() + 3000,
  });
  conferir('duração abaixo do mínimo é recusada', curtoDemais.status === 400);

  const inexistente = await chamar('GET', '/auctions/99999');
  conferir('leilão inexistente dá 404', inexistente.status === 404);

  console.log(`\n${ok} verificações ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((erro) => {
  console.error('Erro inesperado:', erro);
  process.exit(1);
});
