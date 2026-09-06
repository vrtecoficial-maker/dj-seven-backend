const express = require('express');
const ytstream = require('yt-stream');
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
      return res.status(404).send('Vídeo não encontrado');
    }

    console.log(`[Stream] Encontrado: ${video.title} (${video.videoId})`);

    const stream = await ytstream.stream(video.url, {
      quality: 'high',
      type: 'audio',
      highWaterMark: 1048576 * 32,
      download: true
    });

    res.setHeader('Content-Type', 'audio/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    stream.stream.pipe(res);

    req.on('close', () => {
      if (stream.stream && stream.stream.destroy) {
        stream.stream.destroy();
      }
    });

  } catch (err) {
    console.error(`[Erro no Stream]: ${err.message}`);
    if (!res.headersSent) res.status(500).send('Erro ao processar áudio: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
