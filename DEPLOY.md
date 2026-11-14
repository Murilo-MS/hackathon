# Deploy e teste na VM

**Regra do trabalho: o sistema responde na porta 8080.** Fora dela, a avaliação não acha a aplicação.

## Caminho 1 — direto com Node (mais rápido para testar)

```bash
cd ~/hackathon
git pull
cd backend
npm install
cat .env          # precisa ter PORT=8080
npm start
```

Se o `.env` não existir ou estiver com outra porta:

```bash
cat > .env <<EOF
PORT=8080
JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
JWT_EXPIRES_IN=1h
EOF
```

Teste, em outro terminal da VM:

```bash
curl http://localhost:8080/health
curl -s http://localhost:8080/auctions
BASE_URL=http://127.0.0.1:8080 node scripts/verificar-api.js
```

O último comando precisa terminar com `20 verificações ok, 0 falha(s)`.

## Caminho 2 — Docker Compose

```bash
cd ~/hackathon
docker compose down          # derruba o que estiver da versão antiga (porta 3000)
docker compose up -d --build
docker compose logs -f backend
```

O container escuta na 8080 e o compose publica `8080:8080`. O front vai dentro da imagem
(o contexto de build é a raiz do repositório, e não só a pasta `backend`).

```bash
curl http://localhost:8080/health
docker compose ps
```

Para parar: `docker compose down`. Para reconstruir depois de mudar código:
`docker compose up -d --build`.

## Ver no navegador, do seu PC

A VM não publica a 8080 na internet (só a 8020, que é SSH). Use um túnel:

```powershell
ssh -p 8020 -L 8080:127.0.0.1:8080 ubuntu@200.18.99.113
```

Depois abra `http://localhost:8080`.

## Checklist do que deve funcionar

1. `GET /health` responde `{"status":"ok",...}`.
2. A tela de leilões abre em `http://localhost:8080/` (lista vazia no começo é normal).
3. Criar conta, publicar um leilão, abrir o detalhe.
4. Duas contas em janelas diferentes: um lance aparece na outra aba sem recarregar.
5. Leilão com duração de 1 minuto: ao zerar, muda para "encerrado" e mostra o vencedor.

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| Abre na 3000 | `.env` com `PORT=3000` ou compose antigo | corrija o `.env` para 8080 e rode `docker compose down` |
| `Cannot find module 'socket.io'` | falta `npm install` depois do pull | `npm install` |
| `EADDRINUSE 8080` | processo antigo na porta | `sudo ss -ltnp \| grep 8080`, mate o PID |
| `GET /` devolve 404 | subiu só `backend` como contexto no build | use `docker compose up -d --build` |
| Página abre sem estilo | arquivo `style.css` fora de `front/public` | confira que existe `front/public/style.css` |
| `port is already allocated` | container antigo na 3000/8080 | `docker ps`, `docker compose down` |
