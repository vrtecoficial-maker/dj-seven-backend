let albumData = {
  artist: "",
  title: "PRATO VAZIO",
  art: "",
  artworks: [],
  sideA: [],
  sideB: []
};

let currentSide = 'A';
let currentTrackIndex = 0;
let isPlaying = false;
let isScanning = false;
let currentBookletIndex = 0;

// Ângulos reais da Pioneer PL-530
const ANGLE_REST = 0;        // No descanso lateral
const ANGLE_OUTER = 27;    // Primeira borda do vinil
const ANGLE_INNER = 48;    // Borda do selo central

const flipBtn = document.getElementById('flipBtn');
const playBtn = document.getElementById('playBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const tonearm = document.getElementById('tonearm');
const vinylFlipper = document.getElementById('vinylFlipper');
const mainDisc = document.getElementById('mainDisc');
const vinylLabel = document.getElementById('vinylLabel');
const sideTagText = document.getElementById('sideTagText');
const groovesOverlay = document.getElementById('groovesOverlay');
const trackListEl = document.getElementById('trackList');
const sideLabelEl = document.getElementById('sideLabel');
const trackStatusEl = document.getElementById('trackStatus');
const albumTitleEl = document.getElementById('albumTitle');

const btnOpenCam = document.getElementById('btnOpenCam');
const btnOpenGallery = document.getElementById('btnOpenGallery');
const btnOpenShelf = document.getElementById('btnOpenShelf');
const btnOpenBooklet = document.getElementById('btnOpenBooklet');
const btnDownloadAlbum = document.getElementById('btnDownloadAlbum');
const cameraFile = document.getElementById('cameraFile');
const galleryFile = document.getElementById('galleryFile');
const audioPlayer = document.getElementById('audioNative');

const shelfModal = document.getElementById('shelfModal');
const closeShelfBtn = document.getElementById('closeShelfBtn');
const shelfGrid = document.getElementById('shelfGrid');
const bookletModal = document.getElementById('bookletModal');
const closeBookletBtn = document.getElementById('closeBookletBtn');
const bookletImg = document.getElementById('bookletImg');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageCounter = document.getElementById('pageCounter');
const btnAddPage = document.getElementById('btnAddPage');
const bookletFileInput = document.getElementById('bookletFileInput');

function updateCoverArt(url) {
  vinylLabel.style.backgroundImage = 'url("' + url + '")';
}

function setTonearmAngle(deg, smooth = true) {
  tonearm.style.transition = smooth ? 'transform 0.5s ease-out' : 'none';
  tonearm.style.transform = 'rotate(' + deg + 'deg)';
}

function renderGrooves(tracks) {
  groovesOverlay.innerHTML = '';
  const total = tracks ? tracks.length : 1;
  (tracks || []).forEach((_, idx) => {
    const ring = document.createElement('div');
    ring.className = 'groove-ring';
    const sizePercent = 94 - (idx * (48 / Math.max(total, 1)));
    ring.style.width = sizePercent + '%';
    ring.style.height = sizePercent + '%';
    ring.addEventListener('click', (e) => {
      e.stopPropagation();
      playTrack(idx);
    });
    groovesOverlay.appendChild(ring);
  });
}

function renderTracklist() {
  const tracks = currentSide === 'A' ? albumData.sideA : albumData.sideB;
  sideLabelEl.textContent = 'FAIXAS • LADO ' + currentSide;
  sideTagText.textContent = 'LADO ' + currentSide;
  trackListEl.innerHTML = '';

  if (!tracks || tracks.length === 0) {
    trackListEl.innerHTML = '<li class="track-empty-hint">Nenhum disco carregado.<br>Toque em <b>Escanear Capa</b> ou escolha na <b>Estante de Discos</b> para começar!</li>';
    return;
  }

  tracks.forEach((track, idx) => {
    const li = document.createElement('li');
    li.className = 'track-item ' + (idx === currentTrackIndex ? 'active' : '');
    const title = track.title || track.name || ('Faixa ' + (idx + 1));
    const singer = track.performer ? ' <small style="opacity:0.65;">(' + track.performer + ')</small>' : '';
    li.innerHTML = '<span>' + (idx + 1) + '. ' + title + singer + '</span><span>' + (track.duration || '3:30') + '</span>';
    li.addEventListener('click', () => playTrack(idx));
    trackListEl.appendChild(li);
  });
}

function playTrack(index) {
  const tracks = currentSide === 'A' ? albumData.sideA : albumData.sideB;
  if (!tracks || !tracks[index]) return;

  currentTrackIndex = index;
  const track = tracks[currentTrackIndex];
  const name = track.title || track.name || 'Faixa';

  albumTitleEl.textContent = albumData.title;
  trackStatusEl.innerHTML = '<span class="needle-icon">●</span> SINTONIZANDO: ' + name;
  renderTracklist();

  // Posiciona a agulha no início físico da faixa no disco
  const totalTracks = tracks.length;
  const trackStartFraction = currentTrackIndex / totalTracks;
  const startAngle = ANGLE_OUTER + (trackStartFraction * (ANGLE_INNER - ANGLE_OUTER));
  setTonearmAngle(startAngle, true);

  mainDisc.classList.add('rotating');

  if (track.localUrl) {
    audioPlayer.src = track.localUrl;
  } else {
    const who = track.performer || albumData.artist;
    const cleanSearch = who + ' ' + name + ' audio original';
    audioPlayer.src = '/api/stream?q=' + encodeURIComponent(cleanSearch);
  }

  audioPlayer.play().then(() => {
    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> TOCANDO: ' + name;
    isPlaying = true;
    playBtn.textContent = '⏸';
  }).catch(() => {
    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> PRONTO • TOQUE NO PLAY';
    isPlaying = false;
    playBtn.textContent = '▶';
  });
}

function pauseTrack() {
  audioPlayer.pause();
  setTonearmAngle(ANGLE_REST, true);
  mainDisc.classList.remove('rotating');
  isPlaying = false;
  playBtn.textContent = '▶';
}

function nextTrack() {
  const tracks = currentSide === 'A' ? albumData.sideA : albumData.sideB;
  if (currentTrackIndex < tracks.length - 1) playTrack(currentTrackIndex + 1);
  else {
    pauseTrack();
    setTonearmAngle(ANGLE_REST, true);
    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> FIM DO LADO ' + currentSide + ' • VIRE O DISCO';
  }
}

// MOVIMENTO CONTÍNUO E REALISTA DA AGULHA DURANTE A MÚSICA
audioPlayer.addEventListener('timeupdate', () => {
  if (!isPlaying || !audioPlayer.duration) return;
  const tracks = currentSide === 'A' ? albumData.sideA : albumData.sideB;
  const totalTracks = tracks.length;

  const trackFraction = audioPlayer.currentTime / audioPlayer.duration;
  const currentGlobalProgress = (currentTrackIndex + trackFraction) / totalTracks;

  // Interpolação angular fluida entre a borda externa e o selo central
  const currentAngle = ANGLE_OUTER + (currentGlobalProgress * (ANGLE_INNER - ANGLE_OUTER));
  setTonearmAngle(currentAngle, false);
});

playBtn.addEventListener('click', () => {
  if (isPlaying) pauseTrack();
  else playTrack(currentTrackIndex);
});

// Giro 3D sem perder arte
flipBtn.addEventListener('click', () => {
  pauseTrack();
  vinylFlipper.classList.remove('flipping');
  void vinylFlipper.offsetWidth;
  vinylFlipper.classList.add('flipping');

  setTimeout(() => {
    currentSide = (currentSide === 'A') ? 'B' : 'A';
    currentTrackIndex = 0;
    flipBtn.querySelector('.switch-lbl').textContent = (currentSide === 'A') ? 'Virar Lado (Lado B)' : 'Virar Lado (Lado A)';
    sideTagText.textContent = 'LADO ' + currentSide;
    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> LADO ' + currentSide + ' PRONTO';
    renderGrooves(currentSide === 'A' ? albumData.sideA : albumData.sideB);
    renderTracklist();
  }, 350);
});

nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', () => {
  if (currentTrackIndex > 0) playTrack(currentTrackIndex - 1);
});
audioPlayer.addEventListener('ended', nextTrack);

