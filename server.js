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

// 3.7-flash responde em 4 segundos e sem fila 503
const ACTIVE_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite'
];

const scanCache = new Map();

async function identifyCover(base64Image, mimeType) {
  const hash = crypto.createHash('md5').update(base64Image.slice(0, 1000)).digest('hex');
  if (scanCache.has(hash)) return scanCache.get(hash);

  const prompt = `Analise este vinil. Identifique Artista e Álbum.
Retorne exclusivamente JSON:
{
  "artist": "Nome do Artista",
  "title": "Artista - Album",
  "sideA": [{"title": "Faixa 1", "performer": "Artista", "duration": "3:30"}],
  "sideB": [{"title": "Faixa 1", "performer": "Artista", "duration": "3:30"}]
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
        const fix = (arr) => (Array.isArray(arr) ? arr : []).map((t, i) => {
          if (typeof t === 'string') return { title: t, performer: parsed.artist, duration: '3:30' };
          return {
            title: t.title || t.name || ('Faixa ' + (i + 1)),
            performer: t.performer || parsed.artist,
            duration: t.duration || '3:30'
          };
        });

        parsed.sideA = fix(parsed.sideA);
        parsed.sideB = fix(parsed.sideB);

        if (parsed.sideA.length === 0) parsed.sideA = [{ title: 'Faixa 1', performer: parsed.artist, duration: '3:30' }];
        if (parsed.sideB.length === 0) parsed.sideB = [{ title: 'Faixa 1 (Lado B)', performer: parsed.artist, duration: '3:30' }];

        scanCache.set(hash, parsed);
        return parsed;
      }
    } catch (e) {
      console.warn('[Aviso]', modelName, 'falhou. Tentando backup...', e.message);
      await new Promise(r => setTimeout(r, 300));
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

// Salvar na estante
function saveAlbumToLibrary(albumData) {
  const slug = (albumData.slug || albumData.title || 'album')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const albumFolder = path.join(LIBRARY_DIR, slug);
  if (!fs.existsSync(albumFolder)) fs.mkdirSync(albumFolder, { recursive: true });

  const lastCover = path.join(__dirname, 'last_scanned.jpg');
  if (fs.existsSync(lastCover)) {
    fs.copyFileSync(lastCover, path.join(albumFolder, 'cover.jpg'));
    albumData.coverUrl = `/library/${slug}/cover.jpg`;
  }

  albumData.slug = slug;
  fs.writeFileSync(path.join(albumFolder, 'manifest.json'), JSON.stringify(albumData, null, 2));
  return slug;
}

app.post('/api/download-album', (req, res) => {
  try {
    const slug = saveAlbumToLibrary(req.body);
    console.log('[Estante Guardado]:', slug);
    res.json({ success: true, slug: slug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/library', (req, res) => {
  try {
    const slug = saveAlbumToLibrary(req.body);
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

// Busca no YouTube
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Informe a busca' });

  console.log('[YouTube Buscando]:', query);
  try {
    const results = await yts(query);
    const video = results.videos && results.videos[0];
    if (!video) return res.status(404).json({ error: 'Vídeo não encontrado' });

    console.log('[YouTube Encontrado]:', video.title, '(' + video.videoId + ')');
    res.json({
      title: video.title,
      videoId: video.videoId,
      thumbnail: video.thumbnail
    });
  } catch (err) {
    console.error('[YouTube Erro]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
