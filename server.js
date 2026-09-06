const express = require('express');
const play = require('play-dl');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando no YouTube via play-dl: ${query}`);

  try {
    const searchResults = await play.search(query, { limit: 1 });
    if (!searchResults || !searchResults.length) {
      return res.status(404).send('Nenhum vídeo encontrado');
    }

    const video = searchResults[0];
    console.log(`[Stream] Encontrado: ${video.title} (${video.url})`);

    const stream = await play.stream(video.url, { quality: 2 });

    res.setHeader('Content-Type', 'audio/mpeg');
    stream.stream.pipe(res);

    req.on('close', () => {
      if (stream.stream && !stream.stream.destroyed) {
        stream.stream.destroy();
      }
    });

  } catch (err) {
    console.error(`[Erro no Stream] ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send('Erro ao processar áudio: ' + err.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