function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = (h * maxDim) / w; w = maxDim; }
        else if (h > maxDim) { w = (w * maxDim) / h; h = maxDim; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleImageFile(file) {
  if (!file || isScanning) return;
  isScanning = true;
  const localUrl = URL.createObjectURL(file);
  updateCoverArt(localUrl);
  trackStatusEl.innerHTML = '<span class="needle-icon">●</span> IDENTIFICANDO PRENSAGEM...';

  const optimizedBlob = await compressImage(file);
  const formData = new FormData();
  formData.append('cover', optimizedBlob, 'cover.jpg');

  try {
    const res = await fetch('/api/scan', { method: 'POST', body: formData });
    if (!res.ok) throw new Error('Erro de resposta');
    const data = await res.json();

    albumData.artist = data.artist || data.title.split('-')[0].trim();
    albumData.title = data.title;
    albumData.sideA = data.sideA;
    albumData.sideB = data.sideB;
    albumData.artworks = [];
    albumData.slug = null;

    albumTitleEl.textContent = albumData.title;
    currentSide = 'A';
    currentTrackIndex = 0;
    flipBtn.querySelector('.switch-lbl').textContent = 'Lado B';

    renderGrooves(albumData.sideA);
    renderTracklist();

    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> DISCO NO PRATO • TOQUE NO PLAY';
    playTrack(0);
  } catch (err) {
    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> SERVIDOR OCUPADO • TENTE NOVAMENTE';
  } finally {
    isScanning = false;
    cameraFile.value = '';
    galleryFile.value = '';
  }
}

btnOpenCam.addEventListener('click', () => cameraFile.click());
btnOpenGallery.addEventListener('click', () => galleryFile.click());
cameraFile.addEventListener('change', (e) => handleImageFile(e.target.files[0]));
galleryFile.addEventListener('change', (e) => handleImageFile(e.target.files[0]));

btnDownloadAlbum.addEventListener('click', async () => {
  trackStatusEl.innerHTML = '<span class="needle-icon">●</span> BAIXANDO PARA A ESTANTE...';
  try {
    const res = await fetch('/api/download-album', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(albumData)
    });
    const result = await res.json();
    albumData.slug = result.slug;
    alert('Álbum e encartes sendo guardados na sua Estante!');
  } catch (e) {
    trackStatusEl.innerHTML = '<span class="needle-icon">●</span> FALHA AO SALVAR ÁLBUM';
  }
});

