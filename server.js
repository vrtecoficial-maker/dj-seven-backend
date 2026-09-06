const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

// flash-lite responde em 2 segundos e sem fila 503
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
Retorne ESTRITAMENTE em formato JSON com a seguinte estrutura:
{
  "artist": "Nome do Artista",
  "title": "Artista - Nome do Album",
  "sideA": [
    {"title": "Nome da Faixa 1", "performer": "Nome do Artista", "duration": "3:20"},
    {"title": "Nome da Faixa 2", "performer": "Nome do Artista", "duration": "3:40"}
  ],
  "sideB": [
    {"title": "Nome da Faixa 1 Lado B", "performer": "Nome do Artista", "duration": "3:15"}
  ]
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

        // Garante suporte se a IA responder sideA, tracks ou ladoA
        let rawA = parsed.sideA || parsed.ladoA || parsed.tracks || [];
        let rawB = parsed.sideB || parsed.ladoB || [];

        // Se veio apenas um array com todas as faixas, divide metade no Lado A e metade no Lado B
        if (rawB.length === 0 && rawA.length > 2) {
          const mid = Math.ceil(rawA.length / 2);
          rawB = rawA.slice(mid);
          rawA = rawA.slice(0, mid);
        }

        const formatTrack = (t, i, side) => {
          let trackName = typeof t === 'string' ? t : (t.title || t.name || `Faixa ${i + 1}`);
          let performer = typeof t === 'object' && t.performer ? t.performer : parsed.artist;
          let duration = typeof t === 'object' && t.duration ? t.duration : '3:30';
          return { title: trackName, performer: performer, duration: duration };
        };

        parsed.sideA = rawA.map((t, i) => formatTrack(t, i, 'A'));
        parsed.sideB = rawB.map((t, i) => formatTrack(t, i, 'B'));

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
    console.log('[Prensagem Identificada]:', result.title, `(${result.sideA.length} faixas lado A, ${result.sideB.length} faixas lado B)`);
    res.json(result);
  } catch (error) {
    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    console.error('[Erro no Scan]:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper de slug
function makeSlug(name) {
  return (name || 'album')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Salvar na Estante
function saveToShelf(albumData) {
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
  return slug;
}

app.post('/api/download-album', (req, res) => {
  try {
    const slug = saveToShelf(req.body);
    console.log('[Estante Guardado]:', slug);
    res.json({ success: true, slug: slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/library', (req, res) => {
  try {
    const slug = saveToShelf(req.body);
    res.json({ success: true, slug: slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ler Estante
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

// Deletar da Estante
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

// Rota de busca no YouTube
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

// Rota para extração direta de áudio para download offline
app.get('/api/audio-stream', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Query ausente');
  try {
    const searchRes = await yts(query);
    const video = searchRes.videos && searchRes.videos[0];
    if (!video) return res.status(404).send('Vídeo não encontrado');

    const streamUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="track.mp3"`);

    const proc = exec(`yt-dlp -o - -f bestaudio "${streamUrl}"`);
    proc.stdout.pipe(res);
    proc.stderr.on('data', (d) => console.log('[yt-dlp]:', d.toString()));
  } catch (err) {
    res.status(500).send(err.message);
  }
});
