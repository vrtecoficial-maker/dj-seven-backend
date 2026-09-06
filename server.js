const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Garante pastas necessárias
const libraryDir = path.join(__dirname, 'library');
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(libraryDir)) fs.mkdirSync(libraryDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Pastas estáticas
app.use(express.static(path.join(__dirname, 'www')));
app.use('/library', express.static(libraryDir));
app.use('/uploads', express.static(uploadsDir));

// Rota da Estante: listar discos
app.get('/api/library', (req, res) => {
  try {
    const files = fs.readdirSync(libraryDir).filter(f => f.endsWith('.json'));
    const items = files.map(file => {
      try {
        const raw = fs.readFileSync(path.join(libraryDir, file), 'utf8');
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }).filter(Boolean);
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota da Estante: apagar disco
app.delete('/api/library/:slug', (req, res) => {
  try {
    const slug = req.params.slug;
    const filePath = path.join(libraryDir, `${slug}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return res.json({ success: true });
    }
    res.status(404).json({ error: 'Disco não encontrado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota de busca rápida do YouTube
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Informe a busca' });

  try {
    const results = await yts(query);
    const video = results.videos && results.videos[0];

    if (!video) {
      return res.status(404).json({ error: 'Nenhum vídeo encontrado' });
    }

    res.json({
      title: video.title,
      videoId: video.videoId,
      thumbnail: video.thumbnail
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