async function loadShelf() {
  try {
    const res = await fetch('/api/library');
    const albums = await res.json();
    shelfGrid.innerHTML = '';

    if (!albums || albums.length === 0) {
      shelfGrid.innerHTML = '<p class="empty-msg">Sua coleção está vazia.<br>Toque em 💾 Salvar no toca-discos!</p>';
      return;
    }

    albums.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'shelf-card';
      card.innerHTML = `
        <div class="shelf-thumb" style="background-image: url('${item.cover}');"></div>
        <div class="shelf-meta">
          <div class="shelf-details">
            <div class="shelf-name">${item.title}</div>
            <span class="shelf-tag">Offline Pronto</span>
          </div>
          <button class="btn-delete-album" title="Apagar Disco da Estante">🗑️</button>
        </div>
      `;

      const playAction = () => {
        albumData = item;
        updateCoverArt(item.cover);
        albumTitleEl.textContent = item.title;
        currentSide = 'A';
        currentTrackIndex = 0;
        flipBtn.querySelector('.switch-lbl').textContent = 'Lado B';
        renderGrooves(albumData.sideA);
        renderTracklist();
        shelfModal.classList.remove('active');
        playTrack(0);
      };

      card.querySelector('.shelf-thumb').addEventListener('click', playAction);
      card.querySelector('.shelf-details').addEventListener('click', playAction);

      card.querySelector('.btn-delete-album').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Deseja apagar definitivamente o disco "${item.title}" da sua estante e liberar espaço no celular?`)) {
          try {
            const delRes = await fetch('/api/library/' + item.slug, { method: 'DELETE' });
            if (delRes.ok) loadShelf();
            else alert('Erro ao apagar o disco');
          } catch (err) {
            alert('Falha na comunicação com o servidor');
          }
        }
      });

      shelfGrid.appendChild(card);
    });
  } catch (e) {
    shelfGrid.innerHTML = '<p class="empty-msg">Erro ao ler estante.</p>';
  }
}

btnOpenShelf.addEventListener('click', () => {
  shelfModal.classList.add('active');
  loadShelf();
});

closeShelfBtn.addEventListener('click', () => shelfModal.classList.remove('active'));

btnOpenBooklet.addEventListener('click', () => {
  const arts = albumData.artworks || [];
  if (arts.length === 0) {
    alert('Nenhum encarte salvo para este disco. Salve o álbum na Estante primeiro ou adicione uma foto!');
  }
  currentBookletIndex = 0;
  showBooklet();
  bookletModal.classList.add('active');
});

function showBooklet() {
  const arts = albumData.artworks || [];
  if (!arts[currentBookletIndex]) {
    bookletImg.src = albumData.art || '';
    pageCounter.textContent = '1 / 1 (Capa)';
    return;
  }
  bookletImg.src = arts[currentBookletIndex].path;
  pageCounter.textContent = (currentBookletIndex + 1) + ' / ' + arts.length + ' (' + (arts[currentBookletIndex].type || 'Foto') + ')';
}

prevPageBtn.addEventListener('click', () => {
  const arts = albumData.artworks || [];
  if (currentBookletIndex > 0) { currentBookletIndex--; showBooklet(); }
});
nextPageBtn.addEventListener('click', () => {
  const arts = albumData.artworks || [];
  if (currentBookletIndex < arts.length - 1) { currentBookletIndex++; showBooklet(); }
});
closeBookletBtn.addEventListener('click', () => bookletModal.classList.remove('active'));

btnAddPage.addEventListener('click', () => bookletFileInput.click());
bookletFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !albumData.slug) {
    alert('Selecione primeiro um disco baixado da Estante para salvar novas páginas!');
    return;
  }
  const formData = new FormData();
  formData.append('slug', albumData.slug);
  formData.append('page', file);

  try {
    const res = await fetch('/api/add-booklet', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      albumData.artworks = data.artworks;
      currentBookletIndex = albumData.artworks.length - 1;
      showBooklet();
    }
  } catch (err) {
    alert('Erro ao gravar imagem no encarte');
  } finally {
    bookletFileInput.value = '';
  }
});

setTonearmAngle(ANGLE_REST, false);
vinylLabel.style.backgroundImage = 'none';
renderGrooves(albumData.sideA);
renderTracklist();
