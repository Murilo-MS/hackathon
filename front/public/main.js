// Front do leilão: uma página só, sem framework.
// Organização: API -> sessão -> telas -> tempo real -> relógio -> rotas.

const TOKEN_KEY = 'leilao_token';
const $ = (id) => document.getElementById(id);
const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatarDinheiro = (valor) => (valor == null ? '—' : dinheiro.format(valor));

// Os códigos de estado são os mesmos do ENUM do banco (dados/leilao_db.sql).
const ROTULO_STATUS = {
  SCHEDULED: 'agendado',
  ACTIVE: 'em andamento',
  SOLD: 'vendido',
  ENDED_NO_BIDS: 'encerrado sem lances',
  CANCELED: 'cancelado',
};
const CLASSE_STATUS = {
  SCHEDULED: 'agendado',
  ACTIVE: 'aberto',
  SOLD: 'vendido',
  ENDED_NO_BIDS: 'encerrado',
  CANCELED: 'cancelado',
};

let usuario = null;
let deslocamento = 0;          // relógio do servidor - relógio do navegador
let leilaoAberto = null;       // id do leilão em exibição
let leilaoAbertoDados = null;  // último retrato recebido do servidor
let socket = null;
let recarregouAposVirada = false;

// ---------------------------------------------------------------- API
async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const headers = {};
  const token = localStorage.getItem(TOKEN_KEY);
  if (corpo) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const resposta = await fetch(caminho, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

  const texto = await resposta.text();
  let dados = {};
  try {
    dados = texto ? JSON.parse(texto) : {};
  } catch {
    dados = {};
  }

  if (!resposta.ok) {
    if (resposta.status === 401) await encerrarSessao();
    throw Object.assign(new Error(dados.erro || 'Erro inesperado'), { status: resposta.status });
  }
  return dados;
}

function mensagem(texto, tipo = 'ok') {
  const el = $('mensagem');
  el.textContent = texto;
  el.dataset.tipo = tipo;
  clearTimeout(mensagem.timer);
  if (texto) mensagem.timer = setTimeout(() => { el.textContent = ''; el.dataset.tipo = ''; }, 5000);
}

// ---------------------------------------------------------------- sessão
function aplicarSessao(novoUsuario) {
  usuario = novoUsuario;
  $('nome-usuario').textContent = usuario ? usuario.nome : '';
  $('btn-sair').hidden = !usuario;
  $('btn-entrar').hidden = Boolean(usuario);
  $('btn-novo').hidden = !usuario;
  if (!usuario) $('form-leilao').hidden = true;
  atualizarAreaDeLance();
}

async function encerrarSessao() {
  localStorage.removeItem(TOKEN_KEY);
  aplicarSessao(null);
}

$('btn-sair').addEventListener('click', async () => {
  await encerrarSessao();
  mensagem('Você saiu.');
});

$('form-cadastro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { usuario: criado, token } = await api('/auth/register', {
      metodo: 'POST',
      corpo: {
        nome: $('cad-nome').value,
        email: $('cad-email').value,
        senha: $('cad-senha').value,
      },
    });
    localStorage.setItem(TOKEN_KEY, token);
    aplicarSessao(criado);
    mensagem(`Conta criada. Bem-vindo, ${criado.nome}!`);
    location.hash = '#/';
  } catch (erro) {
    mensagem(erro.message, 'erro');
  }
});

$('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { usuario: logado, token } = await api('/auth/login', {
      metodo: 'POST',
      corpo: { email: $('login-email').value, senha: $('login-senha').value },
    });
    localStorage.setItem(TOKEN_KEY, token);
    aplicarSessao(logado);
    mensagem(`Bem-vindo de volta, ${logado.nome}!`);
    location.hash = '#/';
  } catch (erro) {
    mensagem(erro.message, 'erro');
  }
});

// ---------------------------------------------------------------- contadores
// Um leilão agendado conta até o início; um em andamento conta até o término.
function alvoDoContador(leilao) {
  if (leilao.status === 'SCHEDULED') return leilao.startsAt;
  if (leilao.status === 'ACTIVE') return leilao.endsAt;
  return null;
}

function rotuloDoContador(leilao) {
  if (leilao.status === 'SCHEDULED') return 'Começa em';
  if (leilao.status === 'ACTIVE') return 'Termina em';
  return 'Encerrado';
}

