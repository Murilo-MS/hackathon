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


const relogio = setInterval(() => {
  for (const leilao of store.encerrarVencidos()) {
    io.to(`leilao:${leilao.id}`).emit('auction_ended', {
      leilaoId: leilao.id,
      vencedor: leilao.vencedor,
    });
  }
}, 1000);
relogio.unref(); 

server.listen(config.port, () => {
  console.log(`Servidor rodando na porta ${config.port}`);
});
