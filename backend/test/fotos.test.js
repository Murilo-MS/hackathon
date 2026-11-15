process.env.JWT_SECRET = 'segredo-de-teste';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://teste:teste@127.0.0.1:5432/teste';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { pareceImagem, validarArquivos, MAX_BYTES, MAX_ARQUIVOS } = require('../src/fotos/validacao');
const armazenamento = require('../src/fotos/armazenamento');

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);
const texto = Buffer.from('isto nao e uma imagem, e sim um arquivo de texto');

const arquivo = (buffer, mimetype = 'image/jpeg', size = buffer.length) => ({
  mimetype,
  size,
  buffer,
  originalname: 'foto.jpg',
});

test('reconhece imagem pelos primeiros bytes, não pela extensão', () => {
  assert.strictEqual(pareceImagem(jpeg), true);
  assert.strictEqual(pareceImagem(png), true);
  assert.strictEqual(pareceImagem(webp), true);
  assert.strictEqual(pareceImagem(texto), false);
  assert.strictEqual(pareceImagem(Buffer.from([0xff])), false);
});

test('validação de fotos: quantidade, tipo, tamanho e conteúdo', () => {
  assert.throws(() => validarArquivos([]), /pelo menos uma foto/i);
  assert.throws(() => validarArquivos(new Array(MAX_ARQUIVOS + 1).fill(arquivo(jpeg))), /Máximo de/i);
  assert.throws(() => validarArquivos([arquivo(texto, 'text/plain')]), /Formato não aceito/i);
  assert.throws(
    () => validarArquivos([arquivo(jpeg, 'image/jpeg', MAX_BYTES + 1)]),
    /no máximo 5 MB/i
  );
  assert.throws(() => validarArquivos([arquivo(texto, 'image/jpeg')]), /não parece uma imagem/i);

  const ok = validarArquivos([arquivo(jpeg), arquivo(png, 'image/png'), arquivo(webp, 'image/webp')]);
  assert.strictEqual(ok.length, 3);
});

test('armazenamento local grava o arquivo e devolve URL /uploads', async () => {
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), 'fotos-teste-'));
  const anterior = process.env.UPLOADS_DIR;
  process.env.UPLOADS_DIR = pasta;

  try {
    const url = await armazenamento.enviar(jpeg, 'image/jpeg');
    assert.match(url, /^\/uploads\/[0-9]+-[0-9a-f]+\.jpg$/);

    const nome = url.replace('/uploads/', '');
    const gravado = await fs.readFile(path.join(pasta, nome));
    assert.strictEqual(gravado.length, jpeg.length);
    assert.strictEqual(armazenamento.usaS3(), false);
  } finally {
    if (anterior === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = anterior;
    await fs.rm(pasta, { recursive: true, force: true });
  }
});
