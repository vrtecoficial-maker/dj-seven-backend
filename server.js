const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const upload = multer({ dest: 'uploads/' });
const ai = new GoogleGenAI();

const LIBRARY_DIR = path.join(__dirname, 'library');
if (!fs.existsSync(LIBRARY_DIR)) fs.mkdirSync(LIBRARY_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static('www'));
app.use('/library', express.static(LIBRARY_DIR));

const ACTIVE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.6-flash'
];

const scanCache = new Map();

async function identifyCover(base64Image, mimeType) {
  const hash = crypto.createHash('md5').update(base64Image.slice(0, 1000)).digest('hex');
  if (scanCache.has(hash)) return scanCache.get(hash);

  const prompt = `Analise este vinil. Identifique Artista e Album.
Retorne exclusivamente JSON:
{
  "artist": "Nome do Artista",
  "title": "Artista - Album",
  "sideA": [{"title": "Faixa 1", "performer": "Artista", "duration": "3:30"}],
  "sideB": [{"title": "Faixa 1", "performer": "Artista", "duration": "3:30"}]
}`;

  for (const modelName of ACTIVE_MODELS) {
    try {
      console.log('[IA] Consultando:', modelName);
      const res = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { data: base64Image, mimeType } }] }],
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
      console.warn('[Aviso]', modelName, 'instavel. Tentando backup...');
      await new Promise(r => setTimeout(r, 600));
    }
  }
  throw new Error('Falha no reconhecimento');
}

async function fetchArtworkArchive(query, artist) {
  try {
    const cleanAlbum = (query || '').replace(/[-_]/g, ' ').trim();
    const cleanArtist = (artist || '').trim();
    let q = 'release:' + encodeURIComponent('"' + cleanAlbum + '"');
    if (cleanArtist) q += ' AND artist:' + encodeURIComponent('"' + cleanArtist + '"');

    const mbRes = await axios.get('https://musicbrainz.org/ws/2/release/?query=' + q + '&fmt=json&limit=5', {
      headers: { 'User-Agent': 'VinylPlayer/1.1 (app@local.io)' }, timeout: 6000
    });
    const releases = mbRes.data.releases || [];
    let best = [];
    for (const rel of releases) {
      const relArtist = (rel['artist-credit'] && rel['artist-credit'][0] && rel['artist-credit'][0].name) || '';
      if (cleanArtist && !relArtist.toLowerCase().includes(cleanArtist.toLowerCase()) && !cleanArtist.toLowerCase().includes(relArtist.toLowerCase())) {
        continue;
      }
      try {
        const caa = await axios.get('https://coverartarchive.org/release/' + rel.id, { timeout: 5000 });
        if (caa.data && caa.data.images && caa.data.images.length > 0) {
          const imgs = caa.data.images.map(img => ({
            types: img.types || ['Encarte'],
            url: (img.thumbnails && (img.thumbnails['500'] || img.thumbnails['large'])) || img.image
          }));
          if (imgs.length > best.length) best = imgs;
        }
      } catch (e) {}
    }
    return best;
  } catch (err) {
    return [];
  }
}

async function downloadFile(url, destPath) {
  try {
    const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 12000 });
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  } catch (e) {}
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
    res.status(500).json({ error: error.message });
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
  } catch (err) { res.status(500).json({ error: 'Erro na estante' }); }
});

