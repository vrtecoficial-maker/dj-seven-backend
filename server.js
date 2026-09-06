const express = require('express');
const ytdl = require('@distube/ytdl-core');
const ytsr = require('ytsr');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

process.env.PATH = path.join(process.cwd(), 'bin') + ':' + process.env.PATH;

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando: ${query}`);

  try {
    const filters = await ytsr.getFilters(query);
    const filterVideo = filters.get('Type').get('Video');
    const searchResults = await ytsr(filterVideo.url, { limit: 1 });

    if (!searchResults.items.length) {
      return res.status(404).send('Nenhum resultado encontrado');
    }

    const videoUrl = searchResults.items[0].url;
    console.log(`[Stream] Reproduzindo: ${videoUrl}`);

    res.setHeader('Content-Type', 'audio/mpeg');

    ytdl(videoUrl, {
      filter: 'audioonly',
      quality: 'highestaudio',
      highWaterMark: 1 << 25
    }).pipe(res);

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
