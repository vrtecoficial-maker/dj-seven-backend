let currentAlbum = null;
let currentTrackIndex = 0;
let currentSide = 'A';
let isPlaying = false;
let currentPlaylist = [];

document.addEventListener('DOMContentLoaded', () => {
  initUI();
  loadLibrary();
});

function initUI() {
  const btnScan = document.getElementById('btn-upload');
  const coverInput = document.getElementById('cover-input');
  const btnPlay = document.getElementById('btn-play');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  const tabSideA = document.getElementById('tab-side-a');
  const tabSideB = document.getElementById('tab-side-b');
  const btnModeVinyl = document.getElementById('btn-mode-vinyl');
  const btnModeCD = document.getElementById('btn-mode-cd');
  const btnBooklet = document.getElementById('btn-view-booklet');
  const btnCloseBooklet = document.getElementById('btn-close-booklet');

  if (btnScan && coverInput) {
    btnScan.addEventListener('click', () => coverInput.click());
    coverInput.addEventListener('change', handleCoverScan);
  }

  if (btnPlay) btnPlay.addEventListener('click', togglePlay);
  if (btnPrev) btnPrev.addEventListener('click', prevTrack);
  if (btnNext) btnNext.addEventListener('click', nextTrack);

  if (tabSideA) tabSideA.addEventListener('click', () => switchSide('A'));
  if (tabSideB) tabSideB.addEventListener('click', () => switchSide('B'));

  if (btnModeVinyl) btnModeVinyl.addEventListener('click', () => setMode('vinyl'));
  if (btnModeCD) btnModeCD.addEventListener('click', () => setMode('cd'));

  if (btnBooklet) btnBooklet.addEventListener('click', openBooklet);
  if (btnCloseBooklet) btnCloseBooklet.addEventListener('click', closeBooklet);

  // Criação do elemento de áudio nativo para gerenciar background e Media Session
  let audioPlayer = document.getElementById('native-audio-element');
  if (!audioPlayer) {
    audioPlayer = document.createElement('audio');
    audioPlayer.id = 'native-audio-element';
    audioPlayer.addEventListener('ended', nextTrack);
    document.body.appendChild(audioPlayer);
  }

  // Configuração da Media Session para manter o player ativo na tela de bloqueio do Android
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', function() {
      const audioEl = document.getElementById('native-audio-element');
      if (audioEl) audioEl.play();
      isPlaying = true;
      if (btnPlay) btnPlay.textContent = '⏸';
    });
    navigator.mediaSession.setActionHandler('pause', function() {
      const audioEl = document.getElementById('native-audio-element');
      if (audioEl) audioEl.pause();
      isPlaying = false;
      if (btnPlay) btnPlay.textContent = '▶';
    });
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack);
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack);
  }
}

function updateLockScreenMeta(title, artist, coverUrl) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: title || 'DJ SEVEN',
      artist: artist || 'Vinil Original',
      album: currentAlbum ? currentAlbum.title : 'Acervo Exclusivo',
      artwork: [
        { src: coverUrl || '/uploads/last_scanned.jpg', sizes: '512x512', type: 'image/jpeg' }
      ]
    });
  }
}

function setMode(mode) {
  const vinylView = document.getElementById('vinyl-view');
  const cdView = document.getElementById('cd-view');
  const btnVinyl = document.getElementById('btn-mode-vinyl');
  const btnCD = document.getElementById('btn-mode-cd');

  if (mode === 'vinyl') {
    if (vinylView) vinylView.classList.remove('hidden');
    if (cdView) cdView.classList.add('hidden');
    if (btnVinyl) btnVinyl.classList.add('active');
    if (btnCD) btnCD.classList.remove('active');
  } else {
    if (vinylView) vinylView.classList.add('hidden');
    if (cdView) cdView.classList.remove('hidden');
    if (btnCD) btnCD.classList.add('active');
    if (btnVinyl) btnVinyl.classList.remove('active');
  }
}

