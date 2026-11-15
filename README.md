# Leilão Online — Hackathon

Sistema de leilão online em tempo real. Cadastro e login, criação de leilão com fotos e
agendamento, sala com lances ao vivo, abertura e fechamento automáticos, e persistência
completa em PostgreSQL.

## Endereço do sistema publicado

**<http://200.18.99.113:8080>** (VM, porta 8080)

## Contas de demonstração

Todas com a senha **`senha123`** (carregadas por `npm run db:dados`):

| Conta             | Papel                |
| ----------------- | -------------------- |
| `carlos@demo.com` | comitente (vendedor) |
| `ana@demo.com`    | compradora           |
| `bruno@demo.com`  | comprador            |
| `carla@demo.com`  | compradora           |

O seed também cria leilões nos cinco estados: agendado, em andamento (com lances),
vendido, encerrado sem lances e cancelado.

## Stack

- **Back-end:** Node.js 20+ com Express 5, socket.io, JWT (`jsonwebtoken`) e bcrypt (`bcryptjs`)
- **Banco:** PostgreSQL 16 (schema em `dados/leilao_db.sql`)
- **Front-end:** HTML, CSS e JavaScript puro (sem framework), servido pelo próprio back-end
- **Infra:** Docker Compose (banco + aplicação) ou Node direto na VM

## Como recriar o ambiente do zero

Pré-requisitos: Git, Docker com Compose e Node.js 20+ (só para a opção A).

```bash
git clone https://github.com/Murilo-MS/hackathon.git
cd hackathon
```

### Opção A: aplicação em Node, banco no Docker

```bash
docker compose up -d db          # na raiz do projeto: sobe só o PostgreSQL

cd backend
npm install
cp .env.example .env             # ajuste PORT=8080, JWT_SECRET e DATABASE_URL
                                 # ex.: postgresql://USUARIO:SENHA@localhost:5432/leilao_db

npm run db:setup                 # cria as tabelas
npm run db:dados                 # carrega as contas e leilões de demonstração
npm start                        # http://localhost:8080
```

### Opção B: tudo no Docker (aplicação + banco)

```bash
docker compose up -d --build
docker compose exec backend npm run db:setup
docker compose exec backend npm run db:dados
```

Dentro do Compose, o `DATABASE_URL` do back-end deve apontar para o **nome do serviço do banco**
(`@db:5432` ou `@hackathon_db:5432`), nunca para `localhost`, que ali é o próprio container
da aplicação. Usuário, senha e banco são os definidos em `POSTGRES_USER`, `POSTGRES_PASSWORD` e
`POSTGRES_DB` no `docker-compose.yml`.

### Recriar só o banco

```bash
docker compose down -v           # apaga o volume do banco
docker compose up -d db
```

Os scripts de `db:setup` e `db:dados` precisam ser executados de novo depois disso.

## Como verificar

```bash
cd backend
npm test                         # 26 testes (regras, autenticação, SQL e upload)
npm run verificar                # 40+ verificações ponta a ponta contra a API rodando
```

## Como funciona (visão rápida)

```text
Navegador (HTML/CSS/JS)
   │  fetch (REST)                │  WebSocket (socket.io)
   ▼                              ▼
Express 5  ──────────────────  socket.io (salas "leilao:<id>")
   │
   │  pg (pool)
   ▼
PostgreSQL: users, items, item_photos, auctions, bids
```

- **Relógio do servidor:** a cada segundo o back aplica no banco as transições de estado
  (agendado → em andamento → vendido / encerrado sem lances). Rodar o relógio no servidor é
  o que faz o leilão abrir e fechar sem ninguém com a página aberta, e o *catch-up* na
  inicialização recupera o que venceu enquanto o processo estava fora do ar.
- **Lance atômico:** `BEGIN` → `SELECT ... FOR UPDATE` → valida → `INSERT` no lance →
  `UPDATE` do preço/líder → `COMMIT`. Depois do commit, a sala recebe `new_bid`.
- **A tela nunca decide preço:** incremento, lance mínimo e vencedor são calculados no servidor.
- **Quatro pastas na tela inicial:** *Em aberto* (agendados e em andamento), *Encerrados*
  (vendidos, sem lances e cancelados, com o resultado e o vencedor), *Seus lances* (com a
  situação: na frente, coberto, venceu, perdeu) e *Seus leilões* (todos os que você publicou).

## Banco de dados e garantias

| Tabela        | Papel                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| `users`       | contas; e-mail único sem diferenciar maiúsculas; só o hash da senha       |
| `items`       | o bem anunciado; separado do leilão para permitir relistagem              |
| `item_photos` | só a URL de cada foto (nunca o arquivo)                                   |
| `auctions`    | estado, preços, líder, vencedor e horários; leitura rápida sem `MAX()`    |
| `bids`        | cada lance aceito, com a chave de idempotência                            |

O banco é a última barreira: mesmo que o código tenha um bug, ele recusa o dado errado.

- **Concorrência (RF11):** `SELECT ... FOR UPDATE` serializa os lances de um mesmo leilão, e
  `UNIQUE (auction_id, amount)` impede dois lances de mesmo valor, mesmo sem o trava.
- **Reenvio (RF12):** `UNIQUE (bidder_id, idempotency_key)`. A chave é do autor, então um usuário
  não consegue ler o resultado do lance de outro.
- **Estados (RN01):** um trigger permite só as transições do edital e torna Vendido, Encerrado sem
  lances e Cancelado imutáveis. Um índice único parcial garante no máximo um leilão aberto por item.
- **Coerência:** `CHECK`s ligam estado, número de lances, líder e vencedor (por exemplo, só existe
  líder se há lances, e só existe vencedor se o leilão foi vendido).
