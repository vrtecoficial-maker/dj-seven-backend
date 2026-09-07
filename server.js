const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
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

// Rota de Scan
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

// Download com redirecionamento
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status HTTP: ${res.statusCode}`));
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve(true);
      });
      fileStream.on('error', reject);
    }).on('error', reject);
  });
}

// Servidores Piped API
const PIPED_SERVERS = [
  'https://api.piped.privacy.com.de',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.kavin.rocks',
  'https://api-piped.mha.fi'
];

async function getAudioStreamUrl(videoId) {
  for (const server of PIPED_SERVERS) {
    try {
      const endpoint = `${server}/streams/${videoId}`;
      const json = await new Promise((resolve, reject) => {
        https.get(endpoint, { timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.statusCode !== 200) return reject(new Error('Status ' + res.statusCode));
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });

      const audio = (json.audioStreams || []).find(s => s.url);
      if (audio && audio.url) return audio.url;
    } catch (e) {}
  }
  throw new Error('Serviço de stream indisponível no momento');
}

async function downloadTrackAudio(query, destPath) {
  const searchRes = await yts(query);
  const video = searchRes.videos && searchRes.videos[0];
  if (!video) throw new Error('Vídeo não encontrado para ' + query);

  const audioUrl = await getAudioStreamUrl(video.videoId);
  return await downloadFile(audioUrl, destPath);
}

// Rota de stream direto para o celular baixar individualmente

app.get('/api/get-audio', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Query ausente');
  console.log('[Download Requisitado pelo App]:', query);

  try {
    const searchRes = await yts(query);
    const video = searchRes.videos && searchRes.videos[0];
    if (!video) return res.status(404).send('Vídeo não encontrado');

    const PIPED_APIS = [
      'https://api.piped.privacy.com.de',
      'https://pipedapi.tokhmi.xyz',
      'https://pipedapi.kavin.rocks',
      'https://api-piped.mha.fi'
    ];

    for (const base of PIPED_APIS) {
      try {
        const streamData = await new Promise((resolve, reject) => {
          https.get(base + '/streams/' + video.videoId, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
            if (r.statusCode !== 200) return reject(new Error('Status ' + r.statusCode));
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => {
              try { resolve(JSON.parse(d)); } catch(e) { reject(e); }
            });
          }).on('error', reject);
        });

        const audio = (streamData.audioStreams || []).find(s => s.url);
        if (audio && audio.url) {
          console.log('[Stream Encontrado via Piped]: Redirecionando áudio');
          return res.redirect(audio.url);
        }
      } catch (e) {}
    }

    res.status(502).send('Streams ocupados');
  } catch (err) {
    console.error('[Erro get-audio]:', err.message);
    res.status(500).send(err.message);
  }
});
  }).catch(e => {
    console.error(e);
    if (!res.headersSent) res.status(500).send(e.message);
  });
});


// Download do disco
async function processAlbumDownload(albumData, albumFolder, slug) {
  const allTracks = [
    ...(albumData.sideA || []).map((t, idx) => ({ track: t, side: 'A', num: idx + 1 })),
    ...(albumData.sideB || []).map((t, idx) => ({ track: t, side: 'B', num: idx + 1 }))
  ];

  console.log(`[Iniciando Download Completo Offline]: ${albumData.title}`);

  for (const item of allTracks) {
    const fileName = `track_${item.side}_${item.num}.mp3`;
    const filePath = path.join(albumFolder, fileName);

    if (!fs.existsSync(filePath)) {
      try {
        const q = `${item.track.performer || albumData.artist} ${item.track.title} audio original`;
        console.log(`[Baixando Faixa Lado ${item.side} Faixa ${item.num}]: ${item.track.title}...`);
        await downloadTrackAudio(q, filePath);
        console.log(`[Baixado]: ${fileName}`);
      } catch (err) {
        console.warn(`[Falha no áudio da faixa ${item.track.title}]:`, err.message);
      }
    }

    if (fs.existsSync(filePath)) {
      item.track.localUrl = `/library/${slug}/${fileName}`;
    }
  }

  fs.writeFileSync(path.join(albumFolder, 'manifest.json'), JSON.stringify(albumData, null, 2));
  console.log(`[Sucesso: Disco 100% Offline]: ${albumData.title}`);
}

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

    if (!albumData.artworks) albumData.artworks = [];
    if (albumData.cover && !albumData.artworks.includes(albumData.cover)) {
      albumData.artworks.push(albumData.cover);
    }

    albumData.slug = slug;
    fs.writeFileSync(path.join(albumFolder, 'manifest.json'), JSON.stringify(albumData, null, 2));

    processAlbumDownload(albumData, albumFolder, slug);
    res.json({ success: true, slug: slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/add-booklet', upload.single('page'), (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug || !req.file) return res.status(400).json({ error: 'Dados incompletos' });

    const albumFolder = path.join(LIBRARY_DIR, slug);
    const manifestPath = path.join(albumFolder, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: 'Disco não encontrado' });

    const album = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!album.artworks) album.artworks = [];

    const pageName = `booklet_${Date.now()}.jpg`;
    fs.copyFileSync(req.file.path, path.join(albumFolder, pageName));
    fs.unlinkSync(req.file.path);

    album.artworks.push(`/library/${slug}/${pageName}`);
    fs.writeFileSync(manifestPath, JSON.stringify(album, null, 2));

    res.json({ success: true, artworks: album.artworks });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
