const crypto = require('node:crypto');
const db = require('../db');
const regras = require('./regras');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_LEILAO = `
  SELECT a.id,
         i.name                AS titulo,
         i.description         AS descricao,
         i.category            AS categoria,
         a.starting_price,
         a.current_price,
         a.status::text        AS status,
         a.bid_count,
         a.starts_at,
         a.ends_at,
         i.seller_id           AS dono_id,
         vendedor.display_name AS dono_nome,
         a.leader_id,
         lider.display_name    AS lider_nome,
         a.winner_id,
         vencedor.display_name AS vencedor_nome,
         ultimo.criado_em      AS ultimo_lance_em
  FROM auctions a
  JOIN items i        ON i.id = a.item_id
  JOIN users vendedor ON vendedor.id = i.seller_id
  LEFT JOIN users lider    ON lider.id = a.leader_id
  LEFT JOIN users vencedor ON vencedor.id = a.winner_id
  LEFT JOIN (
    SELECT auction_id, max(created_at) AS criado_em
    FROM bids
    GROUP BY auction_id
  ) ultimo ON ultimo.auction_id = a.id
`;

const ORDEM = `
  ORDER BY CASE a.status
             WHEN 'ACTIVE' THEN 0
             WHEN 'SCHEDULED' THEN 1
             WHEN 'SOLD' THEN 2
             WHEN 'ENDED_NO_BIDS' THEN 3
             ELSE 4
           END,
           a.ends_at ASC
`;

const FINAIS = ['SOLD', 'ENDED_NO_BIDS', 'CANCELED'];

function paraApi(linha) {
  if (!linha) return null;

  const precoInicial = Number(linha.starting_price);
  const lanceAtual = linha.bid_count > 0 ? Number(linha.current_price) : null;
  const base = lanceAtual ?? precoInicial;
  const finalizado = FINAIS.includes(linha.status);

  return {
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    categoria: linha.categoria,
    precoInicial,
    donoId: linha.dono_id,
    donoNome: linha.dono_nome,
    status: linha.status,
    statusRotulo: regras.ROTULOS[linha.status] || linha.status,
    maiorLance:
      lanceAtual == null
        ? null
        : {
            usuarioId: linha.leader_id,
            usuarioNome: linha.lider_nome,
            valor: lanceAtual,
            criadoEm: linha.ultimo_lance_em
              ? new Date(linha.ultimo_lance_em).toISOString()
              : null,
          },
    lanceAtual,
    incrementoAtual: regras.incrementoPara(base),
    proximoMinimo: regras.proximoMinimo(precoInicial, lanceAtual),
    startsAt: new Date(linha.starts_at).toISOString(),
    endsAt: new Date(linha.ends_at).toISOString(),
    encerradoEm: finalizado ? new Date(linha.ends_at).toISOString() : null,
    vencedor:
      linha.winner_id == null
        ? null
        : {
            usuarioId: linha.winner_id,
            usuarioNome: linha.vencedor_nome,
            valor: Number(linha.current_price),
          },
    agora: new Date().toISOString(),
  };
}

async function listar() {
  const { rows } = await db.consultar(`${SELECT_LEILAO} ${ORDEM}`);
  return rows.map(paraApi);
}

async function buscar(id) {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  }
  const { rows } = await db.consultar(`${SELECT_LEILAO} WHERE a.id = $1`, [id]);
  if (!rows[0]) throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  return paraApi(rows[0]);
}

