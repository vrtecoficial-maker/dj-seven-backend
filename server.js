const express = require('express');
const { Innertube, UniversalCache } = require('youtubei.js');
const yts = require('yt-search');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;

let yt = null;

async function getYouTube() {
  if (!yt) {
    yt = await Innertube.create({
      cache: new UniversalCache(false),
      generate_session_locally: true
    });
  }
  return yt;
}

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando no YouTube: ${query}`);

  try {
    // Busca nativa sem quebra de headers
    const searchResults = await yts(query);
    const video = searchResults.videos && searchResults.videos[0];

    if (!video || !video.videoId) {
      return res.status(404).send('Nenhum vídeo encontrado');
    }

    console.log(`[Stream] Encontrado: ${video.title} (${video.videoId})`);

    const youtube = await getYouTube();
    
    // Baixa o áudio diretamente pelo ID
    const stream = await youtube.download(video.videoId, {
      type: 'audio',
      quality: 'best'
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
      res.status(500).send('Erro ao processar áudio: ' + err.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
