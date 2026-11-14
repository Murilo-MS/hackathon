// Regras do leilão que NÃO dependem de banco de dados.
// Ficam separadas para poder ser testadas sem PostgreSQL (ver test/auctions.test.js).

const LIMITES = {
  tituloMin: 3,
  tituloMax: 150, // cabe em items.name VARCHAR(150)
  descricaoMax: 2000,
  categoriaMax: 80, // items.category VARCHAR(80)
  duracaoMinSegundos: 10, // decisão da equipe: curto o bastante para a demo (RF06)
  duracaoMaxSegundos: 24 * 60 * 60,
  antecedenciaMaxSegundos: 7 * 24 * 60 * 60,
  toleranciaInicioPassadoMs: 60 * 1000,
  // RF05: pelo menos 3 fotos. RF07: a equipe decide tipos e tamanhos.
  fotosMin: 3,
  fotosMax: 6,
  fotoUrlMax: 500,
  // RF13: intervalo mínimo entre lances do MESMO usuário
  intervaloMinimoLanceMs: 500,
};

const ROTULOS = {
  SCHEDULED: 'agendado',
  ACTIVE: 'em andamento',
  SOLD: 'vendido',
  ENDED_NO_BIDS: 'encerrado sem lances',
  CANCELED: 'cancelado',
};

// Tabela do RF14: o incremento depende só do preço atual.
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

const arredondar = (valor) => Math.round(valor * 100) / 100;

function erro(status, mensagem, codigo) {
  const e = new Error(mensagem);
  e.status = status;
  e.codigo = codigo;
  return e;
}

function incrementoPara(precoAtual) {
  return FAIXAS.find((faixa) => precoAtual <= faixa.ate).incremento;
}

// Primeiro lance pode igualar o preço inicial; depois soma o incremento da faixa.
function proximoMinimo(precoInicial, lanceAtual) {
  if (lanceAtual == null) return arredondar(precoInicial);
  return arredondar(lanceAtual + incrementoPara(lanceAtual));
}

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
  if (Number.isNaN(data.getTime())) throw erro(400, `${campo} inválido`, 'DATA_INVALIDA');
  return data;
}

// Valida a criação e devolve os valores já normalizados.
function validarCriacao({ titulo, descricao, categoria, precoInicial, inicio, fim, agora = new Date() }) {
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

  const categoriaLimpa = (typeof categoria === 'string' ? categoria.trim() : '') || 'Geral';
  if (categoriaLimpa.length > LIMITES.categoriaMax) {
    throw erro(400, 'Categoria muito longa', 'CATEGORIA_INVALIDA');
  }

  const preco = paraNumero(precoInicial, 'O preço inicial');
  if (preco <= 0) throw erro(400, 'O preço inicial precisa ser maior que zero', 'PRECO_INVALIDO');

  const comeco = paraData(inicio, 'O início');
  const termino = paraData(fim, 'O término');

  if (comeco.getTime() < agora.getTime() - LIMITES.toleranciaInicioPassadoMs) {
    throw erro(400, 'O início não pode estar no passado', 'INICIO_NO_PASSADO');
  }
  if (comeco.getTime() > agora.getTime() + LIMITES.antecedenciaMaxSegundos * 1000) {
    throw erro(400, 'O início não pode ser mais de 7 dias à frente', 'INICIO_LONGE_DEMAIS');
  }

  const duracao = (termino.getTime() - comeco.getTime()) / 1000;
  if (duracao < LIMITES.duracaoMinSegundos) {
    throw erro(400, `A duração mínima é de ${LIMITES.duracaoMinSegundos} segundos`, 'DURACAO_CURTA');
  }
  if (duracao > LIMITES.duracaoMaxSegundos) {
    throw erro(400, 'A duração máxima é de 24 horas', 'DURACAO_LONGA');
  }

  return {
    titulo: tituloLimpo,
    descricao:
      typeof descricao === 'string' ? descricao.trim().slice(0, LIMITES.descricaoMax) : '',
    categoria: categoriaLimpa,
    preco,
    comeco,
    termino,
  };
}

