# ATENÇÃO: o contexto de build é a RAIZ do repositório, não a pasta backend.
# Está definido em docker-compose.yml (context: . / dockerfile: backend/Dockerfile),
# porque a imagem precisa das duas pastas: backend/ e front/public.
#
# O layout dentro da imagem espelha o repositório:
#   /app/backend/src/...  -> o código
#   /app/front/public/... -> a tela
# Isso é obrigatório porque app.js serve os arquivos estáticos a partir de
# ../../front/public, relativo a /app/backend/src.

FROM node:20-alpine

WORKDIR /app/backend

# Dependências primeiro: essa camada só é refeita quando package.json muda
COPY backend/package*.json ./
RUN npm install --omit=dev

# Código (node_modules e .env locais ficam de fora pelo .dockerignore)
COPY backend/ ./

# O front servido pelo próprio back-end
COPY front/public /app/front/public

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# "npm start" roda "node src/server.js".
# Não use "npm run dev" aqui: nodemon é de desenvolvimento e reinicia o processo sozinho.
CMD ["npm", "start"]
