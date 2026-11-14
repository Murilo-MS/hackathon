# Usa uma imagem leve do Node
FROM node:20-alpine

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia os arquivos de dependência
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o resto do código do projeto
COPY . .

# Expõe a porta (ajuste se o backend de vocês usar outra, ex: 3000)
EXPOSE 3000

# Comando para iniciar o backend (ajuste se no package.json o script for "start" em vez de "dev")
CMD ["npm", "run", "dev"]