function formatarRestante(ms) {
  if (ms <= 0) return 'agora';
  const total = Math.floor(ms / 1000);
  const dias = Math.floor(total / 86400);
  const horas = Math.floor((total % 86400) / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  const dois = (n) => String(n).padStart(2, '0');
  if (dias > 0) return `${dias}d ${dois(horas)}:${dois(minutos)}`;
  if (horas > 0) return `${horas}:${dois(minutos)}:${dois(segundos)}`;
  return `${dois(minutos)}:${dois(segundos)}`;
}

const agoraDoServidor = () => Date.now() + deslocamento;

function atualizarCronometros() {
  const agora = agoraDoServidor();
  for (const elemento of document.querySelectorAll('[data-termina]')) {
    const restante = new Date(elemento.dataset.termina).getTime() - agora;
    elemento.textContent = formatarRestante(restante);
    elemento.dataset.encerrado = restante <= 0 ? 'sim' : 'nao';
  }

  // Rede de segurança: se o evento do Socket.IO não chegar, recarrega o detalhe
  // uma vez quando o contador zera.
  const detalheVisivel = !$('view-detalhe').hidden;
  const alvo = leilaoAbertoDados ? alvoDoContador(leilaoAbertoDados) : null;
  if (detalheVisivel && alvo && !recarregouAposVirada) {
    if (new Date(alvo).getTime() - agora <= 0) {
      recarregouAposVirada = true;
      carregarDetalhe(leilaoAberto);
    }
  }
}

// ---------------------------------------------------------------- lista
async function carregarLista() {
  try {
    const { leiloes, agora } = await api('/auctions');
    deslocamento = new Date(agora).getTime() - Date.now();
    desenharLista(leiloes);
  } catch (erro) {
    mensagem(erro.message, 'erro');
  }
}

function campoNumerico(rotulo, valor, classe, terminaEm) {
  const div = document.createElement('div');
  const span = document.createElement('span');
  span.className = 'rotulo';
  span.textContent = rotulo;
  const forte = document.createElement('strong');
  forte.className = classe;
  forte.textContent = valor;
  if (terminaEm) forte.dataset.termina = terminaEm;
  div.append(span, forte);
  return div;
}

function desenharLista(leiloes) {
  const grade = $('lista-leiloes');
  grade.textContent = '';
  $('lista-vazia').hidden = leiloes.length > 0;

  for (const leilao of leiloes) {
    const cartao = document.createElement('article');
    cartao.className = 'cartao item';

    const titulo = document.createElement('h3');
    titulo.textContent = leilao.titulo; // textContent: nome do usuário nunca vira HTML

    const capa = document.createElement('img');
    capa.className = 'capa';
    capa.alt = 'Foto do item';
    capa.loading = 'lazy';
    if (leilao.fotos && leilao.fotos.length > 0) {
      capa.src = leilao.fotos[0];
    } else {
      capa.hidden = true;
    }

    const descricao = document.createElement('p');
    descricao.className = 'descricao';
    descricao.textContent = leilao.descricao || 'Sem descrição';

    const numeros = document.createElement('div');
    numeros.className = 'numeros';
    numeros.append(
      campoNumerico('Lance atual', formatarDinheiro(leilao.lanceAtual), 'grande'),
      campoNumerico('Lance mínimo', formatarDinheiro(leilao.proximoMinimo), 'medio'),
      campoNumerico(rotuloDoContador(leilao), '—', 'medio', alvoDoContador(leilao))
    );

    const rodape = document.createElement('div');
    rodape.className = 'rodape-item';

    const etiqueta = document.createElement('span');
    etiqueta.className = `etiqueta ${CLASSE_STATUS[leilao.status] || ''}`;
    etiqueta.textContent = ROTULO_STATUS[leilao.status] || leilao.status;

    const link = document.createElement('a');
    link.className = 'botao';
    link.href = `#/leilao/${leilao.id}`;
    link.textContent = leilao.status === 'ACTIVE' ? 'Entrar na sala' : 'Abrir';

    rodape.append(etiqueta, link);
    cartao.append(titulo, capa, descricao, numeros, rodape);
    grade.append(cartao);
  }
  atualizarCronometros();
}

// ---------------------------------------------------------------- criar leilão
function doisDigitos(n) {
  return String(n).padStart(2, '0');
}

// O input datetime-local não tem fuso: o valor é lido como hora local do navegador.
function paraInputData(data) {
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}T${doisDigitos(data.getHours())}:${doisDigitos(data.getMinutes())}`;
}

function preencherDatasPadrao() {
  if (!$('leilao-inicio').value) {
    $('leilao-inicio').value = paraInputData(new Date(Date.now() + 60 * 1000));
  }
  if (!$('leilao-fim').value) {
    $('leilao-fim').value = paraInputData(new Date(Date.now() + 4 * 60 * 1000));
  }
  if (!$('leilao-fotos').value) {
    // Fotos de demonstração (RF05). O servidor aceita qualquer URL http(s) de imagem.
    $('leilao-fotos').value = [
      'https://picsum.photos/seed/leilao-1/800/600',
      'https://picsum.photos/seed/leilao-2/800/600',
      'https://picsum.photos/seed/leilao-3/800/600',
    ].join('\n');
  }
}

$('btn-novo').addEventListener('click', () => {
  $('form-leilao').hidden = !$('form-leilao').hidden;
  if (!$('form-leilao').hidden) preencherDatasPadrao();
});

$('btn-cancelar').addEventListener('click', () => {
  $('form-leilao').hidden = true;
});

$('form-leilao').addEventListener('submit', async (evento) => {
  evento.preventDefault();

  const inicio = new Date($('leilao-inicio').value);
  const fim = new Date($('leilao-fim').value);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
    return mensagem('Informe o início e o término do leilão.', 'erro');
  }

  try {
    const { leilao } = await api('/auctions', {
      metodo: 'POST',
      corpo: {
        titulo: $('leilao-titulo').value,
        descricao: $('leilao-descricao').value,
        categoria: $('leilao-categoria').value,
        fotos: $('leilao-fotos').value
          .split('\n')
          .map((linha) => linha.trim())
          .filter(Boolean),
        precoInicial: Number($('leilao-preco').value),
        // toISOString converte a hora local do navegador para UTC,
        // que é o que o servidor entende sem ambiguidade de fuso.
        inicio: inicio.toISOString(),
        fim: fim.toISOString(),
      },
    });
    $('form-leilao').reset();
    $('form-leilao').hidden = true;
    mensagem('Leilão publicado.');
    location.hash = `#/leilao/${leilao.id}`;
  } catch (erro) {
    mensagem(erro.message, 'erro');
  }
});

