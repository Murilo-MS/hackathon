const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const db = require('./db');
const app = require('./app');
const store = require('./auctions/store');

const server = http.createServer(app);

const io = new Server(server);
app.set('io', io);

// O id do leilão é UUID (string). A sala usa o mesmo texto que o cliente envia.
const sala = (id) => `leilao:${id}`;

io.on('connection', (socket) => {
  socket.on('join_auction', (id) => {
    for (const existente of socket.rooms) {
      if (existente.startsWith('leilao:')) socket.leave(existente);
    }
    socket.join(sala(id));
  });

  socket.on('leave_auction', (id) => {
    socket.leave(sala(id));
  });
});

// Relógio do servidor (RF16/RF17/RF18): aplica as transições no banco.
// Como o estado vive no PostgreSQL, reiniciar o servidor não perde nada: o
// primeiro tique depois do boot fecha o que venceu enquanto estava fora.
async function tique() {
  try {
    const { abertos, encerrados } = await store.atualizarEstados();

    for (const id of abertos) {
      io.to(sala(id)).emit('auction_started', { leilaoId: id });
    }

    for (const { id } of encerrados) {
      const leilao = await store.buscar(id).catch(() => null);
      io.to(sala(id)).emit('auction_ended', {
        leilaoId: id,
        status: leilao?.status ?? null,
        vencedor: leilao?.vencedor ?? null,
      });
    }
  } catch (erro) {
    console.error('Relógio do leilão falhou:', erro.message);
  }
}

let relogio = null;

async function iniciar() {
  try {
    await db.verificarConexao();
    console.log('PostgreSQL conectado');
    // Recupera o que passou enquanto o processo estava parado (RF18)
    await tique();
  } catch (erro) {
    console.error('Não foi possível falar com o PostgreSQL:', erro.message);
    console.error('Confira DATABASE_URL no .env e se o banco está de pé (veja DEPLOY.md).');
    process.exit(1);
  }

  relogio = setInterval(tique, 1000);
  if (relogio.unref) relogio.unref();

  server.listen(config.port, () => {
    console.log(`Servidor rodando na porta ${config.port}`);
  });
}

async function encerrar(sinal) {
  console.log(`\nRecebido ${sinal}, encerrando com calma...`);
  if (relogio) clearInterval(relogio);
  server.close();
  await db.fecharPool().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));

iniciar();
