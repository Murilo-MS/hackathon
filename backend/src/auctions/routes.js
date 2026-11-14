const express = require('express');
const { exigirLogin } = require('../auth/middleware');
const store = require('./store');

const router = express.Router();

// Uma sala do Socket.IO por leilão: quem está vendo o leilão 7 recebe só os lances do 7
const sala = (id) => `leilao:${Number(id)}`;

// Listagem pública: visitante pode ver os leilões sem estar logado
router.get('/', (req, res) => {
  res.json({ leiloes: store.listar(), agora: new Date().toISOString() });
});

router.post('/', exigirLogin, (req, res) => {
  const { titulo, descricao, precoInicial, incrementoMinimo, duracaoMinutos } = req.body || {};
  const leilao = store.criar({
    titulo,
    descricao,
    precoInicial,
    incrementoMinimo,
    duracaoMinutos,
    dono: req.usuario,
  });
  res.status(201).json({ leilao: store.paraApi(leilao) });
});

router.get('/:id', (req, res) => {
  const leilao = store.buscar(req.params.id);
  res.json({ leilao: store.paraApi(leilao), historico: store.historico(leilao.id) });
});

router.get('/:id/bids', (req, res) => {
  const leilao = store.buscar(req.params.id);
  res.json({ historico: store.historico(leilao.id) });
});

router.post('/:id/bids', exigirLogin, (req, res) => {
  const { lance, leilao } = store.darLance({
    leilaoId: req.params.id,
    usuario: req.usuario,
    valor: (req.body || {}).valor,
  });

  // Só depois de gravar o lance os clientes da sala são avisados.
  // Se emitíssemos antes, alguém poderia ver um lance que acabou recusado.
  req.app.get('io').to(sala(leilao.id)).emit('new_bid', {
    leilaoId: leilao.id,
    lanceAtual: lance.valor,
    proximoMinimo: store.proximoMinimo(leilao),
    usuarioNome: lance.usuarioNome,
    criadoEm: lance.criadoEm.toISOString(),
  });

  res.status(201).json({
    lance: {
      id: lance.id,
      valor: lance.valor,
      usuarioNome: lance.usuarioNome,
      criadoEm: lance.criadoEm.toISOString(),
    },
    leilao: store.paraApi(leilao),
  });
});

module.exports = router;
