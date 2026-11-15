// Onde o arquivo da foto é guardado.
//
// Dois modos, escolhidos pelo ambiente:
//   S3_* configurado  -> envia para o bucket da organização (caminho do edital, RF07)
//   sem S3            -> grava em UPLOADS_DIR e serve por /uploads (modo de emergência
//                        para a demo, quando o bucket ainda não existe)
//
// O banco guarda apenas a URL (item_photos.storage_url), em qualquer um dos modos.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const EXTENSOES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const pastaLocal = () =>
  process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');

const usaS3 = () =>
  Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );

function nomeDoArquivo(mimetype) {
  const extensao = EXTENSOES[mimetype] || 'bin';
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${extensao}`;
}

async function enviarLocal(buffer, mimetype) {
  const pasta = pastaLocal();
  await fs.mkdir(pasta, { recursive: true });
  const nome = nomeDoArquivo(mimetype);
  await fs.writeFile(path.join(pasta, nome), buffer);
  return `/uploads/${nome}`;
}

async function enviarS3(buffer, mimetype) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

  const cliente = new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: Boolean(process.env.S3_ENDPOINT),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  const chave = `leilao/${nomeDoArquivo(mimetype)}`;
  await cliente.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: chave,
      Body: buffer,
      ContentType: mimetype,
    })
  );

  if (process.env.S3_PUBLIC_URL) {
    return `${process.env.S3_PUBLIC_URL.replace(/\/$/, '')}/${chave}`;
  }
  if (process.env.S3_ENDPOINT) {
    return `${process.env.S3_ENDPOINT.replace(/\/$/, '')}/${process.env.S3_BUCKET}/${chave}`;
  }
  const regiao = process.env.S3_REGION || 'us-east-1';
  return `https://${process.env.S3_BUCKET}.s3.${regiao}.amazonaws.com/${chave}`;
}

async function enviar(buffer, mimetype) {
  return usaS3() ? enviarS3(buffer, mimetype) : enviarLocal(buffer, mimetype);
}

module.exports = { enviar, usaS3, pastaLocal };
