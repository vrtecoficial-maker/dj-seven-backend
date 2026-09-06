const express = require('express');
const https = require('https');
const http = require('http');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

const MIRRORS = [
  'https://invidious.asir.dev',
  'https://yt.drgnz.club',
  'https://invidious.projectsegfau.lt',
  'https://iv.ggtyler.dev'
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 7000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando no YouTube: ${query}`);

  try {
    const searchResults = await yts(query);
    const video = searchResults.videos && searchResults.videos[0];

    if (!video || !video.videoId) {
      return res.status(404).send('Vídeo não encontrado');
    }

    const videoId = video.videoId;
    console.log(`[Stream] Vídeo: ${video.title} (${videoId})`);

    let streamUrl = null;

    for (const mirror of MIRRORS) {
      try {
        console.log(`[Stream] Testando mirror: ${mirror}`);
        const data = await fetchJson(`${mirror}/api/v1/videos/${videoId}`);
        const audios = data.adaptiveFormats ? data.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/')) : [];
        
        if (audios.length > 0) {
          const target = audios[0];
          // Constrói URL direta com proxy local do mirror para evitar 429
          streamUrl = target.url.startsWith('http') ? target.url : `${mirror}${target.url}`;
          console.log(`[Stream] URL obtida via ${mirror}`);
          break;
        }
      } catch (err) {
        console.log(`[Mirror falhou]: ${err.message}`);
      }
    }

    if (!streamUrl) {
      return res.status(502).send('Falha ao obter link de áudio pelos mirrors');
    }

    res.setHeader('Content-Type', 'audio/mp4');
    
    const client = streamUrl.startsWith('https') ? https : http;
    client.get(streamUrl, (pipeRes) => {
      pipeRes.pipe(res);
    }).on('error', (err) => {
      console.error(`[Erro no Pipe]: ${err.message}`);
      if (!res.headersSent) res.status(500).send(err.message);
    });

  } catch (err) {
    console.error(`[Erro Geral]: ${err.message}`);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
