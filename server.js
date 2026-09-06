const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

process.env.PATH = path.join(process.cwd(), 'bin') + ':' + process.env.PATH;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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

  console.log(`[Stream] Buscando: ${query}`);

  try {
    const searchUrl = `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(query)}&filter=all`;
    let searchData = await fetchJson(searchUrl).catch(() => null);

    let videoId = null;
    if (searchData && searchData.items) {
      const item = searchData.items.find(i => i.type === 'video' || i.url);
      if (item) videoId = (item.url || '').replace('/watch?v=', '');
    }

    if (!videoId) {
      // Fallback para Invidious se Piped oscilar
      const invData = await fetchJson(`https://inv.nadeko.net/api/v1/search?q=${encodeURIComponent(query)}`);
      const item = invData.find(i => i.type === 'video');
      if (item) videoId = item.videoId;
    }

    if (!videoId) throw new Error('Vídeo não encontrado');

    const streamInfo = await fetchJson(`https://pipedapi.kavin.rocks/streams/${videoId}`);
    const audioStream = streamInfo.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audioStream || !audioStream.url) throw new Error('Fluxo de áudio indisponível');

    console.log(`[Stream] Reproduzindo videoId: ${videoId}`);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    const ffmpegProc = spawn('ffmpeg', [
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-i', audioStream.url,
      '-vn',
      '-f', 'mp3',
      '-acodec', 'libmp3lame',
      '-ab', '128k',
      '-'
    ]);

    ffmpegProc.stdout.pipe(res);

    ffmpegProc.stderr.on('data', d => console.log(`[ffmpeg] ${d.toString()}`));
    req.on('close', () => ffmpegProc.kill());

  } catch (err) {
    console.error(`[Erro no Stream] ${err.message}`);
    res.status(500).send('Erro ao processar áudio: ' + err.message);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
