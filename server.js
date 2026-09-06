const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

const INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://vid.puffyan.us',
  'https://invidious.jing.rocks'
];

function getJson(url) {
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

  let audioUrl = null;

  for (const base of INSTANCES) {
    try {
      const searchRes = await getJson(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
      if (!searchRes || !searchRes.length) continue;

      const videoId = searchRes[0].videoId;
      console.log(`[Stream] Encontrado: ${searchRes[0].title} (${videoId}) em ${base}`);

      const videoData = await getJson(`${base}/api/v1/videos/${videoId}`);
      const audioStreams = videoData.adaptiveFormats ? 
        videoData.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/')) : [];

      if (audioStreams.length > 0) {
        audioStreams.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
        audioUrl = audioStreams[0].url;
      } else if (videoData.formatStreams && videoData.formatStreams.length > 0) {
        audioUrl = videoData.formatStreams[0].url;
      }

      if (audioUrl) break;
    } catch (e) {
      console.log(`[Falha em ${base}]: ${e.message}, tentando próxima...`);
    }
  }

  if (!audioUrl) {
    return res.status(502).send('Não foi possível obter o stream de áudio.');
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  
  const client = audioUrl.startsWith('https') ? https : http;
  client.get(audioUrl, (streamRes) => {
    streamRes.pipe(res);
  }).on('error', (err) => {
    console.error(`[Erro pipe]: ${err.message}`);
    if (!res.headersSent) res.status(500).send(err.message);
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
