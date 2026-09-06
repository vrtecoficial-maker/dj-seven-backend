const express = require('express');
const cors = require('cors');
const yts = require('yt-search');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Informe a busca' });

  console.log(`[Busca] Procurando: ${query}`);

  try {
    const results = await yts(query);
    const video = results.videos && results.videos[0];

    if (!video) {
      return res.status(404).json({ error: 'Nenhum vídeo encontrado' });
    }

    console.log(`[Sucesso] Encontrado: ${video.title} (${video.videoId})`);
    
    res.json({
      title: video.title,
      videoId: video.videoId,
      thumbnail: video.thumbnail
    });
  } catch (err) {
    console.error(`[Erro na busca]: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de busca rodando na porta ${PORT}`);
});
