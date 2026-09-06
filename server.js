const express = require('express');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchJson(res.headers.location));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getWorkingInstances() {
  try {
    const list = await fetchJson('https://api.invidious.io/instances.json?sort_by=health,api');
    return list
      .filter(entry => entry[1] && entry[1].type === 'https' && entry[1].api)
      .map(entry => entry[1].uri || `https://${entry[0]}`);
  } catch (err) {
    return [
      'https://inv.nadeko.net',
      'https://invidious.nerdvpn.de',
      'https://vid.puffyan.us'
    ];
  }
}

app.get('/api/stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Informe o parâmetro q');

  console.log(`[Stream] Buscando no YouTube: ${query}`);

  const instances = await getWorkingInstances();
  let audioUrl = null;

  for (const base of instances) {
    try {
      const searchRes = await fetchJson(`${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
      if (!Array.isArray(searchRes) || searchRes.length === 0) continue;

      const videoId = searchRes[0].videoId;
      console.log(`[Stream] Encontrado em ${base}: ${searchRes[0].title} (${videoId})`);

      const videoData = await fetchJson(`${base}/api/v1/videos/${videoId}`);
      const audioStreams = videoData.adaptiveFormats ? 
        videoData.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/')) : [];

      if (audioStreams.length > 0) {
        audioStreams.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
        audioUrl = audioStreams[0].url;
      } else if (videoData.formatStreams && videoData.formatStreams.length > 0) {
        audioUrl = videoData.formatStreams[0].url;
      }

      if (audioUrl) {
        if (audioUrl.startsWith('/')) audioUrl = `${base}${audioUrl}`;
        break;
      }
    } catch (e) {
      console.log(`[Pular ${base}]: ${e.message}`);
    }
  }

  if (!audioUrl) {
    return res.status(502).send('Nenhuma instância conseguiu entregar o áudio.');
  }

  res.setHeader('Content-Type', 'audio/mpeg');
  
  const client = audioUrl.startsWith('https') ? https : http;
  client.get(audioUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (streamRes) => {
    streamRes.pipe(res);
  }).on('error', (err) => {
    console.error(`[Erro pipe]: ${err.message}`);
    if (!res.headersSent) res.status(500).send(err.message);
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
