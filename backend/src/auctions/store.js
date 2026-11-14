// Armazenamento dos leilões em memória (temporário: será trocado pelo PostgreSQL).
//
// Ciclo de vida do leilão (RN01 do edital): 5 estados, 5 transições.
//   SCHEDULED (agendado) --chega o início--> ACTIVE (em andamento)
//   SCHEDULED --cancelado pelo dono--> CANCELED
//   ACTIVE --termina com lances--> SOLD (vendido)
//   ACTIVE --termina sem lances--> ENDED_NO_BIDS (encerrado sem lances)
//   ACTIVE --cancelado sem lances--> CANCELED
// Os três últimos são finais: não saem deles.
//
// Os códigos ficam em inglês de propósito: são exatamente os valores do ENUM
// auction_status em dados/leilao_db.sql. Quando o banco entrar, não há tradução.

const leiloes = [];
const lances = [];
let proximoIdLeilao = 1;
let proximoLanceId = 1;

const LIMITES = {
  tituloMin: 3,
  tituloMax: 80,
  descricaoMax: 500,
  duracaoMinSegundos: 10, // decisão da equipe: curto o bastante para a demo
  duracaoMaxSegundos: 24 * 60 * 60,
  antecedenciaMaxSegundos: 7 * 24 * 60 * 60,
};

const ROTULOS = {
  SCHEDULED: 'agendado',
  ACTIVE: 'em andamento',
  SOLD: 'vendido',
  ENDED_NO_BIDS: 'encerrado sem lances',
  CANCELED: 'cancelado',
};

// Tabela do RF14: o incremento depende do preço atual, e só dele.
const FAIXAS = [
  { ate: 99.99, incremento: 1 },
  { ate: 499.99, incremento: 5 },
  { ate: 999.99, incremento: 10 },
  { ate: 4999.99, incremento: 50 },
  { ate: 24999.99, incremento: 100 },
  { ate: Infinity, incremento: 500 },
];

const reais = (valor) =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function erro(status, mensagem, codigo) {
  const e = new Error(mensagem);
  e.status = status;
  e.codigo = codigo;
  return e;
}

const arredondar = (valor) => Math.round(valor * 100) / 100;

function paraNumero(valor, campo) {
  const numero =
    typeof valor === 'number' ? valor : Number(String(valor ?? '').replace(',', '.'));
  if (!Number.isFinite(numero)) {
    throw erro(400, `${campo} precisa ser um número`, 'VALOR_INVALIDO');
  }
  return arredondar(numero);
}

function paraData(valor, campo) {
  if (!valor) throw erro(400, `${campo} é obrigatório`, 'DATA_OBRIGATORIA');
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) {
    throw erro(400, `${campo} inválido`, 'DATA_INVALIDA');
  }
  return data;
}

// ---------------------------------------------------------------- regra RF14
function incrementoPara(precoAtual) {
  return FAIXAS.find((faixa) => precoAtual <= faixa.ate).incremento;
}

// Valor mínimo do próximo lance. Primeiro lance pode ser igual ao preço inicial.
function proximoMinimo(leilao) {
  if (!leilao.maiorLance) return leilao.precoInicial;
  return arredondar(leilao.maiorLance.valor + incrementoPara(leilao.maiorLance.valor));
}

// ---------------------------------------------------------------- criação
function criar({ titulo, descricao, precoInicial, inicio, fim, dono }) {
  if (typeof titulo !== 'string') {
    throw erro(400, 'O título é obrigatório', 'TITULO_OBRIGATORIO');
  }
  const tituloLimpo = titulo.trim();
  if (tituloLimpo.length < LIMITES.tituloMin || tituloLimpo.length > LIMITES.tituloMax) {
    throw erro(
      400,
      `O título precisa ter entre ${LIMITES.tituloMin} e ${LIMITES.tituloMax} caracteres`,
      'TITULO_INVALIDO'
    );
  }

  const preco = paraNumero(precoInicial, 'O preço inicial');
  if (preco <= 0) throw erro(400, 'O preço inicial precisa ser maior que zero', 'PRECO_INVALIDO');

  const agora = new Date();
  const comeco = paraData(inicio, 'O início');
  const termino = paraData(fim, 'O término');

  if (comeco.getTime() < agora.getTime() - 60000) {
    throw erro(400, 'O início não pode estar no passado', 'INICIO_NO_PASSADO');
  }
  if (comeco.getTime() > agora.getTime() + LIMITES.antecedenciaMaxSegundos * 1000) {
    throw erro(400, 'O início não pode ser mais de 7 dias à frente', 'INICIO_LONGE_DEMAIS');
  }

  const duracaoSegundos = (termino.getTime() - comeco.getTime()) / 1000;
  if (duracaoSegundos < LIMITES.duracaoMinSegundos) {
    throw erro(
      400,
      `A duração mínima é de ${LIMITES.duracaoMinSegundos} segundos`,
      'DURACAO_CURTA'
    );
  }
  if (duracaoSegundos > LIMITES.duracaoMaxSegundos) {
    throw erro(400, 'A duração máxima é de 24 horas', 'DURACAO_LONGA');
  }

  const leilao = {
    id: proximoIdLeilao++,
    titulo: tituloLimpo,
    descricao:
      typeof descricao === 'string' ? descricao.trim().slice(0, LIMITES.descricaoMax) : '',
    precoInicial: preco,
    // Compra: o leilão nasce AGENDADO, mesmo que o início seja agora.
    // O relógio do servidor promove para ACTIVE no instante do início.
    startsAt: comeco,
    endsAt: termino,
    status: 'SCHEDULED',
    donoId: dono.id,
    donoNome: dono.nome,
    maiorLance: null,
    vencedor: null,
    encerradoEm: null,
    criadoEm: agora,
  };
  leiloes.push(leilao);
  return leilao;
}

