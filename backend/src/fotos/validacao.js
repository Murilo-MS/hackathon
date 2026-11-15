// Validação das fotos enviadas (RF05/RF07), sem dependência de HTTP ou disco,
// para poder ser testada isoladamente.

const regras = require('../auctions/regras');

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB por foto
const MAX_ARQUIVOS = 6;

// Confere os primeiros bytes: extensão e Content-Type podem mentir, o conteúdo não.
function pareceImagem(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return true;
  }
  // WEBP: "RIFF" .... "WEBP"
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return true;
  }
  return false;
}

function validarArquivos(arquivos) {
  if (!Array.isArray(arquivos) || arquivos.length === 0) {
    throw regras.erro(400, 'Envie pelo menos uma foto', 'FOTOS_OBRIGATORIAS');
  }
  if (arquivos.length > MAX_ARQUIVOS) {
    throw regras.erro(400, `Máximo de ${MAX_ARQUIVOS} fotos por envio`, 'FOTOS_DEMAIS');
  }

  for (const arquivo of arquivos) {
    if (!TIPOS_ACEITOS.includes(arquivo.mimetype)) {
      throw regras.erro(400, 'Formato não aceito. Use JPG, PNG ou WEBP.', 'FOTO_TIPO');
    }
    if (arquivo.size > MAX_BYTES) {
      throw regras.erro(413, 'Cada foto pode ter no máximo 5 MB', 'FOTO_GRANDE');
    }
    if (!pareceImagem(arquivo.buffer)) {
      throw regras.erro(400, 'O arquivo enviado não parece uma imagem válida', 'FOTO_INVALIDA');
    }
  }

  return arquivos;
}

module.exports = { TIPOS_ACEITOS, MAX_BYTES, MAX_ARQUIVOS, pareceImagem, validarArquivos };
