// Leilões e lances no PostgreSQL, usando o schema de dados/leilao_db.sql.
//
// Divisão de responsabilidade:
//   items     -> o bem anunciado (name, description, category, seller_id)
//   auctions  -> a venda do item (preço, estado, janela de tempo, líder)
//   bids      -> cada lance aceito
//
// Regras puras (tabela de incremento, validações) ficam em regras.js.
// Aqui só há SQL e a transação do lance.

const crypto = require('node:crypto');
const db = require('../db');
const regras = require('./regras');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SELECT_LEILAO = `
  SELECT a.id,
         i.name                AS titulo,
         i.description         AS descricao,
         i.category            AS categoria,
         i.id                  AS item_id,
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
  -- Última data de lance por leilão, agregada de uma vez (um JOIN, não N subqueries)
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

function paraApi(linha, fotos = []) {
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
    fotos,
    precoInicial,
    donoId: linha.dono_id,
    // RF09: identifica as pessoas sem expor o nome completo
    donoNome: regras.mascararNome(linha.dono_nome),
    status: linha.status,
    statusRotulo: regras.ROTULOS[linha.status] || linha.status,
    totalLances: linha.bid_count,
    maiorLance:
      lanceAtual == null
        ? null
        : {
            usuarioId: linha.leader_id,
            usuarioNome: regras.mascararNome(linha.lider_nome),
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
            usuarioNome: regras.mascararNome(linha.vencedor_nome),
            valor: Number(linha.current_price),
          },
    agora: new Date().toISOString(),
  };
}

// Busca as URLs das fotos de um item (RF05/RF07)
async function fotosDoItem(itemId) {
  const { rows } = await db.consultar(
    `SELECT storage_url FROM item_photos WHERE item_id = $1 ORDER BY position`,
    [itemId]
  );
  return rows.map((linha) => linha.storage_url);
}

// Mesma coisa para vários itens de uma vez, para a listagem não fazer N consultas
async function fotosDeVarios(itens) {
  const mapa = new Map();
  const unicos = [...new Set(itens.filter(Boolean))];
  if (!unicos.length) return mapa;

  const marcadores = unicos.map((_, indice) => `$${indice + 1}`).join(', ');
  const { rows } = await db.consultar(
    `SELECT item_id, storage_url FROM item_photos
     WHERE item_id IN (${marcadores})
     ORDER BY position`,
    unicos
  );

  for (const linha of rows) {
    if (!mapa.has(linha.item_id)) mapa.set(linha.item_id, []);
    mapa.get(linha.item_id).push(linha.storage_url);
  }
  return mapa;
}

async function listar() {
  const { rows } = await db.consultar(`${SELECT_LEILAO} ${ORDEM}`);
  const fotos = await fotosDeVarios(rows.map((linha) => linha.item_id));
  return rows.map((linha) => paraApi(linha, fotos.get(linha.item_id) || []));
}

async function buscar(id) {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  }
  const { rows } = await db.consultar(`${SELECT_LEILAO} WHERE a.id = $1`, [id]);
  if (!rows[0]) throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  return paraApi(rows[0], await fotosDoItem(rows[0].item_id));
}

async function criar({ titulo, descricao, categoria, fotos, precoInicial, inicio, fim, dono }) {
  const dados = regras.validarCriacao({ titulo, descricao, categoria, precoInicial, inicio, fim });
  // RF05: mínimo de 3 fotos; RF07: guardamos apenas a URL
  const urlsFotos = regras.validarFotos(fotos);

  const id = await db.transacao(async (cliente) => {
    // O item é separado do leilão porque o mesmo item pode ser relistado depois
    const item = await cliente.query(
      `INSERT INTO items (seller_id, name, description, category)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [dono.id, dados.titulo, dados.descricao, dados.categoria]
    );

    // Fotos em ordem, na tabela item_photos (só a URL, nunca o arquivo)
    for (const [indice, url] of urlsFotos.entries()) {
      await cliente.query(
        `INSERT INTO item_photos (item_id, storage_url, position) VALUES ($1, $2, $3)`,
        [item.rows[0].id, url, indice + 1]
      );
    }

    // Nasce SCHEDULED (padrão da coluna); preço atual e próximo mínimo
    // começam iguais ao preço inicial.
    const leilao = await cliente.query(
      `INSERT INTO auctions
         (item_id, starting_price, current_price, min_next_bid, starts_at, original_ends_at, ends_at)
       VALUES ($1, $2, $2, $2, $3, $4, $4)
       RETURNING id`,
      [item.rows[0].id, dados.preco, dados.comeco, dados.termino]
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
    usuarioNome: regras.mascararNome(linha.nome),
    valor: Number(linha.amount),
    criadoEm: new Date(linha.created_at).toISOString(),
  }));
}

