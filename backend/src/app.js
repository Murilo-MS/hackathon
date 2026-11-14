const path = require('path');
const express = require('express');
const authRoutes = require('./auth/routes/auth');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', hora: new Date().toISOString() });
});

app.use('/auth', authRoutes);

app.use(express.static(path.join(__dirname, '..', '..', 'front', 'public')));

app.use((erro, req, res, next) => {
  console.error(erro);
  res.status(500).json({ erro: 'Erro interno' });
});

module.exports = app;