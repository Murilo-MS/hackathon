const path = require('path');
const express = require('express');
const authRoutes = require('./auth/routes/auth');
const auctionsRoutes = require('./auctions/routes');
const fotosRoutes = require('./fotos/routes');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', hora: new Date().toISOString() });
});

app.use('/auth', authRoutes);
app.use('/auctions', auctionsRoutes);
app.use('/fotos', fotosRoutes);

// No modo local de armazenamento (sem S3), as fotos são servidas daqui
app.use('/uploads', express.static(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads')));

app.use(express.static(path.join(__dirname, '..', '..', 'front', 'public')));

// Qualquer coisa que não seja arquivo estático nem rota conhecida cai aqui.
// Sem isso, o Express devolve uma página HTML de erro e o front quebra ao fazer JSON.parse.
app.use((req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada', caminho: req.originalUrl });
});

// Middleware de erro: os 4 parâmetros são obrigatórios para o Express reconhecê-lo.
// Antes, TODO erro virava 500 "Erro interno", inclusive JSON malformado enviado pelo cliente.
app.use((erro, req, res, next) => {
  const status = erro.status || erro.statusCode || 500;
  const mensagem =
    status >= 500
      ? 'Erro interno'
      : erro.type === 'entity.parse.failed'
        ? 'JSON inválido no corpo da requisição'
        : erro.type === 'entity.too.large'
          ? 'Corpo da requisição muito grande'
          : erro.message;

  if (status >= 500) {
    // Erro nosso: guarda a pilha no log do servidor e não expõe detalhe ao cliente
    console.error(erro);
  }
  res.status(status).json({ erro: mensagem });
});

module.exports = app;