app.post('/api/download-album', async (req, res) => {
  const album = req.body;
  if (!album || !album.title) return res.status(400).json({ error: 'Dados ausentes' });
  const slug = album.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const targetDir = path.join(LIBRARY_DIR, slug);
  const audioDir = path.join(targetDir, 'audio');
  const artDir = path.join(targetDir, 'artwork');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  if (!fs.existsSync(artDir)) fs.mkdirSync(artDir, { recursive: true });
  res.json({ success: true, slug });

  console.log('[Estante] Baixando:', album.title);
  const cleanTitle = album.title.replace(album.artist || '', '').replace(/^-/, '').trim() || album.title;
  const arts = await fetchArtworkArchive(cleanTitle, album.artist);
  const localArtworks = [];

  for (let i = 0; i < arts.length; i++) {
    const dest = path.join(artDir, i + '.jpg');
    await downloadFile(arts[i].url, dest);
    if (fs.existsSync(dest)) localArtworks.push({ type: arts[i].types[0] || 'Encarte', path: '/library/' + slug + '/artwork/' + i + '.jpg' });
  }

  const userPhoto = path.join(__dirname, 'last_scanned.jpg');
  if (localArtworks.length === 0 && fs.existsSync(userPhoto)) {
    const userDest = path.join(artDir, 'front_user.jpg');
    fs.copyFileSync(userPhoto, userDest);
    localArtworks.push({ type: 'Capa (Scan Real)', path: '/library/' + slug + '/artwork/front_user.jpg' });
  }

  const allTracks = [
    ...(album.sideA || []).map((t, i) => ({ ...t, side: 'A', index: i })),
    ...(album.sideB || []).map((t, i) => ({ ...t, side: 'B', index: i }))
  ];
  for (const track of allTracks) {
    const file = track.side + '_' + (track.index + 1) + '_' + (track.title || 'faixa').replace(/[^a-z0-9]/gi, '_') + '.mp3';
    const dest = path.join(audioDir, file);
    if (!fs.existsSync(dest)) {
      const q = (track.performer || album.artist || '') + ' ' + (track.title || '') + ' audio original';
      console.log('[Baixando]:', track.title);
      await new Promise(resolve => {
        const p = spawn('./bin/yt-dlp', ['ytsearch1:' + q, '-x', '--audio-format', 'mp3', '--audio-quality', '128K', '-o', dest, '--no-playlist', '--quiet']);
        p.on('close', resolve); p.on('error', resolve);
      });
    }
    track.localUrl = '/library/' + slug + '/audio/' + file;
  }

  const defaultCover = localArtworks.length > 0 ? localArtworks[0].path : (album.art || '');
  const manifest = {
    slug,
    title: album.title,
    artist: album.artist,
    artworks: localArtworks,
    cover: defaultCover,
    sideA: allTracks.filter(t => t.side === 'A'),
    sideB: allTracks.filter(t => t.side === 'B')
  };
  fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('[Estante] Concluido:', album.title);
});

app.get('/api/stream', (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send('Query ausente');
  res.setHeader('Content-Type', 'audio/mpeg');
  const ytdlp = spawn('./bin/yt-dlp', ['ytsearch1:' + query, '-f', 'ba/b', '-o', '-', '--no-playlist', '--quiet']);
  const ffmpegProc = spawn('./bin/ffmpeg', ['-i', 'pipe:0', '-vn', '-acodec', 'libmp3lame', '-ac', '2', '-b:a', '128k', '-f', 'mp3', 'pipe:1']);
  ytdlp.stdin.on('error', () => {}); ytdlp.stdout.on('error', () => {});
  ffmpegProc.stdin.on('error', () => {}); ffmpegProc.stdout.on('error', () => {});
  ytdlp.stdout.pipe(ffmpegProc.stdin);
  ffmpegProc.stdout.pipe(res);
  const clean = () => { try { ytdlp.kill('SIGKILL'); } catch(e){} try { ffmpegProc.kill('SIGKILL'); } catch(e){} };
  req.on('close', clean); res.on('error', clean);
});


// Endpoint para adicionar páginas extras ao encarte manualmente (Whats/Galeria)
app.post('/api/add-booklet', upload.single('page'), (req, res) => {
  const slug = req.body.slug;
  if (!slug || !req.file) return res.status(400).json({ error: 'Dados ausentes' });

  const targetDir = path.join(LIBRARY_DIR, slug);
  const artDir = path.join(targetDir, 'artwork');
  const manifestPath = path.join(targetDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) return res.status(404).json({ error: 'Álbum não encontrado' });

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const newIndex = (manifest.artworks || []).length;
  const newFile = newIndex + '_manual.jpg';
  const destPath = path.join(artDir, newFile);

  fs.copyFileSync(req.file.path, destPath);
  if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

  const newArt = { type: 'Encarte / Verso', path: '/library/' + slug + '/artwork/' + newFile };
  manifest.artworks = manifest.artworks || [];
  manifest.artworks.push(newArt);

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log('[Encarte] Nova página adicionada a:', manifest.title);
  res.json({ success: true, artworks: manifest.artworks });
});


// Rota para excluir disco e liberar espaço no celular
app.delete('/api/library/:slug', (req, res) => {
  const slug = req.params.slug;
  if (!slug) return res.status(400).json({ error: 'Slug ausente' });
  const targetDir = path.join(LIBRARY_DIR, slug);
  if (fs.existsSync(targetDir)) {
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      console.log('[Estante] Disco apagado:', slug);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ error: 'Falha ao apagar disco' });
    }
  }
  res.status(404).json({ error: 'Disco não encontrado' });
});

app.listen(3000, () => console.log('Servidor ativo em http://localhost:3000'));