- **Dinheiro e horário (RF19):** `NUMERIC(12,2)` (sem arredondamento) e `TIMESTAMPTZ` em UTC. O
  relógio do servidor é a única verdade; o navegador só converte para exibição.
- **Nada é apagado (RF08):** cancelar muda o status para `CANCELED`.

## Decisões da equipe

1. **Tabela de incremento (RF14).** Usamos a tabela de referência do edital, aplicada sobre o
   preço atual: até 99,99 → R$ 1; 100–499,99 → R$ 5; 500–999,99 → R$ 10; 1.000–4.999,99 → R$ 50;
   5.000–24.999,99 → R$ 100; a partir de 25.000 → R$ 500. É determinística: o mesmo estado gera
   sempre o mesmo mínimo.
2. **Limites de tempo (RF06).** Duração de 10 segundos a 24 horas e início até 7 dias à frente.
   O mínimo curto existe para a demonstração: dá para mostrar abertura e fechamento em segundos.
3. **Fotos (RF05/RF07).** O comitente escolhe **arquivos do computador**; o front envia para
   `POST /fotos` (multipart/form-data) e só depois cria o leilão. O servidor valida quantidade
   (3 a 6), tipo (JPG, PNG ou WEBP), tamanho (até 5 MB cada) e confere os primeiros bytes do
   arquivo, porque extensão e `Content-Type` podem mentir e o conteúdo não. O banco guarda apenas
   a URL em `item_photos`. Há dois destinos: com `S3_*` configurado, o arquivo vai para o bucket da
   organização (o caminho do edital); sem S3, ele fica em `UPLOADS_DIR` e é servido em `/uploads`,
   um **modo de emergência apenas para desenvolvimento** (o edital proíbe fotos no disco da VM).
4. **Identificação sem nome completo (RF09).** Na sala, as pessoas aparecem como "Ana S.".
   O perfil público (Nível 2) é que mostraria o nome completo.
5. **Frequência de lances (RF13).** No máximo um lance a cada 500 ms por usuário, checado por
   (leilão, usuário). A checagem vem depois da idempotência, então reenviar o mesmo lance não é
   punido, e usuários diferentes não se bloqueiam.
6. **Reenvio de lance (RF12).** Cada lance pode levar uma chave UUID; repetir a mesma chave
   devolve o lance original com status 200 e não cria um segundo registro.
7. **Cancelamento (RF08).** Só o comitente cancela, e só sem lances. O leilão não é apagado:
   vira `CANCELED` e continua na listagem.
8. **Sala exige login (RF04).** A listagem é pública; a sala pede sessão. O modo espectador
   (assistir sem participar) ficou para o Nível 2.
9. **Ordenação da listagem (RF20).** Em andamento primeiro, depois agendados, depois finalizados;
   dentro de cada grupo, pelo término mais próximo.
10. **Ids UUID.** O banco gera UUID; o front trata o id como texto. Evita colisão quando mais de
    uma instância do back estiver rodando.
11. **Prorrogação (RF15).** Duas formas, com o mesmo teto de 30 minutos sobre o término original:
    automática (lance nos 2 minutos finais joga o fim para 2 minutos depois do lance) e manual
    (o comitente clica em "Prorrogar +5 min"). O novo horário vai no evento
    `new_bid`/`auction_extended`, então o cronômetro de todos se ajusta sem recarregar.
12. **Banco e concorrência (RF11/RF17/RF18).** PostgreSQL com transação e trava por linha, em vez
    de NoSQL, porque o maior risco do sistema é a inconsistência sob lances simultâneos. Abertura e
    fechamento por um worker que consulta o banco (e não por timer em memória), para sobreviver a
    reinícios. O custo é uma consulta por segundo e a serialização dos lances de um mesmo leilão.
13. **Sessão (RF02).** Token JWT assinado com expiração (`JWT_EXPIRES_IN`, padrão 1 hora), sem
    renovação automática, para limitar o risco de um token vazado.
14. **Tempo real (RF09).** socket.io, com uma sala por leilão; o servidor só emite o novo estado
    depois do `COMMIT`.

## O que ficou fora (transparência para o pitch)

- **Nível 2:** busca com filtros, perfil público do comitente, edição de leilão, modo espectador,
  reconexão com aviso de lance superado, "Minhas participações", relistagem.
- **Bônus:** pontuação/habilitação de comitente, crédito com reserva, HTTPS com domínio, banco
  gerenciado, múltiplas instâncias com balanceamento, métricas e teste de carga formal.
- **Bucket de fotos:** o upload (`POST /fotos`) está implementado, mas depende das credenciais
  `S3_*` do bucket fornecido pela organização; sem elas, vale o modo de emergência da decisão 3.

## Estrutura

```text
backend/
  src/
    app.js              monta Express, rotas e tratamento de erro
    server.js           HTTP + socket.io + relógio das transições
    db.js               pool do PostgreSQL e transação
    config.js           variáveis de ambiente
    auth/               senha (bcrypt), token (JWT), middleware, rotas
    users/userStore.js  usuários no banco
    auctions/
      regras.js         regras puras: incremento, validações, máscara de nome
      store.js          SQL de leilões, lances, fotos, cancelamento
      routes.js         endpoints REST
  scripts/
    criar-banco.js      aplica schema e seed (idempotente)
    verificar-api.js    verificação ponta a ponta
  test/                 testes de regras, autenticação e banco (pg-mem)
dados/
  leilao_db.sql         schema
  seed.sql              dados de demonstração
front/public/           index.html, style.css, main.js
```