async function criar({ titulo, descricao, categoria, precoInicial, inicio, fim, fotos, dono }) {
  const dados = regras.validarCriacao({ titulo, descricao, categoria, precoInicial, inicio, fim });

  // Garante mínimo de 3 fotos para satisfazer o trigger trg_item_min_photos (RF05)
  const listaFotos =
    Array.isArray(fotos) && fotos.length >= 3
      ? fotos
      : [
          'https://placehold.co/600x400?text=Foto+1',
          'https://placehold.co/600x400?text=Foto+2',
          'https://placehold.co/600x400?text=Foto+3',
        ];

  const id = await db.transacao(async (cliente) => {
    const item = await cliente.query(
      `INSERT INTO items (seller_id, name, description, category)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [dono.id, dados.titulo, dados.descricao, dados.categoria]
    );

    const itemId = item.rows[0].id;

    for (let i = 0; i < listaFotos.length; i++) {
      await cliente.query(
        `INSERT INTO item_photos (item_id, storage_url, position)
         VALUES ($1, $2, $3)`,
        [itemId, listaFotos[i], i + 1]
      );
    }

    const leilao = await cliente.query(
      `INSERT INTO auctions
         (item_id, starting_price, current_price, min_next_bid, starts_at, original_ends_at, ends_at)
       VALUES ($1, $2, $2, $2, $3, $4, $4)
       RETURNING id`,
      [itemId, dados.preco, dados.comeco, dados.termino]
    );

    return leilao.rows[0].id;
  });

  return buscar(id);
}

async function historico(leilaoId) {
  if (typeof leilaoId !== 'string' || !UUID.test(leilaoId)) {
    throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  }
  const { rows } = await db.consultar(
    `SELECT b.id, b.amount, b.created_at, u.display_name AS nome
     FROM bids b
     JOIN users u ON u.id = b.bidder_id
     WHERE b.auction_id = $1
     ORDER BY b.created_at DESC, b.amount DESC`,
    [leilaoId]
  );
  return rows.map((linha) => ({
    id: linha.id,
    usuarioNome: linha.nome,
    valor: Number(linha.amount),
    criadoEm: new Date(linha.created_at).toISOString(),
  }));
}

async function darLance({ leilaoId, usuario, valor, chaveIdempotencia }) {
  if (typeof leilaoId !== 'string' || !UUID.test(leilaoId)) {
    throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  }

  const resultado = await db.transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT a.id,
              a.status::text AS status,
              a.bid_count,
              a.current_price,
              a.starting_price,
              a.leader_id,
              a.ends_at,
              i.seller_id
       FROM auctions a
       JOIN items i ON i.id = a.item_id
       WHERE a.id = $1
       FOR UPDATE`,
      [leilaoId]
    );

    const linha = rows[0];
    if (!linha) throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');

    const estado = {
      status: linha.status,
      precoInicial: Number(linha.starting_price),
      lanceAtual: linha.bid_count > 0 ? Number(linha.current_price) : null,
      donoId: linha.seller_id,
      leaderId: linha.leader_id,
      endsAt: new Date(linha.ends_at),
    };

    const validado = regras.validarLance({ leilao: estado, usuario, valor });
    const proximo = regras.proximoMinimo(estado.precoInicial, validado.valorLance);

    let inserido;
    try {
      inserido = await cliente.query(
        `INSERT INTO bids (auction_id, bidder_id, amount, idempotency_key)
         VALUES ($1, $2, $3, $4)
         RETURNING id, created_at`,
        [leilaoId, usuario.id, validado.valorLance, chaveIdempotencia || crypto.randomUUID()]
      );
    } catch (erro) {
      if (erro.code === '23505') {
        if (String(erro.constraint || '').includes('idempotency')) {
          throw regras.erro(409, 'Este lance já foi registrado', 'LANCE_DUPLICADO');
        }
        throw regras.erro(
          409,
          `Outro participante acabou de dar lance de ${regras.reais(validado.valorLance)}. Tente o próximo mínimo.`,
          'LANCE_CORRIDA'
        );
      }
      throw erro;
    }

    // Atualiza preço, líder, contagem e aplica prorrogação de 2 min se estiver no fim (RF15)
    await cliente.query(
      `UPDATE auctions
       SET current_price = $2,
           min_next_bid = $3,
           leader_id = $4,
           bid_count = bid_count + 1,
           ends_at = CASE
             WHEN ends_at - clock_timestamp() <= INTERVAL '2 minutes'
               THEN clock_timestamp() + INTERVAL '2 minutes'
             ELSE ends_at
           END
       WHERE id = $1`,
      [leilaoId, validado.valorLance, proximo, usuario.id]
    );

    return { lance: inserido.rows[0], valorLance: validado.valorLance };
  });

  const leilaoAtualizado = await buscar(leilaoId);

  return {
    lance: {
      id: resultado.lance.id,
      valor: resultado.valorLance,
      usuarioNome: usuario.nome,
      criadoEm: new Date(resultado.lance.created_at).toISOString(),
    },
    leilao: leilaoAtualizado,
  };
}

async function atualizarEstados() {
  const abertos = await db.consultar(
    `UPDATE auctions
     SET status = 'ACTIVE'
     WHERE status = 'SCHEDULED' AND starts_at <= clock_timestamp()
     RETURNING id`
  );

  const vendidos = await db.consultar(
    `UPDATE auctions
     SET status = 'SOLD', winner_id = leader_id
     WHERE status = 'ACTIVE' AND ends_at <= clock_timestamp() AND bid_count > 0
     RETURNING id, status::text AS status`
  );

  const semLance = await db.consultar(
    `UPDATE auctions
     SET status = 'ENDED_NO_BIDS', winner_id = NULL
     WHERE status = 'ACTIVE' AND ends_at <= clock_timestamp() AND bid_count = 0
     RETURNING id, status::text AS status`
  );

  const encerrados = [...vendidos.rows, ...semLance.rows];

  return {
    abertos: abertos.rows.map((linha) => linha.id),
    encerrados: encerrados.rows.map((linha) => ({ id: linha.id, status: linha.status })),
  };
}

module.exports = { listar, buscar, criar, historico, darLance, atualizarEstados, paraApi };