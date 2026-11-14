// Front do leilão: uma página só, sem framework.
// Organização: API -> sessão -> telas (lista, detalhe, entrar) -> tempo real -> relógio -> rotas.

const TOKEN_KEY = 'leilao_token';
const $ = (id) => document.getElementById(id);
const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatarDinheiro = (valor) => (valor == null ? '—' : dinheiro.format(valor));

let usuario = null;
// Diferença entre o relógio do servidor e o do navegador, em milissegundos.
// Sem isso, um computador com a hora errada mostraria o cronômetro errado.
let deslocamento = 0;
let leilaoAberto = null;       // id do leilão em exibição no detalhe
let leilaoAbertoDados = null;  // último retrato recebido do servidor
let socket = null;
let recarregouAposEncerrar = false;

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
    titulo.textContent = leilao.titulo; // textContent, nunca innerHTML com dado do usuário

    const descricao = document.createElement('p');
    descricao.className = 'descricao';
    descricao.textContent = leilao.descricao || 'Sem descrição';

    const numeros = document.createElement('div');
    numeros.className = 'numeros';
    numeros.append(
      campoNumerico('Lance atual', formatarDinheiro(leilao.maiorLance?.valor), 'grande'),
      campoNumerico('Próximo mínimo', formatarDinheiro(leilao.proximoMinimo), 'medio'),
      campoNumerico('Termina em', '—', 'medio', leilao.terminaEm)
    );

    const rodape = document.createElement('div');
    rodape.className = 'rodape-item';

    const etiqueta = document.createElement('span');
    etiqueta.className = `etiqueta ${leilao.status}`;
    etiqueta.textContent = leilao.status;

    const link = document.createElement('a');
    link.className = 'botao';
    link.href = `#/leilao/${leilao.id}`;
    link.textContent = 'Abrir';

    rodape.append(etiqueta, link);
    cartao.append(titulo, descricao, numeros, rodape);
    grade.append(cartao);
  }
  atualizarCronometros();
}

// ---------------------------------------------------------------- criar leilão
$('btn-novo').addEventListener('click', () => {
  $('form-leilao').hidden = !$('form-leilao').hidden;
});

$('btn-cancelar').addEventListener('click', () => {
  $('form-leilao').hidden = true;
});

