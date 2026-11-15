const express = require('express');
const multer = require('multer');
const { exigirLogin } = require('../auth/middleware');
const armazenamento = require('./armazenamento');
const { MAX_ARQUIVOS, MAX_BYTES, validarArquivos } = require('./validacao');

const router = express.Router();

// memoryStorage: o arquivo fica na memória só durante a requisição.
// Em memória porque o destino final é o bucket (ou o diretório configurado),
// nunca um arquivo temporário solto no disco da VM.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: MAX_ARQUIVOS },
});

// POST /fotos  (multipart/form-data, campo "fotos", até 6 arquivos)
router.post('/', exigirLogin, upload.array('fotos', MAX_ARQUIVOS), async (req, res) => {
  const arquivos = validarArquivos(req.files);
  const urls = [];
  for (const arquivo of arquivos) {
    urls.push(await armazenamento.enviar(arquivo.buffer, arquivo.mimetype));
  }
  res.status(201).json({ urls });
});

// Erros do multer (arquivo grande, campos demais) viram resposta clara
router.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError) {
    if (erro.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ erro: 'Cada foto pode ter no máximo 5 MB' });
    }
    if (erro.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ erro: `Máximo de ${MAX_ARQUIVOS} fotos por envio` });
    }
    return res.status(400).json({ erro: erro.message });
  }
  next(erro);
});

module.exports = router;
