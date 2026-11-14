const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const app = require('./app');
const store = require('./auctions/store');

const server = http.createServer(app);

// O Socket.IO usa o mesmo servidor HTTP; as rotas pegam a instância com req.app.get('io')
const io = new Server(server);
app.set('io', io);

io.on('connection', (socket) => {
  // O cliente avisa qual leilão está vendo; ele entra na sala daquele leilão
  socket.on('join_auction', (id) => {
    for (const sala of socket.rooms) {
      if (sala.startsWith('leilao:')) socket.leave(sala); // não fica em duas ao mesmo tempo
    }
    socket.join(`leilao:${Number(id)}`);
  });

  socket.on('leave_auction', (id) => {
    socket.leave(`leilao:${Number(id)}`);
  });
});

// Relógio do servidor: a cada segundo fecha os leilões vencidos e avisa a sala.
// Com muitos leilões isso vira uma consulta por segundo no banco; dá para trocar
// por um setTimeout calculado para o próximo encerramento.
const relogio = setInterval(() => {
  for (const leilao of store.encerrarVencidos()) {
    io.to(`leilao:${leilao.id}`).emit('auction_ended', {
      leilaoId: leilao.id,
      vencedor: leilao.vencedor,
    });
  }
}, 1000);
relogio.unref(); // não impede o processo de encerrar (útil em testes)

server.listen(config.port, () => {
  console.log(`Servidor rodando na porta ${config.port}`);
});
