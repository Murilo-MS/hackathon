const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const app = require('./app');
const store = require('./auctions/store');

const server = http.createServer(app);

const io = new Server(server);
app.set('io', io);

io.on('connection', (socket) => {
  socket.on('join_auction', (id) => {
    for (const sala of socket.rooms) {
      if (sala.startsWith('leilao:')) socket.leave(sala);
    }
    socket.join(`leilao:${Number(id)}`);
  });

  socket.on('leave_auction', (id) => {
    socket.leave(`leilao:${Number(id)}`);
  });
});

// Relógio do servidor (RF16/RF17): a cada segundo aplica as transições de estado.
// Um leilão agendado abre sozinho no horário, e o que terminou vira vendido ou
// encerrado sem lances. Isso roda no servidor justamente para não depender de
// nenhum navegador estar aberto.
const relogio = setInterval(() => {
  const { abertos, encerrados } = store.atualizarEstados();

  for (const leilao of abertos) {
    io.to(`leilao:${leilao.id}`).emit('auction_started', { leilaoId: leilao.id });
  }
  for (const leilao of encerrados) {
    io.to(`leilao:${leilao.id}`).emit('auction_ended', {
      leilaoId: leilao.id,
      status: leilao.status,
      vencedor: leilao.vencedor,
    });
  }
}, 1000);
relogio.unref();

server.listen(config.port, () => {
  console.log(`Servidor rodando na porta ${config.port}`);
});
