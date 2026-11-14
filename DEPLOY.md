# Deploy e teste na VM

**Regra do trabalho: o sistema responde na porta 8080.** Fora dela, a avaliação não acha a aplicação.

O estado (usuários, leilões, lances) vive no PostgreSQL. Reiniciar o servidor não perde nada.

## Caminho 1 — direto com Node

```bash
cd ~/hackathon
git pull
cd backend
npm install

# 1. variáveis de ambiente
cp .env.example .env        # ou edite o .env existente
#    PORT=8080 e DATABASE_URL apontando para o banco

# 2. banco de pé (só o serviço do banco, sem ocupar a 8080)
docker compose up -d db

# 3. schema + dados de demonstração (idempotente)
npm run db:setup
npm run db:dados            # contas demo: carlos@demo.com ... senha123

# 4. servidor
npm start
```

Teste, em outro terminal da VM:

```bash
curl http://localhost:8080/health
curl -s http://localhost:8080/auctions | head -c 300
BASE_URL=http://127.0.0.1:8080 npm run verificar
```

O último comando precisa terminar com `30 verificações ok, 0 falha(s)`.

## Caminho 2 — Docker Compose (aplicação + banco juntos)

```bash
cd ~/hackathon
docker compose down
docker compose up -d --build
docker compose ps

# primeira vez: criar as tabelas dentro do container
docker compose exec backend npm run db:setup
docker compose exec backend npm run db:dados     # opcional (dados de demonstração)

curl http://localhost:8080/health
docker compose logs -f backend
```

O container escuta na 8080 e o compose publica `8080:8080`. O `DATABASE_URL` já aponta
para o serviço `db` dentro da rede do compose.

## Ver no navegador, do seu PC

A 8080 está publicada no IP da VM. Se estiver bloqueada, use o túnel:

```powershell
ssh -p 8020 -L 8080:127.0.0.1:8080 ubuntu@200.18.99.113
```

Depois abra `http://localhost:8080` (ou `http://200.18.99.113:8080`).

## Prova de que persiste (é o que a banca vai testar)

1. Crie uma conta e publique um leilão.
2. Reinicie o servidor: `Ctrl+C` e `npm start` (ou `docker compose restart backend`).
3. Recarregue a página: a conta continua logada e o leilão continua lá.

Se quiser ver direto no banco:

```bash
docker compose exec db psql -U hackathon_user -d leilao_db -c "SELECT display_name, email FROM users;"
docker compose exec db psql -U hackathon_user -d leilao_db -c "SELECT status, current_price, ends_at FROM auctions;"
```

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| `DATABASE_URL ausente` | falta no `.env` | copie de `.env.example` |
| `Não foi possível falar com o PostgreSQL` | banco fora ou URL errada | `docker compose up -d db`, confira host/porta |
| `relation "users" does not exist` | schema não aplicado | `npm run db:setup` |
| `Cannot find module 'socket.io'` | falta `npm install` | `npm install` |
| `EADDRINUSE 8080` | processo antigo | `sudo ss -ltnp \| grep 8080` |
| Abre na 3000 | compose antigo ou `.env` com 3000 | `docker compose down` e corrija o `.env` |
| Login diz "sessão inválida" depois de trocar `JWT_SECRET` | tokens antigos | faça login de novo |
