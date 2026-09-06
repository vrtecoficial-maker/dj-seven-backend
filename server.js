const express = require('express');
const { Innertube, UniversalCache } = require('youtubei.js');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

let yt = null;

async function getYouTube() {
  if (!yt) {
    yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true,
      client_type: 'ANDROID'
    });
  }
  return yt;
}

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando no YouTube: ${query}`);

  try {
    const youtube = await getYouTube();
    const search = await youtube.search(query, { type: 'video' });

    if (!search.videos || !search.videos.length) {
      return res.status(404).send('Nenhum vídeo encontrado');
    }

    const video = search.videos[0];
    console.log(`[Stream] Reproduzindo: ${video.title.text} (${video.id})`);

    const stream = await youtube.download(video.id, {
      type: 'audio',
      quality: 'best',
      client: 'ANDROID'
    });

    res.setHeader('Content-Type', 'audio/mp4');

    const nodeStream = Readable.fromWeb(stream);
    nodeStream.pipe(res);

    req.on('close', () => {
      if (nodeStream.destroy) nodeStream.destroy();
    });

  } catch (err) {
    console.error(`[Erro no Stream] ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send('Erro ao buscar ou extrair áudio: ' + err.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