function buscar(id) {
  const numero = Number(id);
  const leilao = leiloes.find((l) => l.id === numero);
  if (!leilao) throw erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  return leilao;
}

function paraApi(leilao) {
  return {
    id: leilao.id,
    titulo: leilao.titulo,
    descricao: leilao.descricao,
    precoInicial: leilao.precoInicial,
    donoId: leilao.donoId,
    donoNome: leilao.donoNome,
    status: leilao.status,
    statusRotulo: ROTULOS[leilao.status],
    maiorLance: leilao.maiorLance,
    // Preço atual e próximo mínimo são calculados, nunca digitados
    lanceAtual: leilao.maiorLance ? leilao.maiorLance.valor : null,
    incrementoAtual: incrementoPara(
      leilao.maiorLance ? leilao.maiorLance.valor : leilao.precoInicial
    ),
    proximoMinimo: proximoMinimo(leilao),
    startsAt: leilao.startsAt.toISOString(),
    endsAt: leilao.endsAt.toISOString(),
    encerradoEm: leilao.encerradoEm,
    vencedor: leilao.vencedor,
    agora: new Date().toISOString(),
  };
}

function listar() {
  return leiloes
    .map(paraApi)
    .sort((a, b) => {
      const ordem = { ACTIVE: 0, SCHEDULED: 1, SOLD: 2, ENDED_NO_BIDS: 3, CANCELED: 4 };
      if (ordem[a.status] !== ordem[b.status]) return ordem[a.status] - ordem[b.status];
      return a.endsAt.localeCompare(b.endsAt);
    });
}

function historico(leilaoId) {
  return lances
    .filter((l) => l.leilaoId === Number(leilaoId))
    .sort((a, b) => b.id - a.id)
    .map((l) => ({
      id: l.id,
      usuarioNome: l.usuarioNome,
      valor: l.valor,
      criadoEm: l.criadoEm.toISOString(),
    }));
}

// ---------------------------------------------------------------- lance
function darLance({ leilaoId, usuario, valor }) {
  const leilao = buscar(leilaoId);
  const agora = new Date();

  // RF10: todas as condições validadas no momento em que o lance é processado.
  // Sem nenhum "await" entre validar e gravar: em Node isso é atômico.
  // Com PostgreSQL, a mesma garantia vem de BEGIN + SELECT ... FOR UPDATE.
  if (leilao.status === 'SCHEDULED') {
    throw erro(409, 'O leilão ainda não começou', 'LEILAO_AGENDADO');
  }
  if (leilao.status !== 'ACTIVE' || agora >= leilao.endsAt) {
    throw erro(409, 'Este leilão já foi encerrado', 'LEILAO_ENCERRADO');
  }
  if (leilao.donoId === usuario.id) {
    throw erro(403, 'Você não pode dar lance no seu próprio leilão', 'DONO_DO_LEILAO');
  }

  const valorLance = paraNumero(valor, 'O lance');
  if (valorLance <= 0) {
    throw erro(400, 'O lance precisa ser maior que zero', 'LANCE_INVALIDO');
  }

  const minimo = proximoMinimo(leilao);
  if (valorLance < minimo) {
    throw erro(
      400,
      `O lance mínimo agora é ${reais(minimo)} (incremento de ${reais(incrementoPara(leilao.maiorLance ? leilao.maiorLance.valor : leilao.precoInicial))})`,
      'LANCE_ABAIXO_DO_MINIMO'
    );
  }
  if (leilao.maiorLance && leilao.maiorLance.usuarioId === usuario.id) {
    throw erro(409, 'Você já é o maior lance deste leilão', 'JA_E_O_MAIOR');
  }

  const lance = {
    id: proximoLanceId++,
    leilaoId: leilao.id,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    valor: valorLance,
    criadoEm: agora,
  };
  lances.push(lance);
  leilao.maiorLance = {
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    valor: valorLance,
    criadoEm: agora.toISOString(),
  };

  return { lance, leilao };
}

// ---------------------------------------------------------------- relógio
// Chamado a cada segundo pelo server.js. Devolve o que mudou para o server
// avisar as salas: quem abriu e quem fechou.
function atualizarEstados() {
  const agora = new Date();
  const abertos = [];
  const encerrados = [];

  for (const leilao of leiloes) {
    if (leilao.status === 'SCHEDULED' && agora >= leilao.startsAt) {
      leilao.status = 'ACTIVE';
      abertos.push(leilao);
    }
    if (leilao.status === 'ACTIVE' && agora >= leilao.endsAt) {
      leilao.status = leilao.maiorLance ? 'SOLD' : 'ENDED_NO_BIDS';
      leilao.encerradoEm = leilao.endsAt.toISOString();
      leilao.vencedor = leilao.maiorLance
        ? {
            usuarioId: leilao.maiorLance.usuarioId,
            usuarioNome: leilao.maiorLance.usuarioNome,
            valor: leilao.maiorLance.valor,
          }
        : null;
      encerrados.push(leilao);
    }
  }

  return { abertos, encerrados };
}

module.exports = {
  criar,
  buscar,
  listar,
  historico,
  darLance,
  atualizarEstados,
  paraApi,
  proximoMinimo,
  incrementoPara,
};
