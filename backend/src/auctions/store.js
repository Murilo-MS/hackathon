// Armazenamento dos leilões em memória.
// ATENÇÃO: é temporário. Reiniciar o servidor apaga leilões e lances.
// Este arquivo é o único que conhece "onde os dados moram"; quando o PostgreSQL
// entrar, só ele muda de implementação e as rotas continuam iguais.

const leiloes = [];
const lances = [];
let proximoIdLeilao = 1;
let proximoLanceId = 1;

const LIMITES = {
  tituloMin: 3,
  tituloMax: 80,
  descricaoMax: 500,
  duracaoMin: 1,
  duracaoMax: 1440,
};

const reais = (valor) =>
  valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Erro com status HTTP: o middleware de erro do app.js transforma em resposta JSON
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

function criar({ titulo, descricao, precoInicial, incrementoMinimo, duracaoMinutos, dono }) {
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

  const incremento = paraNumero(incrementoMinimo, 'O incremento mínimo');
  if (incremento <= 0) {
    throw erro(400, 'O incremento mínimo precisa ser maior que zero', 'INCREMENTO_INVALIDO');
  }

  const duracao = paraNumero(duracaoMinutos, 'A duração');
  if (duracao < LIMITES.duracaoMin || duracao > LIMITES.duracaoMax) {
    throw erro(
      400,
      `A duração precisa ficar entre ${LIMITES.duracaoMin} e ${LIMITES.duracaoMax} minutos`,
      'DURACAO_INVALIDA'
    );
  }

  const agora = new Date();
  const leilao = {
    id: proximoIdLeilao++,
    titulo: tituloLimpo,
    descricao: typeof descricao === 'string' ? descricao.trim().slice(0, LIMITES.descricaoMax) : '',
    precoInicial: preco,
    incrementoMinimo: incremento,
    criadoEm: agora,
    terminaEm: new Date(agora.getTime() + duracao * 60000),
    donoId: dono.id,
    donoNome: dono.nome,
    status: 'aberto',
    maiorLance: null,
    vencedor: null,
    encerradoEm: null,
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

// Quanto vale o próximo lance: o primeiro pode ser igual ao preço inicial,
// os seguintes precisam superar o maior lance em pelo menos um incremento.
function proximoMinimo(leilao) {
  return leilao.maiorLance
    ? arredondar(leilao.maiorLance.valor + leilao.incrementoMinimo)
    : leilao.precoInicial;
}

function paraApi(leilao) {
  return {
    id: leilao.id,
    titulo: leilao.titulo,
    descricao: leilao.descricao,
    precoInicial: leilao.precoInicial,
    incrementoMinimo: leilao.incrementoMinimo,
    donoNome: leilao.donoNome,
    donoId: leilao.donoId,
    maiorLance: leilao.maiorLance,
    proximoMinimo: proximoMinimo(leilao),
    status: leilao.status,
    terminaEm: leilao.terminaEm.toISOString(),
    encerradoEm: leilao.encerradoEm,
    vencedor: leilao.vencedor,
    // O front usa este campo para acertar o cronômetro com o relógio do servidor,
    // que é a única fonte de verdade sobre o horário de encerramento.
    agora: new Date().toISOString(),
  };
}

function listar() {
  return leiloes
    .map(paraApi)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'aberto' ? -1 : 1;
      return a.terminaEm.localeCompare(b.terminaEm);
    });
}

function historico(leilaoId) {
  return lances
    .filter((l) => l.leilaoId === Number(leilaoId))
    .sort((a, b) => b.id - a.id) // mais recente primeiro
    .map((l) => ({
      id: l.id,
      usuarioNome: l.usuarioNome,
      valor: l.valor,
      criadoEm: l.criadoEm.toISOString(),
    }));
}

function darLance({ leilaoId, usuario, valor }) {
  const leilao = buscar(leilaoId);

  // Validação e gravação acontecem juntas, sem nenhum "await" no meio.
  // Em Node isso é atômico: nenhuma outra requisição entra entre o "if" e o "push".
  // Com PostgreSQL, essa garantia vem do BEGIN + SELECT ... FOR UPDATE.
  if (leilao.status !== 'aberto' || new Date() >= leilao.terminaEm) {
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
    throw erro(400, `O lance mínimo agora é ${reais(minimo)}`, 'LANCE_ABAIXO_DO_MINIMO');
  }
  if (leilao.maiorLance && leilao.maiorLance.usuarioId === usuario.id) {
    throw erro(409, 'Você já é o maior lance deste leilão', 'JA_E_O_MAIOR');
  }

  const agora = new Date();
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

// Chamado a cada segundo pelo server.js: fecha o que passou do horário
function encerrarVencidos() {
  const agora = new Date();
  const encerrados = [];
  for (const leilao of leiloes) {
    if (leilao.status === 'aberto' && agora >= leilao.terminaEm) {
      leilao.status = 'encerrado';
      leilao.encerradoEm = leilao.terminaEm.toISOString();
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
  return encerrados;
}

module.exports = {
  criar,
  buscar,
  listar,
  historico,
  darLance,
  encerrarVencidos,
  paraApi,
  proximoMinimo,
};