$('form-leilao').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { leilao } = await api('/auctions', {
      metodo: 'POST',
      corpo: {
        titulo: $('leilao-titulo').value,
        descricao: $('leilao-descricao').value,
        precoInicial: Number($('leilao-preco').value),
        incrementoMinimo: Number($('leilao-incremento').value),
        duracaoMinutos: Number($('leilao-duracao').value),
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
    recarregouAposEncerrar = false;
    deslocamento = new Date(leilao.agora).getTime() - Date.now();

    $('det-titulo').textContent = leilao.titulo;
    $('det-descricao').textContent = leilao.descricao || 'Sem descrição';
    $('det-dono').textContent = `Publicado por ${leilao.donoNome}`;
    $('det-lance').textContent = formatarDinheiro(leilao.maiorLance?.valor);
    $('det-minimo').textContent = formatarDinheiro(leilao.proximoMinimo);
    $('det-status').textContent = leilao.status;
    $('det-status').className = `etiqueta ${leilao.status}`;
    $('det-tempo').dataset.termina = leilao.terminaEm;
    $('lance-valor').min = String(leilao.proximoMinimo);
    $('lance-valor').value = leilao.proximoMinimo.toFixed(2);

    desenharHistorico(historico);
    atualizarAreaDeLance();
    atualizarCronometros();

    // Avisa o servidor que esta aba está olhando este leilão
    if (socket) socket.emit('join_auction', leilao.id);
  } catch (erro) {
    mensagem(erro.message, 'erro');
    location.hash = '#/';
  }
}

function desenharHistorico(historico) {
  const lista = $('lista-lances');
  lista.textContent = '';

  if (!historico.length) {
    const vazio = document.createElement('li');
    vazio.className = 'vazio';
    vazio.textContent = 'Nenhum lance ainda. Seja o primeiro.';
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

  const encerrado = leilaoAbertoDados.status !== 'aberto';
  const ehDono = Boolean(usuario) && usuario.id === leilaoAbertoDados.donoId;
  const podeLancar = Boolean(usuario) && !encerrado && !ehDono;

  $('form-lance').hidden = !podeLancar;

  if (!usuario) {
    $('det-aviso').textContent = 'Entre na sua conta para dar lance.';
  } else if (ehDono) {
    $('det-aviso').textContent = 'Você publicou este item, então não pode dar lance nele.';
  } else if (encerrado) {
    const vencedor = leilaoAbertoDados.vencedor;
    $('det-aviso').textContent = vencedor
      ? `Leilão encerrado. Vencedor: ${vencedor.usuarioNome} com ${formatarDinheiro(vencedor.valor)}.`
      : 'Leilão encerrado sem lances.';
  } else {
    $('det-aviso').textContent = '';
  }
}

$('btn-minimo').addEventListener('click', () => {
  if (leilaoAbertoDados) $('lance-valor').value = leilaoAbertoDados.proximoMinimo.toFixed(2);
});

$('form-lance').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    await api(`/auctions/${leilaoAberto}/bids`, {
      metodo: 'POST',
      corpo: { valor: Number($('lance-valor').value) },
    });
    // O Socket.IO avisa todos os clientes da sala; recarregar aqui garante que a
    // tela fique certa mesmo se o evento atrasar ou a conexão cair.
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

  // Chegou lance novo de outra pessoa (ou o meu, confirmado pelo servidor)
  socket.on('new_bid', (dados) => {
    if (dados.leilaoId !== leilaoAberto) return;

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
      leilaoAbertoDados.proximoMinimo = dados.proximoMinimo;
    }

    const lista = $('lista-lances');
    lista.querySelector('.vazio')?.remove();
    lista.prepend(itemDoHistorico(dados));

    mensagem(`${dados.usuarioNome} deu lance de ${formatarDinheiro(dados.lanceAtual)}`);
  });

  socket.on('auction_ended', async (dados) => {
    if (dados.leilaoId !== leilaoAberto) return;
    await carregarDetalhe(leilaoAberto);
    mensagem(
      dados.vencedor
        ? `Leilão encerrado. Vencedor: ${dados.vencedor.usuarioNome}.`
        : 'Leilão encerrado sem lances.'
    );
  });
}

// ---------------------------------------------------------------- relógio
const agoraDoServidor = () => Date.now() + deslocamento;

function formatarRestante(ms) {
  if (ms <= 0) return 'Encerrado';
  const total = Math.floor(ms / 1000);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const segundos = total % 60;
  const dois = (n) => String(n).padStart(2, '0');
  return horas > 0 ? `${horas}:${dois(minutos)}:${dois(segundos)}` : `${dois(minutos)}:${dois(segundos)}`;
}

function atualizarCronometros() {
  const agora = agoraDoServidor();
  for (const elemento of document.querySelectorAll('[data-termina]')) {
    const restante = new Date(elemento.dataset.termina).getTime() - agora;
    elemento.textContent = formatarRestante(restante);
    elemento.dataset.encerrado = restante <= 0 ? 'sim' : 'nao';
  }

  // Rede de segurança: se o evento do Socket.IO não chegar, recarrega o detalhe
  // uma vez quando o cronômetro zera.
  const detalheVisivel = !$('view-detalhe').hidden;
  if (detalheVisivel && leilaoAbertoDados?.status === 'aberto') {
    const restante = new Date(leilaoAbertoDados.terminaEm).getTime() - agoraDoServidor();
    if (restante <= 0 && !recarregouAposEncerrar) {
      recarregouAposEncerrar = true;
      carregarDetalhe(leilaoAberto);
    }
  }
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

  const casaLeilao = hash.match(/^#\/leilao\/(\d+)$/);
  if (casaLeilao) {
    mostrarView('detalhe');
    await carregarDetalhe(Number(casaLeilao[1]));
    return;
  }

  // Saiu do detalhe: avisa o servidor para parar de mandar evento deste leilão
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

  await rotear();

  setInterval(atualizarCronometros, 1000);
  // Na lista não há evento de "leilão criado"; um refresco lento resolve sem websocket extra
  setInterval(() => {
    if (!$('view-lista').hidden) carregarLista();
  }, 8000);
})();