// ---------------------------------------------------------------- detalhe
async function carregarDetalhe(id) {
  try {
    const { leilao, historico } = await api(`/auctions/${id}`);
    leilaoAberto = leilao.id;
    leilaoAbertoDados = leilao;
    recarregouAposVirada = false;
    deslocamento = new Date(leilao.agora).getTime() - Date.now();

    $('det-titulo').textContent = leilao.titulo;
    $('det-descricao').textContent = leilao.descricao || 'Sem descrição';
    $('det-dono').textContent = `Publicado por ${leilao.donoNome} · Categoria: ${leilao.categoria || 'Geral'}`;
    desenharGaleria(leilao.fotos);
    $('det-total').textContent = String(leilao.totalLances ?? 0);
    // RF08: o botão só aparece para o dono, sem lances, em leilão não finalizado
    const podeCancelar =
      Boolean(usuario) &&
      usuario.id === leilao.donoId &&
      (leilao.status === 'SCHEDULED' || leilao.status === 'ACTIVE') &&
      leilao.totalLances === 0;
    $('btn-cancelar-leilao').hidden = !podeCancelar;
    $('det-lance').textContent = formatarDinheiro(leilao.lanceAtual);
    $('det-minimo').textContent = formatarDinheiro(leilao.proximoMinimo);
    $('det-status').textContent = ROTULO_STATUS[leilao.status] || leilao.status;
    $('det-status').className = `etiqueta ${CLASSE_STATUS[leilao.status] || ''}`;

    const alvo = alvoDoContador(leilao);
    $('det-tempo-rotulo').textContent = rotuloDoContador(leilao);
    if (alvo) {
      $('det-tempo').dataset.termina = alvo;
    } else {
      delete $('det-tempo').dataset.termina;
      $('det-tempo').textContent = '—';
    }

    $('lance-valor').min = String(leilao.proximoMinimo);
    $('lance-valor').value = leilao.proximoMinimo.toFixed(2);

    desenharHistorico(historico);
    atualizarAreaDeLance();
    atualizarCronometros();

    if (socket) socket.emit('join_auction', leilao.id);
  } catch (erro) {
    mensagem(erro.message, 'erro');
    location.hash = '#/';
  }
}

