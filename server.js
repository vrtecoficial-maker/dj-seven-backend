const express = require('express');
const ytdl = require('@distube/ytdl-core');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando: ${query}`);

  try {
    const searchResults = await yts(query);
    const video = searchResults.videos && searchResults.videos[0];

    if (!video || !video.url) {
      return res.status(404).send('Nenhum vídeo encontrado');
    }

    console.log(`[Stream] Encontrado: ${video.title} (${video.url})`);

    res.setHeader('Content-Type', 'audio/mpeg');

    const stream = ytdl(video.url, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    });

    stream.on('error', (err) => {
      console.error(`[Erro ytdl]: ${err.message}`);
      if (!res.headersSent) res.status(500).send(err.message);
    });

    stream.pipe(res);

    req.on('close', () => {
      stream.destroy();
    });

  } catch (err) {
    console.error(`[Erro no Stream] ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send('Erro ao buscar vídeo: ' + err.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
