const express = require('express');
const { exigirLogin } = require('../auth/middleware');
const store = require('./store');

const router = express.Router();

// A sala usa o id como texto (UUID), igual ao que o cliente envia no join
const sala = (id) => `leilao:${id}`;

// Listagem pública (RF20): visitante vê tudo, entrar na sala exige login (RF04).
router.get('/', async (req, res) => {
  res.json({ leiloes: await store.listar(), agora: new Date().toISOString() });
});

// RF05: título, descrição, categoria, fotos, preço inicial, início e término.
// O incremento NÃO é informado: vem da tabela do RF14.
router.post('/', exigirLogin, async (req, res) => {
  const { titulo, descricao, categoria, fotos, precoInicial, inicio, fim } = req.body || {};
  const leilao = await store.criar({
    titulo,
    descricao,
    categoria,
    fotos,
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

// RF08: cancelamento pelo comitente
router.post('/:id/cancelar', exigirLogin, async (req, res) => {
  const leilao = await store.cancelar({ leilaoId: req.params.id, usuario: req.usuario });
  req.app.get('io').to(sala(leilao.id)).emit('auction_ended', {
    leilaoId: leilao.id,
    status: leilao.status,
    vencedor: null,
  });
  res.json({ leilao });
});

router.post('/:id/bids', exigirLogin, async (req, res) => {
  const corpo = req.body || {};
  const { lance, leilao, repetido } = await store.darLance({
    leilaoId: req.params.id,
    usuario: req.usuario,
    valor: corpo.valor,
    // RF12: a mesma chave, enviada de novo, não cria um segundo lance
    chaveIdempotencia: req.get('Idempotency-Key') || corpo.idempotencyKey,
  });

  if (!repetido) {
    // RF11: a sala só vê o novo estado depois do COMMIT
    req.app.get('io').to(sala(leilao.id)).emit('new_bid', {
      leilaoId: leilao.id,
      lanceAtual: lance.valor,
      proximoMinimo: leilao.proximoMinimo,
      totalLances: leilao.totalLances,
      usuarioNome: lance.usuarioNome,
      criadoEm: lance.criadoEm,
    });
  }

  // 201 para lance novo, 200 quando é reenvio do mesmo lance (RF12)
  res.status(repetido ? 200 : 201).json({ lance, leilao, repetido: Boolean(repetido) });
});

module.exports = router;