async function darLance({ leilaoId, usuario, valor, chaveIdempotencia }) {
  if (typeof leilaoId !== 'string' || !UUID.test(leilaoId)) {
    throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  }

  const resultado = await db.transacao(async (cliente) => {
    // RF12: se o mesmo lance chegar de novo (clique duplo, rede caindo), devolve
    // o resultado original em vez de criar um segundo lance.
    if (chaveIdempotencia) {
      const existente = await cliente.query(
        `SELECT id, auction_id, amount, created_at FROM bids
         WHERE bidder_id = $1 AND idempotency_key = $2`,
        [usuario.id, chaveIdempotencia]
      );
      if (existente.rows[0]) {
        return { repetido: true, lance: existente.rows[0] };
      }
    }

    // FOR UPDATE trava a linha do leilão até o COMMIT: dois lances simultâneos
    // entram em fila, e o segundo já enxerga o valor gravado pelo primeiro.
    // É a versão banco de dados da atomicidade que o array em memória dava.
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

    // RF13: no máximo um lance a cada 500 ms por usuário.
    // A checagem é por (leilão, usuário), então não atrapalha outros participantes.
    // O reenvio legítimo já saiu antes, no teste de idempotência.
    const limite = new Date(Date.now() - regras.LIMITES.intervaloMinimoLanceMs);
    const ultimo = await cliente.query(
      `SELECT created_at FROM bids
       WHERE auction_id = $1 AND bidder_id = $2 AND created_at > $3
       ORDER BY created_at DESC LIMIT 1`,
      [leilaoId, usuario.id, limite]
    );
    if (ultimo.rows[0]) {
      throw regras.erro(
        429,
        'Calma: aguarde um instante entre seus lances',
        'LANCE_RAPIDO'
      );
    }

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
        // Duas travas diferentes, com causas diferentes:
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

    await cliente.query(
      `UPDATE auctions
       SET current_price = $2, min_next_bid = $3, leader_id = $4, bid_count = bid_count + 1
       WHERE id = $1`,
      [leilaoId, validado.valorLance, proximo, usuario.id]
    );

    return { lance: inserido.rows[0], valorLance: validado.valorLance };
  });

  if (resultado.repetido) {
    // RF12: mesmo id, mesmo valor, nenhum lance novo
    return {
      repetido: true,
      lance: {
        id: resultado.lance.id,
        valor: Number(resultado.lance.amount),
        usuarioNome: regras.mascararNome(usuario.nome),
        criadoEm: new Date(resultado.lance.created_at).toISOString(),
      },
      leilao: await buscar(resultado.lance.auction_id),
    };
  }

  const leilaoAtualizado = await buscar(leilaoId);

  return {
    lance: {
      id: resultado.lance.id,
      valor: resultado.valorLance,
      usuarioNome: regras.mascararNome(usuario.nome),
      criadoEm: new Date(resultado.lance.created_at).toISOString(),
    },
    leilao: leilaoAtualizado,
  };
}

// Relógio do servidor (RF17/RF18): aplica no banco as transições de horário.
// Roda a cada segundo e também no boot, recuperando o que passou enquanto o
// processo estava fora do ar.
async function atualizarEstados() {
  const abertos = await db.consultar(
    `UPDATE auctions
     SET status = 'ACTIVE'
     WHERE status = 'SCHEDULED' AND starts_at <= now()
     RETURNING id`
  );

  // Dois UPDATEs em vez de um CASE com cast de ENUM: fica legível e funciona
  // igual em qualquer Postgres. A ordem importa: quem tem lance vira SOLD.
  const vendidos = await db.consultar(
    `UPDATE auctions
     SET status = 'SOLD', winner_id = leader_id
     WHERE status = 'ACTIVE' AND ends_at <= now() AND bid_count > 0
     RETURNING id, status::text AS status`
  );

  const semLance = await db.consultar(
    `UPDATE auctions
     SET status = 'ENDED_NO_BIDS', winner_id = NULL
     WHERE status = 'ACTIVE' AND ends_at <= now() AND bid_count = 0
     RETURNING id, status::text AS status`
  );

  const encerrados = [...vendidos.rows, ...semLance.rows];

  return {
    abertos: abertos.rows.map((linha) => linha.id),
    encerrados: encerrados.map((linha) => ({ id: linha.id, status: linha.status })),
  };
}

// RF08: o comitente cancela enquanto o leilão estiver SCHEDULED ou ACTIVE sem
// lances. Com lances, não pode. O cancelamento não apaga nada: vira CANCELED.
async function cancelar({ leilaoId, usuario }) {
  if (typeof leilaoId !== 'string' || !UUID.test(leilaoId)) {
    throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
  }

  await db.transacao(async (cliente) => {
    const { rows } = await cliente.query(
      `SELECT a.status::text AS status, a.bid_count, i.seller_id
       FROM auctions a
       JOIN items i ON i.id = a.item_id
       WHERE a.id = $1
       FOR UPDATE`,
      [leilaoId]
    );

    const linha = rows[0];
    if (!linha) throw regras.erro(404, 'Leilão não encontrado', 'LEILAO_NAO_ENCONTRADO');
    if (linha.seller_id !== usuario.id) {
      throw regras.erro(403, 'Só quem publicou o item pode cancelar', 'NAO_E_DONO');
    }
    if (['SOLD', 'ENDED_NO_BIDS', 'CANCELED'].includes(linha.status)) {
      throw regras.erro(409, 'Leilão já finalizado, não pode ser cancelado', 'LEILAO_FINALIZADO');
    }
    if (linha.bid_count > 0) {
      throw regras.erro(409, 'Leilão com lances não pode ser cancelado', 'LEILAO_COM_LANCES');
    }

    await cliente.query(`UPDATE auctions SET status = 'CANCELED' WHERE id = $1`, [leilaoId]);
  });

  return buscar(leilaoId);
}

module.exports = { listar, buscar, criar, historico, darLance, cancelar, atualizarEstados, paraApi };