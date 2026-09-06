const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
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

// Helper para sanitizar slug
function makeSlug(name) {
  return (name || 'album')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Download em segundo plano das músicas via yt-dlp
async function downloadTracksInBackground(albumData, albumFolder, slug) {
  console.log(`[Download Offline Iniciado]: ${albumData.title}`);
  const allTracks = [
    ...(albumData.sideA || []).map((t, i) => ({ ...t, side: 'A', index: i })),
    ...(albumData.sideB || []).map((t, i) => ({ ...t, side: 'B', index: i }))
  ];

  for (const track of allTracks) {
    const filename = `track_${track.side}_${track.index + 1}.mp3`;
    const targetPath = path.join(albumFolder, filename);

    if (fs.existsSync(targetPath)) {
      track.localUrl = `/library/${slug}/${filename}`;
      continue;
    }

    try {
      const query = `${track.performer || albumData.artist} ${track.title} audio original`;
      const searchRes = await yts(query);
      const video = searchRes.videos && searchRes.videos[0];

      if (video && video.url) {
        console.log(`[Baixando Faixa Lado ${track.side} - ${track.title}]...`);
        await new Promise((resolve) => {
          exec(`yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${targetPath}" "${video.url}"`, (err) => {
            if (!err && fs.existsSync(targetPath)) {
              track.localUrl = `/library/${slug}/${filename}`;
              console.log(`[Faixa Salva]: ${filename}`);
            } else {
              console.warn(`[Falha download]: ${track.title}`);
            }
            resolve();
          });
        });
      }
    } catch (e) {
      console.error(`[Erro ao buscar faixa offline]:`, e.message);
    }
  }

  // Atualiza o manifest.json com os links locais prontos
  fs.writeFileSync(path.join(albumFolder, 'manifest.json'), JSON.stringify(albumData, null, 2));
  console.log(`[Álbum Completo Pronto para Modo Offline]: ${albumData.title}`);
}

// Rota de Baixar Álbum Completo para Estante
app.post('/api/download-album', (req, res) => {
  try {
    const albumData = req.body;
    if (!albumData || !albumData.title) return res.status(400).json({ error: 'Dados inválidos' });

    const slug = makeSlug(albumData.slug || albumData.title);
    const albumFolder = path.join(LIBRARY_DIR, slug);
    if (!fs.existsSync(albumFolder)) fs.mkdirSync(albumFolder, { recursive: true });

    // Salva a capa principal
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

    // Inicia download offline dos MP3s em segundo plano
    downloadTracksInBackground(albumData, albumFolder, slug);

    res.json({ success: true, slug: slug });
  } catch (e) {
    console.error('[Erro em download-album]:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Rota para adicionar páginas do encarte / contracapa
app.post('/api/add-booklet', upload.single('page'), (req, res) => {
  try {
    const { slug } = req.body;
    if (!slug || !req.file) return res.status(400).json({ error: 'Dados incompletos' });

    const albumFolder = path.join(LIBRARY_DIR, slug);
    const manifestPath = path.join(albumFolder, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({ error: 'Álbum não encontrado na Estante' });
    }

    const album = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (!album.artworks) album.artworks = [];

    const pageFileName = `booklet_${Date.now()}.jpg`;
    const targetFile = path.join(albumFolder, pageFileName);
    fs.copyFileSync(req.file.path, targetFile);
    fs.unlinkSync(req.file.path);

    const relativeUrl = `/library/${slug}/${pageFileName}`;
    album.artworks.push(relativeUrl);

    fs.writeFileSync(manifestPath, JSON.stringify(album, null, 2));
    console.log(`[Nova Página de Encarte Adicionada]: ${relativeUrl}`);

    res.json({ success: true, artworks: album.artworks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listagem da Estante
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

// Exclusão da Estante
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

// Busca no YouTube (modo online streaming)
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Informe a busca' });

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
