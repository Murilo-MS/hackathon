const express = require('express');
const { exigirLogin } = require('../auth/middleware');
const store = require('./store');

const router = express.Router();

const sala = (id) => `leilao:${Number(id)}`;

// Listagem pública (RF20): visitante vê tudo, entrar na sala exige login.
router.get('/', (req, res) => {
  res.json({ leiloes: store.listar(), agora: new Date().toISOString() });
});

// RF05: o criador informa título, descrição, preço inicial, início e término.
// O incremento NÃO é informado: ele é calculado pela tabela do RF14.
router.post('/', exigirLogin, (req, res) => {
  const { titulo, descricao, precoInicial, inicio, fim } = req.body || {};
  const leilao = store.criar({
    titulo,
    descricao,
    precoInicial,
    inicio,
    fim,
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

  // RF11: a sala só vê o novo estado depois que o lance foi gravado de verdade.
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
