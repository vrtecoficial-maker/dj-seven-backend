const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { GoogleGenAI } = require('@google/genai');
const yts = require('yt-search');

const app = express();
const upload = multer({ dest: 'uploads/' });
const ai = new GoogleGenAI();
const PORT = process.env.PORT || 3000;

const LIBRARY_DIR = path.join(__dirname, 'library');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('www'));
app.use('/library', express.static(LIBRARY_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

const ACTIVE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash'
];

const scanCache = new Map();

async function identifyCover(base64Image, mimeType) {
  const hash = crypto.createHash('md5').update(base64Image.slice(0, 1000)).digest('hex');
  if (scanCache.has(hash)) return scanCache.get(hash);

  const prompt = `Identifique exatamente este álbum de vinil e liste suas faixas originais.
Retorne ESTRITAMENTE em formato JSON:
{
  "artist": "Nome do Artista",
  "title": "Artista - Titulo",
  "sideA": [{"title": "Faixa 1", "performer": "Nome", "duration": "3:20"}],
  "sideB": [{"title": "Faixa 1 (Lado B)", "performer": "Nome", "duration": "3:20"}]
}`;

  for (const modelName of ACTIVE_MODELS) {
    try {
      console.log('[IA Consultando]:', modelName);
      const res = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType: mimeType } }] }],
        config: { responseMimeType: 'application/json' }
      });

      if (res && res.text) {
        let parsed = JSON.parse(res.text);
        let rawA = parsed.sideA || parsed.ladoA || parsed.tracks || [];
        let rawB = parsed.sideB || parsed.ladoB || [];

        if (rawB.length === 0 && rawA.length > 2) {
          const mid = Math.ceil(rawA.length / 2);
          rawB = rawA.slice(mid);
          rawA = rawA.slice(0, mid);
        }

        const formatTrack = (t, i) => ({
          title: typeof t === 'string' ? t : (t.title || t.name || `Faixa ${i + 1}`),
          performer: (typeof t === 'object' && t.performer) ? t.performer : parsed.artist,
          duration: (typeof t === 'object' && t.duration) ? t.duration : '3:30'
        });

        parsed.sideA = rawA.map((t, i) => formatTrack(t, i));
        parsed.sideB = rawB.map((t, i) => formatTrack(t, i));

        if (parsed.sideA.length === 0) parsed.sideA = [{ title: 'Faixa 1', performer: parsed.artist, duration: '3:30' }];
        if (parsed.sideB.length === 0) parsed.sideB = [{ title: 'Faixa 1 (Lado B)', performer: parsed.artist, duration: '3:30' }];

        scanCache.set(hash, parsed);
        return parsed;
      }
    } catch (e) {
      console.warn('[Aviso]', modelName, 'falhou:', e.message);
    }
  }

  throw new Error('Falha no reconhecimento da capa');
}

app.post('/api/scan', upload.single('cover'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Sem imagem' });
  const imagePath = req.file.path;

  try {
    fs.copyFileSync(imagePath, path.join(__dirname, 'last_scanned.jpg'));
    const imageBytes = fs.readFileSync(imagePath);
    const result = await identifyCover(imageBytes.toString('base64'), req.file.mimetype || 'image/jpeg');

    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    console.log('[Prensagem Identificada]:', result.title);
    res.json(result);
  } catch (error) {
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    console.error('[Erro no Scan]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

function makeSlug(name) {
  return (name || 'album')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Rota de entrega de áudio direta via pipe
app.get('/api/get-audio', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Query ausente');
  console.log('[Download Requisitado pelo App]:', query);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'audio/mpeg');

  try {
    const searchRes = await yts(query);
    const video = searchRes.videos && searchRes.videos[0];
    if (!video) {
      console.log('[Vídeo não encontrado]:', query);
      return res.status(404).send('Vídeo não encontrado');
    }

    const videoId = video.videoId;
    const ENDPOINTS = [
      `https://api.piped.privacy.com.de/streams/${videoId}`,
      `https://pipedapi.tokhmi.xyz/streams/${videoId}`,
      `https://pipedapi.kavin.rocks/streams/${videoId}`
    ];

    let resolvedStream = null;

    for (const url of ENDPOINTS) {
      try {
        const streamData = await new Promise((resolve, reject) => {
          const r = https.get(url, { timeout: 3500, headers: { 'User-Agent': 'Mozilla/5.0' } }, (resp) => {
            if (resp.statusCode !== 200) return reject(new Error('Status ' + resp.statusCode));
            let body = '';
            resp.on('data', d => body += d);
            resp.on('end', () => {
              try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
            });
          });
          r.on('timeout', () => { r.destroy(); reject(new Error('Timeout')); });
          r.on('error', reject);
        });

        const targetAudio = (streamData.audioStreams || []).find(s => s.url);
        if (targetAudio && targetAudio.url) {
          resolvedStream = targetAudio.url;
          break;
        }
      } catch (err) {}
    }

    if (!resolvedStream) {
      console.warn('[Falha nos endpoints de stream]:', query);
      return res.status(502).send('Streams indisponíveis');
    }

    const streamReq = https.get(resolvedStream, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (audioRes) => {
      audioRes.pipe(res);
    });

    streamReq.on('error', (e) => {
      console.error('[Erro no pipe]:', e.message);
      if (!res.headersSent) res.status(500).send(e.message);
    });

  } catch (err) {
    console.error('[Erro geral get-audio]:', err.message);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

app.post('/api/download-album', (req, res) => {
  try {
    const albumData = req.body;
    if (!albumData || !albumData.title) return res.status(400).json({ error: 'Dados inválidos' });

    const slug = makeSlug(albumData.slug || albumData.title);
    const albumFolder = path.join(LIBRARY_DIR, slug);
    if (!fs.existsSync(albumFolder)) fs.mkdirSync(albumFolder, { recursive: true });

    const lastCover = path.join(__dirname, 'last_scanned.jpg');
    if (fs.existsSync(lastCover)) {
      fs.copyFileSync(lastCover, path.join(albumFolder, 'cover.jpg'));
      albumData.cover = `/library/${slug}/cover.jpg`;
    }

    albumData.slug = slug;
    fs.writeFileSync(path.join(albumFolder, 'manifest.json'), JSON.stringify(albumData, null, 2));
    res.json({ success: true, slug: slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/library', (req, res) => {
  try {
    const albums = [];
    fs.readdirSync(LIBRARY_DIR).forEach(folder => {
      const p = path.join(LIBRARY_DIR, folder, 'manifest.json');
      if (fs.existsSync(p)) {
        try { albums.push(JSON.parse(fs.readFileSync(p, 'utf-8'))); } catch (e) {}
      }
    });
    res.json(albums);
  } catch (err) {
    res.status(500).json({ error: 'Erro na estante' });
  }
});

app.delete('/api/library/:slug', (req, res) => {
  try {
    const folderPath = path.join(LIBRARY_DIR, req.params.slug);
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Disco não encontrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Sem busca' });

  try {
    const results = await yts(query);
    const video = results.videos && results.videos[0];
    if (!video) return res.status(404).json({ error: 'Vídeo não encontrado' });

    res.json({
      title: video.title,
      videoId: video.videoId,
      thumbnail: video.thumbnail
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