// Valida um lance contra o estado do leilão (RF10). `leilao` vem do banco.
function validarLance({ leilao, usuario, valor, agora = new Date() }) {
  if (leilao.status === 'SCHEDULED') {
    throw erro(409, 'O leilão ainda não começou', 'LEILAO_AGENDADO');
  }
  if (leilao.status !== 'ACTIVE' || agora >= leilao.endsAt) {
    throw erro(409, 'Este leilão já foi encerrado', 'LEILAO_ENCERRADO');
  }
  if (leilao.donoId === usuario.id) {
    throw erro(403, 'Você não pode dar lance no seu próprio leilão', 'DONO_DO_LEILAO');
  }
  if (leilao.leaderId && leilao.leaderId === usuario.id) {
    throw erro(409, 'Você já é o maior lance deste leilão', 'JA_E_O_MAIOR');
  }

  const valorLance = paraNumero(valor, 'O lance');
  if (valorLance <= 0) throw erro(400, 'O lance precisa ser maior que zero', 'LANCE_INVALIDO');

  const minimo = proximoMinimo(leilao.precoInicial, leilao.lanceAtual);
  if (valorLance < minimo) {
    throw erro(
      400,
      `O lance mínimo agora é ${reais(minimo)} (incremento de ${reais(
        incrementoPara(leilao.lanceAtual ?? leilao.precoInicial)
      )})`,
      'LANCE_ABAIXO_DO_MINIMO'
    );
  }

  return { valorLance, minimo };
}

// RF05: pelo menos 3 fotos. RF07: guardamos só a URL — o arquivo mora no serviço
// de armazenamento em nuvem, nunca no banco nem no disco da VM.
function validarFotos(fotos) {
  if (!Array.isArray(fotos)) {
    throw erro(400, `Informe pelo menos ${LIMITES.fotosMin} fotos do item`, 'FOTOS_OBRIGATORIAS');
  }

  const urls = fotos.map((url) => (typeof url === 'string' ? url.trim() : '')).filter(Boolean);

  if (urls.length < LIMITES.fotosMin) {
    throw erro(400, `São necessárias pelo menos ${LIMITES.fotosMin} fotos`, 'FOTOS_INSUFICIENTES');
  }
  if (urls.length > LIMITES.fotosMax) {
    throw erro(400, `No máximo ${LIMITES.fotosMax} fotos`, 'FOTOS_DEMAIS');
  }

  for (const url of urls) {
    if (url.length > LIMITES.fotoUrlMax) {
      throw erro(400, 'Endereço de foto muito longo', 'FOTO_LONGA');
    }
    let endereco;
    try {
      endereco = new URL(url);
    } catch {
      throw erro(400, `Foto inválida: ${url}`, 'FOTO_INVALIDA');
    }
    if (!['http:', 'https:'].includes(endereco.protocol)) {
      throw erro(400, `A foto precisa ser um endereço http(s): ${url}`, 'FOTO_INVALIDA');
    }
    const pareceImagem = /\.(jpg|jpeg|png|webp|gif)$/i.test(endereco.pathname);
    const servicoConhecido = /(picsum\.photos|cloudinary\.com|imgur\.com|amazonaws\.com|googleapis\.com|imgbb\.com)/i.test(
      endereco.hostname
    );
    if (!pareceImagem && !servicoConhecido) {
      throw erro(400, `A foto precisa ser uma imagem (jpg, png, webp): ${url}`, 'FOTO_TIPO');
    }
  }

  return urls;
}

// Dica do edital (RF09): identificar o líder sem expor o nome completo.
function mascararNome(nome) {
  if (typeof nome !== 'string' || !nome.trim()) return '—';
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 1) return partes[0];
  return `${partes[0]} ${partes[partes.length - 1][0].toUpperCase()}.`;
}

module.exports = {
  LIMITES,
  ROTULOS,
  FAIXAS,
  reais,
  arredondar,
  erro,
  incrementoPara,
  proximoMinimo,
  paraNumero,
  paraData,
  validarCriacao,
  validarLance,
  validarFotos,
  mascararNome,
};