async function handleCoverScan(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('cover', file);

  updateStatus('Digitalizando capa com IA...', 'Analisando prensagem e faixas originais');

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      body: formData
    });
    const albumData = await res.json();

    if (albumData.error) throw new Error(albumData.error);

    loadAlbumToDeck(albumData);
    loadLibrary();
  } catch (err) {
    console.error('Erro ao escanear:', err);
    alert('Falha ao processar capa: ' + err.message);
    updateStatus('Nenhum disco no prato', 'Aguardando seleção');
  }
}

function loadAlbumToDeck(album) {
  currentAlbum = album;
  currentTrackIndex = 0;
  currentSide = 'A';

  const titleEl = document.getElementById('current-title');
  const artistEl = document.getElementById('current-artist');
  if (titleEl) titleEl.textContent = album.title || album.album;
  if (artistEl) artistEl.textContent = album.artist || 'Artista Desconhecido';

  renderTracklist();
  playCurrentTrack();
}

function switchSide(side) {
  currentSide = side;
  currentTrackIndex = 0;
  renderTracklist();
  playCurrentTrack();
}

function renderTracklist() {
  if (!currentAlbum) return;
  const listContainer = document.getElementById('tracklist-items');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  const tracks = currentSide === 'A' ? (currentAlbum.sideA || []) : (currentAlbum.sideB || []);
  const tabA = document.getElementById('tab-side-a');
  const tabB = document.getElementById('tab-side-b');

  if (currentSide === 'A') {
    if (tabA) tabA.classList.add('active');
    if (tabB) tabB.classList.remove('active');
  } else {
    if (tabB) tabB.classList.add('active');
    if (tabA) tabA.classList.remove('active');
  }

  const sideIndicator = document.getElementById('current-side');
  if (sideIndicator) {
    sideIndicator.textContent = `LADO ${currentSide} • FAIXA ${currentTrackIndex + 1}`;
  }

  tracks.forEach((track, idx) => {
    const li = document.createElement('li');
    li.className = 'track-item' + (idx === currentTrackIndex ? ' playing' : '');
    const trackName = typeof track === 'string' ? track : (track.title || `Faixa ${idx + 1}`);
    li.innerHTML = `<span>${idx + 1}. ${trackName}</span>`;
    li.addEventListener('click', () => {
      currentTrackIndex = idx;
      renderTracklist();
      playCurrentTrack();
    });
    listContainer.appendChild(li);
  });
}

function playCurrentTrack() {
  if (!currentAlbum) return;
  const tracks = currentSide === 'A' ? (currentAlbum.sideA || []) : (currentAlbum.sideB || []);
  const trackObj = tracks[currentTrackIndex];
  if (!trackObj) return;

  const trackName = typeof trackObj === 'string' ? trackObj : trackObj.title;
  const performer = (typeof trackObj === 'object' && trackObj.performer) ? trackObj.performer : currentAlbum.artist;
  
  const query = `${performer} ${trackName} audio`;
  updateStatus(trackName, `${performer} • Carregando áudio...`);

  const audioPlayer = document.getElementById('native-audio-element');
  if (audioPlayer) {
    audioPlayer.src = `/api/get-audio?q=${encodeURIComponent(query)}`;
    audioPlayer.play()
      .then(() => {
        isPlaying = true;
        const playBtn = document.getElementById('btn-play');
        if (playBtn) playBtn.textContent = '⏸';
        updateStatus(trackName, `${performer} • Tocando`);
        updateLockScreenMeta(trackName, performer, currentAlbum.cover);
      })
      .catch(err => {
        console.warn('Bloqueio de autoplay do navegador:', err);
        isPlaying = false;
        const playBtn = document.getElementById('btn-play');
        if (playBtn) playBtn.textContent = '▶';
        updateStatus(trackName, `${performer} • Toque em Play`);
      });
  }
}

