const express = require('express');
const https = require('https');
const http = require('http');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(data);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 10000
    };

    const req = (parsed.protocol === 'https:' ? https : http).request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

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

    console.log(`[Stream] Encontrado: ${video.title} (${video.url})`);

    // Cobalt API pública
    const cobaltInstances = [
      'https://api.cobalt.tools/api/json',
      'https://cobalt-backend.mayanklabs.com/api/json'
    ];

    let audioDirectUrl = null;

    for (const endpoint of cobaltInstances) {
      try {
        console.log(`[Cobalt] Tentando: ${endpoint}`);
        const data = await postJson(endpoint, {
          url: video.url,
          isAudioOnly: true,
          aFormat: 'mp3'
        });

        if (data && data.url) {
          audioDirectUrl = data.url;
          break;
        }
      } catch (err) {
        console.log(`[Cobalt falhou em ${endpoint}]: ${err.message}`);
      }
    }

    if (!audioDirectUrl) {
      return res.status(502).send('Falha ao obter stream via Cobalt');
    }

    console.log(`[Stream] Redirecionando áudio para stream...`);
    
    // Redireciona diretamente o áudio para o cliente tocar instantaneamente
    res.redirect(audioDirectUrl);

  } catch (err) {
    console.error(`[Erro Geral]: ${err.message}`);
    if (!res.headersSent) res.status(500).send('Erro: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
