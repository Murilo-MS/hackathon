// Verificação ponta a ponta do leilão: autenticação, regras de lance e tempo real.
// Uso: node scripts/verificar-api.js   (com o servidor já rodando)
// BASE_URL=http://127.0.0.1:8080 node scripts/verificar-api.js

const assert = require('node:assert');
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://200.18.99.113:3000';
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

const email = () => `u${Math.random().toString(36).slice(2, 10)}@exemplo.com`;

async function novoUsuario(nome) {
  const { dados } = await chamar('POST', '/auth/register', {
    corpo: { nome, email: email(), senha: 'senha12345' },
  });
  return { usuario: dados.usuario, token: dados.token };
}

async function principal() {
  console.log(`Servidor: ${BASE}`);

  const saude = await chamar('GET', '/health');
  conferir('GET /health responde 200', saude.status === 200);

  const dono = await novoUsuario('Dono do Item');
  const ana = await novoUsuario('Ana');
  const bruno = await novoUsuario('Bruno');
  conferir('três cadastros retornam token', Boolean(dono.token && ana.token && bruno.token));

  const criado = await chamar('POST', '/auctions', {
    token: dono.token,
    corpo: {
      titulo: 'Bicicleta usada',
      descricao: 'Aro 29, revisada',
      precoInicial: 100,
      incrementoMinimo: 10,
      duracaoMinutos: 5,
    },
  });
  conferir('POST /auctions cria leilão (201)', criado.status === 201, `status=${criado.status}`);
  const leilao = criado.dados.leilao;
  conferir('leilão começa aberto e sem lance', leilao.status === 'aberto' && leilao.maiorLance === null);
  conferir('primeiro lance mínimo é o preço inicial', leilao.proximoMinimo === 100);

  const semLogin = await chamar('POST', '/auctions', {
    corpo: { titulo: 'Sem token', precoInicial: 10, incrementoMinimo: 1, duracaoMinutos: 5 },
  });
  conferir('criar leilão sem token dá 401', semLogin.status === 401);

  const lista = await chamar('GET', '/auctions');
  conferir('listagem é pública e traz o leilão', lista.status === 200 && lista.dados.leiloes.some((l) => l.id === leilao.id));

  const abaixoDoMinimo = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 90 },
  });
  conferir('lance abaixo do mínimo é recusado', abaixoDoMinimo.status === 400, `status=${abaixoDoMinimo.status}`);

  const semToken = await chamar('POST', `/auctions/${leilao.id}/bids`, { corpo: { valor: 100 } });
  conferir('lance sem token dá 401', semToken.status === 401);

  const doDono = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: dono.token,
    corpo: { valor: 100 },
  });
  conferir('dono não pode dar lance no próprio item', doDono.status === 403, `status=${doDono.status}`);

  // ---- tempo real: um cliente escutando a sala enquanto outro dá lance ----
  const eventos = [];
  const cliente = io(BASE, { transports: ['websocket'] });
  const conectado = new Promise((resolver) => cliente.on('connect', resolver));
  await conectado;
  cliente.emit('join_auction', leilao.id);
  cliente.on('new_bid', (dados) => eventos.push(dados));
  await new Promise((r) => setTimeout(r, 300)); // tempo para entrar na sala

  const lanceAna = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: ana.token,
    corpo: { valor: 100 },
  });
  conferir('primeiro lance válido é aceito (201)', lanceAna.status === 201, `status=${lanceAna.status}`);
  conferir('lance atual vira 100 e próximo mínimo 110', lanceAna.dados.leilao.maiorLance.valor === 100 && lanceAna.dados.leilao.proximoMinimo === 110);

  const lanceBruno = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 110 },
  });
  conferir('segundo lance válido é aceito', lanceBruno.status === 201);

  const repetido = await chamar('POST', `/auctions/${leilao.id}/bids`, {
    token: bruno.token,
    corpo: { valor: 130 },
  });
  conferir('quem já é o maior lance não pode cobrir a si mesmo', repetido.status === 409, `status=${repetido.status}`);

  const detalhe = await chamar('GET', `/auctions/${leilao.id}`);
  conferir('detalhe traz histórico com 2 lances', detalhe.dados.historico.length === 2, `len=${detalhe.dados.historico.length}`);
  conferir('histórico vem do mais recente para o mais antigo', detalhe.dados.historico[0].valor === 110);

  await new Promise((r) => setTimeout(r, 500));
  conferir('socket recebeu os eventos new_bid', eventos.length >= 2, `eventos=${eventos.length}`);
  const ultimo = eventos[eventos.length - 1];
  conferir('evento new_bid traz lance e próximo mínimo', Boolean(ultimo && ultimo.lanceAtual === 110 && ultimo.proximoMinimo === 120), JSON.stringify(ultimo));

  const inexistente = await chamar('GET', '/auctions/99999');
  conferir('leilão inexistente dá 404', inexistente.status === 404);

  const invalido = await chamar('POST', '/auctions', {
    token: dono.token,
    corpo: { titulo: 'ab', precoInicial: 10, incrementoMinimo: 1, duracaoMinutos: 5 },
  });
  conferir('título curto é recusado', invalido.status === 400, `status=${invalido.status}`);

  cliente.close();

  console.log(`\n${ok} verificações ok, ${falhas} falha(s)`);
  process.exit(falhas === 0 ? 0 : 1);
}

principal().catch((erro) => {
  console.error('Erro inesperado:', erro);
  process.exit(1);
});
