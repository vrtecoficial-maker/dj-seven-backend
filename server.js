const express = require('express');
const cors = require('cors');
const path = require('path');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Entrega os arquivos visuais do app (HTML, CSS, JS) na raiz
app.use(express.static(path.join(__dirname, 'www')));

// Rota de busca do YouTube
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

// Qualquer outra rota abre o index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