function desenharGaleria(fotos = []) {
  const galeria = $('det-galeria');
  galeria.textContent = '';
  for (const url of fotos) {
    const img = document.createElement('img');
    // O servidor já validou que é http(s) de imagem; aqui só exibimos
    img.src = url;
    img.alt = 'Foto do item';
    img.loading = 'lazy';
    galeria.append(img);
  }
  galeria.hidden = fotos.length === 0;
}

function desenharHistorico(historico) {
  const lista = $('lista-lances');
  lista.textContent = '';

  if (!historico.length) {
    const vazio = document.createElement('li');
    vazio.className = 'vazio';
    vazio.textContent = 'Nenhum lance ainda.';
    lista.append(vazio);
    return;
  }
  for (const lance of historico) lista.append(itemDoHistorico(lance));
}

function itemDoHistorico({ usuarioNome, valor, criadoEm }) {
  const item = document.createElement('li');

  const nome = document.createElement('strong');
  nome.textContent = usuarioNome;

  const quantia = document.createElement('span');
  quantia.className = 'valor';
  quantia.textContent = formatarDinheiro(valor);

  const hora = document.createElement('time');
  hora.dateTime = criadoEm;
  hora.textContent = new Date(criadoEm).toLocaleTimeString('pt-BR');

  item.append(nome, quantia, hora);
  return item;
}

function atualizarAreaDeLance() {
  if (!leilaoAbertoDados) return;

  const leilao = leilaoAbertoDados;
  const ehDono = Boolean(usuario) && usuario.id === leilao.donoId;
  const podeLancar = Boolean(usuario) && leilao.status === 'ACTIVE' && !ehDono;

  $('form-lance').hidden = !podeLancar;

  if (!usuario) {
    $('det-aviso').textContent = 'Entre na sua conta para dar lance.';
  } else if (ehDono) {
    $('det-aviso').textContent = 'Você publicou este item, então não pode dar lance nele.';
  } else if (leilao.status === 'SCHEDULED') {
    $('det-aviso').textContent = 'Este leilão está agendado: os lances abrem no horário de início.';
  } else if (leilao.status === 'SOLD') {
    $('det-aviso').textContent = `Leilão encerrado. Vendido para ${leilao.vencedor?.usuarioNome} por ${formatarDinheiro(leilao.vencedor?.valor)}.`;
  } else if (leilao.status === 'ENDED_NO_BIDS') {
    $('det-aviso').textContent = 'Leilão encerrado sem lances.';
  } else if (leilao.status === 'CANCELED') {
    $('det-aviso').textContent = 'Leilão cancelado pelo dono.';
  } else {
    $('det-aviso').textContent = `Incremento mínimo nesta faixa: ${formatarDinheiro(leilao.incrementoAtual)}.`;
  }
}

$('btn-minimo').addEventListener('click', () => {
  if (leilaoAbertoDados) $('lance-valor').value = leilaoAbertoDados.proximoMinimo.toFixed(2);
});

// RF08: cancelar o próprio leilão (só sem lances e antes de finalizar)
$('btn-cancelar-leilao').addEventListener('click', async () => {
  if (!leilaoAberto) return;
  if (!confirm('Cancelar este leilão? Ele fica registrado como cancelado.')) return;
  try {
    await api(`/auctions/${leilaoAberto}/cancelar`, { metodo: 'POST' });
    await carregarDetalhe(leilaoAberto);
    mensagem('Leilão cancelado.');
  } catch (erro) {
    mensagem(erro.message, 'erro');
    await carregarDetalhe(leilaoAberto);
  }
});

