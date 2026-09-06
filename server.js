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

  console.log(`[Stream] Buscando: ${query}`);

  try {
    const searchResults = await yts(query);
    const video = searchResults.videos && searchResults.videos[0];

    if (!video || !video.videoId) {
      return res.status(404).send('Nenhum vídeo encontrado');
    }

    console.log(`[Stream] Encontrado: ${video.title} (${video.videoId})`);

    const youtube = await getYouTube();

    // Clientes que não exigem login em servidores
    const clientsToTry = ['TV_EMBEDDED', 'ANDROID_VR', 'IOS', 'ANDROID'];
    let stream = null;

    for (const clientName of clientsToTry) {
      try {
        console.log(`[Stream] Tentando cliente: ${clientName}...`);
        const info = await youtube.getInfo(video.videoId, clientName);
        stream = await info.download({
          type: 'audio',
          quality: 'best'
        });
        if (stream) {
          console.log(`[Stream] Sucesso usando cliente: ${clientName}`);
          break;
        }
      } catch (errClient) {
        console.log(`[Cliente ${clientName} falhou]: ${errClient.message}`);
      }
    }

    if (!stream) {
      throw new Error('Nenhum cliente conseguiu decodificar o áudio sem login');
    }

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