function togglePlay() {
  if (!currentAlbum) {
    fetch('/api/library')
      .then(res => res.json())
      .then(library => {
        if (library.length > 0) {
          loadAlbumToDeck(library[0]);
        } else {
          alert('Escaneie uma capa de disco primeiro!');
        }
      });
    return;
  }

  const audioPlayer = document.getElementById('native-audio-element');
  if (!audioPlayer) return;

  if (isPlaying) {
    audioPlayer.pause();
    isPlaying = false;
    const playBtn = document.getElementById('btn-play');
    if (playBtn) playBtn.textContent = '▶';
  } else {
    audioPlayer.play()
      .then(() => {
        isPlaying = true;
        const playBtn = document.getElementById('btn-play');
        if (playBtn) playBtn.textContent = '⏸';
      })
      .catch(() => {
        playCurrentTrack();
      });
  }
}

function nextTrack() {
  if (!currentAlbum) return;
  const tracks = currentSide === 'A' ? (currentAlbum.sideA || []) : (currentAlbum.sideB || []);
  if (currentTrackIndex < tracks.length - 1) {
    currentTrackIndex++;
    renderTracklist();
    playCurrentTrack();
  } else if (currentSide === 'A' && (currentAlbum.sideB || []).length > 0) {
    switchSide('B');
  }
}

function prevTrack() {
  if (!currentAlbum) return;
  if (currentTrackIndex > 0) {
    currentTrackIndex--;
    renderTracklist();
    playCurrentTrack();
  }
}

function updateStatus(title, artist) {
  const titleEl = document.getElementById('current-title');
  const artistEl = document.getElementById('current-artist');
  if (titleEl) titleEl.textContent = title;
  if (artistEl) artistEl.textContent = artist;
}

async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    const library = await res.json();
    const shelfGrid = document.getElementById('shelf-items');
    if (!shelfGrid) return;
    shelfGrid.innerHTML = '';

    const countVinyl = document.getElementById('count-vinyl');
    const countCD = document.getElementById('count-cd');
    if (countVinyl) countVinyl.textContent = library.length;
    if (countCD) countCD.textContent = '0';

    library.forEach((album) => {
      const card = document.createElement('div');
      card.className = 'shelf-card';
      card.innerHTML = `
        <img src="${album.cover || '/uploads/last_scanned.jpg'}" alt="${album.title}">
        <div class="shelf-card-info">
          <h4>${album.title}</h4>
          <p>${album.artist}</p>
        </div>
      `;
      card.addEventListener('click', () => {
        loadAlbumToDeck(album);
      });
      shelfGrid.appendChild(card);
    });

    if (library.length > 0 && !currentAlbum) {
      loadAlbumToDeck(library[0]);
    }
  } catch (e) {
    console.error('Erro ao carregar estante:', e);
  }
}

function openBooklet() {
  if (!currentAlbum) {
    alert('Nenhum álbum selecionado.');
    return;
  }
  const titleEl = document.getElementById('booklet-title');
  const artistEl = document.getElementById('booklet-artist');
  const labelEl = document.getElementById('booklet-label');
  const imgEl = document.getElementById('booklet-display-img');
  const textEl = document.getElementById('booklet-content-text');

  if (titleEl) titleEl.textContent = currentAlbum.title;
  if (artistEl) artistEl.textContent = currentAlbum.artist;
  if (labelEl) labelEl.textContent = 'Prensagem Original Analisada por IA';
  if (imgEl) imgEl.src = currentAlbum.cover || '/uploads/last_scanned.jpg';
  
  if (textEl) {
    textEl.innerHTML = `
      <h3>Lado A:</h3>
      <p>${(currentAlbum.sideA || []).map((t, i) => `${i+1}. ${t.title || t}`).join('<br>')}</p>
      <hr>
      <h3>Lado B:</h3>
      <p>${(currentAlbum.sideB || []).map((t, i) => `${i+1}. ${t.title || t}`).join('<br>')}</p>
    `;
  }
  const modal = document.getElementById('booklet-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeBooklet() {
  const modal = document.getElementById('booklet-modal');
  if (modal) modal.classList.add('hidden');
}
