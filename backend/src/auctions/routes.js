const express = require('express');
const { exigirLogin } = require('../auth/middleware');
const store = require('./store');

const router = express.Router();

// A sala usa o id como texto (UUID), igual ao que o cliente envia no join
const sala = (id) => `leilao:${id}`;

// Listagem pública (RF20): visitante vê tudo, entrar na sala exige login.
router.get('/', async (req, res) => {
  res.json({ leiloes: await store.listar(), agora: new Date().toISOString() });
});

// RF05: o criador informa título, descrição, categoria, preço inicial, início e
// término. O incremento NÃO é informado: vem da tabela do RF14.
router.post('/', exigirLogin, async (req, res) => {
  const { titulo, descricao, categoria, precoInicial, inicio, fim } = req.body || {};
  const leilao = await store.criar({
    titulo,
    descricao,
    categoria,
    precoInicial,
    inicio,
    fim,
    dono: req.usuario,
  });
  res.status(201).json({ leilao });
});

router.get('/:id', async (req, res) => {
  const leilao = await store.buscar(req.params.id);
  res.json({ leilao, historico: await store.historico(leilao.id) });
});

router.get('/:id/bids', async (req, res) => {
  const leilao = await store.buscar(req.params.id);
  res.json({ historico: await store.historico(leilao.id) });
});

router.post('/:id/bids', exigirLogin, async (req, res) => {
  const corpo = req.body || {};
  const { lance, leilao } = await store.darLance({
    leilaoId: req.params.id,
    usuario: req.usuario,
    valor: corpo.valor,
    // RF12: a mesma chave, enviada de novo, não cria um segundo lance
    chaveIdempotencia: req.get('Idempotency-Key') || corpo.idempotencyKey,
  });

  // RF11: a sala só vê o novo estado depois que o lance foi gravado (COMMIT feito)
  req.app.get('io').to(sala(leilao.id)).emit('new_bid', {
    leilaoId: leilao.id,
    lanceAtual: lance.valor,
    proximoMinimo: leilao.proximoMinimo,
    usuarioNome: lance.usuarioNome,
    criadoEm: lance.criadoEm,
  });

  res.status(201).json({ lance, leilao });
});

module.exports = router;