$('form-lance').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    await api(`/auctions/${leilaoAberto}/bids`, {
      metodo: 'POST',
      corpo: { valor: Number($('lance-valor').value) },
    });
    await carregarDetalhe(leilaoAberto);
    mensagem('Lance registrado!');
  } catch (erro) {
    mensagem(erro.message, 'erro');
    if (erro.status === 400 || erro.status === 409) await carregarDetalhe(leilaoAberto);
  }
});

// ---------------------------------------------------------------- tempo real
function conectarSocket() {
  if (typeof io !== 'function') {
    mensagem('Tempo real indisponível: cliente do Socket.IO não carregou.', 'erro');
    return;
  }

  socket = io();

  socket.on('connect', () => {
    if (leilaoAberto) socket.emit('join_auction', leilaoAberto);
  });

  socket.on('new_bid', (dados) => {
    if (dados.leilaoId !== leilaoAberto) return;

    if (dados.totalLances != null) $('det-total').textContent = String(dados.totalLances);
    $('det-lance').textContent = formatarDinheiro(dados.lanceAtual);
    $('det-minimo').textContent = formatarDinheiro(dados.proximoMinimo);
    $('lance-valor').min = String(dados.proximoMinimo);
    if (Number($('lance-valor').value) < dados.proximoMinimo) {
      $('lance-valor').value = dados.proximoMinimo.toFixed(2);
    }

    if (leilaoAbertoDados) {
      leilaoAbertoDados.maiorLance = {
        valor: dados.lanceAtual,
        usuarioNome: dados.usuarioNome,
        criadoEm: dados.criadoEm,
      };
      leilaoAbertoDados.lanceAtual = dados.lanceAtual;
      leilaoAbertoDados.proximoMinimo = dados.proximoMinimo;
    }

    const lista = $('lista-lances');
    lista.querySelector('.vazio')?.remove();
    lista.prepend(itemDoHistorico(dados));

    mensagem(`${dados.usuarioNome} deu lance de ${formatarDinheiro(dados.lanceAtual)}`);
  });

  // O leilão agendado abriu no horário: a tela precisa sair de "agendado"
  socket.on('auction_started', async (dados) => {
    if (dados.leilaoId !== leilaoAberto) return;
    await carregarDetalhe(leilaoAberto);
    mensagem('O leilão começou. Os lances estão abertos.');
  });

  socket.on('auction_ended', async (dados) => {
    if (dados.leilaoId !== leilaoAberto) return;
    await carregarDetalhe(leilaoAberto);
    mensagem(
      dados.vencedor
        ? `Leilão encerrado. Vendido para ${dados.vencedor.usuarioNome}.`
        : 'Leilão encerrado sem lances.'
    );
  });
}

// ---------------------------------------------------------------- rotas
function mostrarView(nome) {
  for (const view of ['lista', 'detalhe', 'auth']) {
    $(`view-${view}`).hidden = view !== nome;
  }
}

async function rotear() {
  const hash = location.hash || '#/';

  if (hash.startsWith('#/entrar')) {
    if (usuario) { location.hash = '#/'; return; }
    mostrarView('auth');
    return;
  }

  // Os ids agora são UUID (vêm do PostgreSQL), não números
  const casaLeilao = hash.match(/^#\/leilao\/([0-9a-f-]{36})$/i);
  if (casaLeilao) {
    // RF04: a listagem é pública, mas entrar na sala exige login
    if (!usuario) {
      mensagem('Entre na sua conta para entrar na sala do leilão.', 'erro');
      location.hash = '#/entrar';
      return;
    }
    mostrarView('detalhe');
    await carregarDetalhe(casaLeilao[1]);
    return;
  }

  if (leilaoAberto && socket) socket.emit('leave_auction', leilaoAberto);
  leilaoAberto = null;
  leilaoAbertoDados = null;
  mostrarView('lista');
  await carregarLista();
}

window.addEventListener('hashchange', rotear);

// ---------------------------------------------------------------- início
(async function iniciar() {
  conectarSocket();

  if (localStorage.getItem(TOKEN_KEY)) {
    try {
      const { usuario: recuperado } = await api('/auth/me');
      aplicarSessao(recuperado);
    } catch {
      await encerrarSessao();
    }
  }

  preencherDatasPadrao();
  await rotear();

  setInterval(atualizarCronometros, 1000);
  setInterval(() => {
    if (!$('view-lista').hidden) carregarLista();
  }, 8000);
})();
