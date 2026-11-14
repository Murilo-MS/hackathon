# Contrato da API — Leilão Online

Tudo trafega em JSON. Erros sempre no formato `{ "erro": "mensagem" }`.
Rotas marcadas com 🔒 exigem `Authorization: Bearer <token>`.

## Autenticação

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| POST | `/auth/register` | `{ nome, email, senha }` | `201 { usuario, token }` |
| POST | `/auth/login` | `{ email, senha }` | `200 { usuario, token }` |
| GET | `/auth/me` 🔒 | — | `200 { usuario }` |

`usuario` = `{ id, nome, email }` (nunca inclui a senha nem o hash).

## Leilões

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| GET | `/auctions` | — | `200 { leiloes: [...], agora }` |
| POST | `/auctions` 🔒 | `{ titulo, descricao, categoria, precoInicial, inicio, fim }` | `201 { leilao }` |
| GET | `/auctions/:id` | — | `200 { leilao, historico }` |
| GET | `/auctions/:id/bids` | — | `200 { historico }` |
| POST | `/auctions/:id/bids` 🔒 | `{ valor }` | `201 { lance, leilao }` |

`inicio` e `fim` são datas ISO 8601 em UTC (`2026-11-14T21:00:00.000Z`). O front converte
o `datetime-local` do formulário com `toISOString()`, porque o input não carrega fuso.

**Ids são UUID** (gerados pelo PostgreSQL), sempre string. Não conte com números.

O lance aceita o cabeçalho opcional `Idempotency-Key` (UUID): reenviar a mesma chave pelo
mesmo usuário não cria um segundo lance (RF12).

**Persistência:** usuários, leilões e lances ficam no PostgreSQL (`dados/leilao_db.sql`).
Reiniciar o servidor não apaga nada; o estado das janelas de tempo é recalculado no boot.

**Não existe campo de incremento.** Ele é derivado do preço atual (RF14), no servidor.

Objeto `leilao`:

```json
{
  "id": 1,
  "titulo": "Bicicleta aro 29",
  "descricao": "Quadro de alumínio",
  "precoInicial": 100,
  "donoId": 1,
  "donoNome": "Marina",
  "status": "ACTIVE",
  "statusRotulo": "em andamento",
  "maiorLance": { "usuarioId": 2, "usuarioNome": "Ana", "valor": 120, "criadoEm": "..." },
  "lanceAtual": 120,
  "incrementoAtual": 5,
  "proximoMinimo": 125,
  "startsAt": "2026-11-14T20:00:00.000Z",
  "endsAt": "2026-11-14T20:15:00.000Z",
  "encerradoEm": null,
  "vencedor": null,
  "agora": "2026-11-14T20:05:00.000Z"
}
```

- `lanceAtual` é `null` enquanto ninguém deu lance.
- `incrementoAtual` é o incremento aplicável ao preço atual.
- `agora` é o relógio do servidor; o front usa a diferença para o cronômetro não mentir.

## Estados (RN01) e transições

| Estado | Significado | Pode sair para |
|---|---|---|
| `SCHEDULED` | agendado | `ACTIVE` (chegou o início), `CANCELED` |
| `ACTIVE` | em andamento | `SOLD` (terminou com lances), `ENDED_NO_BIDS` (terminou sem lances), `CANCELED` (só sem lances) |
| `SOLD` | vendido | — final |
| `ENDED_NO_BIDS` | encerrado sem lances | — final |
| `CANCELED` | cancelado | — final |

Os códigos são iguais ao ENUM `auction_status` de `dados/leilao_db.sql`. O rótulo em
português vem em `statusRotulo`, para a tela não traduzir nada.

Quem aplica as transições é o relógio do servidor, a cada segundo, sem depender de
navegador aberto (RF17). Ao mudar, o servidor emite evento na sala do leilão.

## Tabela de incremento (RF14)

| Preço atual | Incremento |
|---|---|
| até R$ 99,99 | R$ 1,00 |
| R$ 100,00 a R$ 499,99 | R$ 5,00 |
| R$ 500,00 a R$ 999,99 | R$ 10,00 |
| R$ 1.000,00 a R$ 4.999,99 | R$ 50,00 |
| R$ 5.000,00 a R$ 24.999,99 | R$ 100,00 |
| a partir de R$ 25.000,00 | R$ 500,00 |

`proximoMinimo` = primeiro lance: `precoInicial`; depois: `lanceAtual + incrementoAtual`.

## Regras de lance (RF10), nesta ordem

1. Leilão existe → senão `404`.
2. Estado `ACTIVE` e `agora < endsAt` → `SCHEDULED` responde `409 LEILAO_AGENDADO`;
   finalizado responde `409 LEILAO_ENCERRADO`.
3. Autor não é o dono → senão `403 DONO_DO_LEILAO`.
4. `valor > 0` → senão `400`.
5. `valor >= proximoMinimo` → senão `400 LANCE_ABAIXO_DO_MINIMO`.
6. Autor não é o líder atual → senão `409 JA_E_O_MAIOR`.

## Tempo real (Socket.IO)

Cliente servido em `/socket.io/socket.io.js`. Uma sala por leilão: `leilao:<id>`.

| Direção | Evento | Carga |
|---|---|---|
| cliente → servidor | `join_auction` | `id` |
| cliente → servidor | `leave_auction` | `id` |
| servidor → sala | `new_bid` | `{ leilaoId, lanceAtual, proximoMinimo, usuarioNome, criadoEm }` |
| servidor → sala | `auction_started` | `{ leilaoId }` |
| servidor → sala | `auction_ended` | `{ leilaoId, status, vencedor }` |

## Códigos de erro

`400` dados inválidos · `401` sem sessão ou expirada · `403` regra de negócio ·
`404` não encontrado · `409` conflito de estado · `413` corpo grande ·
`500` erro interno (nunca detalhado ao cliente).
