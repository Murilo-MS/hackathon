# Contrato da API — Leilão Online

Tudo trafega em JSON. Erros sempre no formato `{ "erro": "mensagem" }`.
Rotas marcadas com 🔒 exigem o cabeçalho `Authorization: Bearer <token>`.

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
| POST | `/auctions` 🔒 | `{ titulo, descricao, precoInicial, incrementoMinimo, duracaoMinutos }` | `201 { leilao }` |
| GET | `/auctions/:id` | — | `200 { leilao, historico }` |
| GET | `/auctions/:id/bids` | — | `200 { historico }` |
| POST | `/auctions/:id/bids` 🔒 | `{ valor }` | `201 { lance, leilao }` |

Objeto `leilao`:

```json
{
  "id": 1,
  "titulo": "Bicicleta aro 29",
  "descricao": "Quadro de alumínio",
  "precoInicial": 100,
  "incrementoMinimo": 10,
  "donoId": 1,
  "donoNome": "Marina",
  "maiorLance": { "usuarioId": 2, "usuarioNome": "Ana", "valor": 120, "criadoEm": "..." },
  "proximoMinimo": 130,
  "status": "aberto",
  "terminaEm": "2026-11-14T21:00:00.000Z",
  "encerradoEm": null,
  "vencedor": null,
  "agora": "2026-11-14T20:45:00.000Z"
}
```

`maiorLance` é `null` enquanto ninguém deu lance. `agora` é o relógio do servidor: o front usa
a diferença entre ele e o relógio do navegador para o cronômetro não mentir.

Objeto `lance` do histórico: `{ id, usuarioNome, valor, criadoEm }`.

## Regras de lance (validadas no servidor, nesta ordem)

1. Leilão existe → senão `404`.
2. Leilão aberto e `agora < terminaEm` → senão `409 LEILAO_ENCERRADO`.
3. Quem dá o lance não é o dono → senão `403 DONO_DO_LEILAO`.
4. `valor > 0` → senão `400`.
5. `valor >= proximoMinimo` → senão `400 LANCE_ABAIXO_DO_MINIMO`.
6. `valor` não é do mesmo usuário que já lidera → senão `409 JA_E_O_MAIOR`.

`proximoMinimo` = primeiro lance: `precoInicial`; depois: `maiorLance.valor + incrementoMinimo`.

## Tempo real (Socket.IO)

O cliente do Socket.IO é servido em `/socket.io/socket.io.js`.

| Direção | Evento | Carga |
|---|---|---|
| cliente → servidor | `join_auction` | `id` do leilão |
| cliente → servidor | `leave_auction` | `id` do leilão |
| servidor → sala | `new_bid` | `{ leilaoId, lanceAtual, proximoMinimo, usuarioNome, criadoEm }` |
| servidor → sala | `auction_ended` | `{ leilaoId, vencedor }` |

Cada leilão tem a sala `leilao:<id>`. O evento só é emitido **depois** de o lance ser gravado.

## Códigos de erro usados

`400` dados inválidos · `401` sem sessão ou sessão expirada · `403` regra de negócio (dono) ·
`404` não encontrado · `409` conflito (encerrado, já é o maior) · `413` corpo grande ·
`500` erro interno (nunca detalhado para o cliente).
