const TOKEN_KEY = 'leilao_token';
const $ = (id) => document.getElementById(id);

// Função única para falar com a API: já envia o token da sessão
async function api(caminho, { metodo = 'GET', corpo } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;

  const resposta = await fetch(caminho, {
    method: metodo,
    headers,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    throw Object.assign(new Error(dados.erro || 'Erro inesperado'), { status: resposta.status });
  }
  return dados;
}

function mostrarMensagem(texto, erro = false) {
  $('mensagem').textContent = texto;
  $('mensagem').className = erro ? 'erro' : 'ok';
}

function mostrarSessao(usuario) {
  $('area-visitante').hidden = Boolean(usuario);
  $('area-logado').hidden = !usuario;
  if (usuario) $('nome-usuario').textContent = usuario.nome;
}

$('form-cadastro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { usuario, token } = await api('/auth/register', {
      metodo: 'POST',
      corpo: { nome: $('cad-nome').value, email: $('cad-email').value, senha: $('cad-senha').value },
    });
    localStorage.setItem(TOKEN_KEY, token);
    mostrarSessao(usuario);
    mostrarMensagem('Conta criada!');
  } catch (erro) {
    mostrarMensagem(erro.message, true);
  }
});

$('form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  try {
    const { usuario, token } = await api('/auth/login', {
      metodo: 'POST',
      corpo: { email: $('login-email').value, senha: $('login-senha').value },
    });
    localStorage.setItem(TOKEN_KEY, token);
    mostrarSessao(usuario);
    mostrarMensagem('Login feito!');
  } catch (erro) {
    mostrarMensagem(erro.message, true);
  }
});

$('btn-sair').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  mostrarSessao(null);
  mostrarMensagem('Você saiu.');
});

(async function iniciar() {
  if (!localStorage.getItem(TOKEN_KEY)) return mostrarSessao(null);
  try {
    const { usuario } = await api('/auth/me');
    mostrarSessao(usuario);
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    mostrarSessao(null);
  }
})();