# Leilão Online — Hackathon

Sistema de leilão online em tempo real. Cadastro e login, criação de leilão com fotos e
agendamento, sala com lances ao vivo, abertura e fechamento automáticos, e persistência
completa em PostgreSQL.

## Endereço do sistema publicado

**http://200.18.99.113:8080** (VM, porta 8080)

## Contas de demonstração

Todas com a senha **senha123** (carregadas por `npm run db:dados`):

| Conta | Papel |
|---|---|
| carlos@demo.com | comitente (vendedor) |
| ana@demo.com | compradora |
| bruno@demo.com | comprador |
| carla@demo.com | compradora |

O seed também cria leilões nos cinco estados: agendado, em andamento (com lances),
vendido, encerrado sem lances e cancelado.

## Stack

- **Back-end:** Node.js 20+ com Express 5, socket.io, JWT (`jsonwebtoken`) e bcrypt (`bcryptjs`)
- **Banco:** PostgreSQL 16 (schema em `dados/leilao_db.sql`)
- **Front-end:** HTML, CSS e JavaScript puro (sem framework), servido pelo próprio back-end
- **Infra:** Docker Compose (banco + aplicação) ou Node direto na VM

## Como recriar o ambiente do zero

```bash
git clone https://github.com/Murilo-MS/hackathon.git
cd hackathon/backend
npm install

cp .env.example .env      # ajuste PORT=8080, JWT_SECRET e DATABASE_URL
docker compose up -d db   # na raiz do projeto: sobe só o PostgreSQL

npm run db:setup          # cria as tabelas
npm run db:dados          # carrega as contas e leilões de demonstração

npm start                 # http://localhost:8080
```

Com Docker para tudo (aplicação + banco):

```bash
docker compose up -d --build
docker compose exec backend npm run db:setup
docker compose exec backend npm run db:dados
```

## Como verificar

```bash
npm test                  # 17 testes (regras, autenticação e SQL com pg-mem)
npm run verificar         # 40+ verificações ponta a ponta contra a API rodando
```

## Como funciona (visão rápida)

```
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
  o que faz o leilão abrir e fechar sem ninguém com a página aberta — e o *catch-up* no boot
  recupera o que venceu enquanto o processo estava fora do ar.
- **Lance atômico:** `BEGIN` → `SELECT ... FOR UPDATE` → valida → `INSERT` no lance →
  `UPDATE` do preço/líder → `COMMIT`. Depois do commit, a sala recebe `new_bid`.
- **A tela nunca decide preço:** incremento, lance mínimo e vencedor são calculados no servidor.

## Decisões da equipe

1. **Tabela de incremento (RF14).** Usamos a tabela de referência do edital, aplicada sobre o
   preço atual: até 99,99 → R$ 1; 100–499,99 → R$ 5; 500–999,99 → R$ 10; 1.000–4.999,99 → R$ 50;
   5.000–24.999,99 → R$ 100; acima de 25.000 → R$ 500. É determinística: o mesmo estado gera
   sempre o mesmo mínimo.
2. **Limites de tempo (RF06).** Duração de 10 segundos a 24 horas e início até 7 dias à frente.
   O mínimo curto existe para a demonstração: dá para mostrar abertura e fechamento em segundos.
3. **Fotos (RF07).** Guardamos **apenas a URL** em `item_photos` — nunca o arquivo no banco nem
   no disco da VM. A validação aceita só `http(s)` de imagem (jpg/png/webp/gif) ou hosts de
   serviços de imagem, entre 3 e 6 fotos. A organização fornece o bucket; trocar a origem é
   mudar o endereço que o front envia.
4. **Identificação sem nome completo (RF09).** Na sala, as pessoas aparecem como "Ana S.".
   O perfil público (Nível 2) é que mostraria o nome completo.
5. **Frequência de lances (RF13).** No máximo um lance a cada 500 ms por usuário, checado por
   (leilão, usuário). A checagem vem depois da idempotência, então reenviar o mesmo lance não é
   punido, e usuários diferentes não se bloqueiam.
6. **Reenvio de lance (RF12).** Cada lance pode levar uma chave UUID; repetir a mesma chave
   devolve o lance original com status 200 e não cria um segundo registro.
7. **Cancelamento (RF08).** Só o comitente cancela, e só sem lances. O leilão não é apagado:
   vira `CANCELED` e continua na listagem.
8. **Sala exige login (RF04).** A listagem é pública; o detalhe/sala pede sessão. O modo
   espectador (assistir sem participar) ficou para o Nível 2.
9. **Ordenação da listagem (RF20).** Em andamento primeiro, depois agendados, depois finalizados;
   dentro de cada grupo, pelo término mais próximo.
10. **Ids UUID.** O banco gera UUID; o front trata o id como texto. Evita colisão quando mais de
    uma instância do back estiver rodando.
11. **Prorrogação (RF15).** Duas formas, com o mesmo teto de 30 minutos sobre o término original:
    automática (lance nos 2 minutos finais joga o fim para 2 minutos depois do lance) e manual
    (o comitente clica em "Prorrogar +5 min"). O novo horário vai no evento `new_bid`/`auction_extended`,
    então o cronômetro de todos se ajusta sem recarregar.

## O que ficou fora (transparência para o pitch)

- **Nível 2:** busca com filtros, perfil público do comitente, edição de leilão, modo espectador,
  reconexão com aviso de lance superado, "Minhas participações", relistagem.
- **Bônus:** pontuação/habilitação de comitente, crédito com reserva, HTTPS com domínio,
  múltiplas instâncias com balanceamento, métricas e teste de carga formal.
- **Upload de arquivo:** o front envia URLs de imagem; um `POST /fotos` com multipart entra junto
  com as credenciais do bucket fornecido.

## Estrutura

```
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
