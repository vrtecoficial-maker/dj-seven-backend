
const LOCAL_API = 'http://localhost:3000';
const RENDER_API = '';
let activeBackend = LOCAL_API;

// Teste rápido para detectar se o backend está local no aparelho
fetch(LOCAL_API + '/api/library', { method: 'HEAD', mode: 'no-cors' })
  .then(() => { activeBackend = LOCAL_API; })
  .catch(() => { activeBackend = RENDER_API; });


async function saveTrackAudioBlob(key, blob) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('albums', 'readwrite');
    const store = tx.objectStore('albums');
    const req = store.get(key);
    req.onsuccess = () => {
      const data = req.result || { slug: key };
      data.audioBlob = blob;
      store.put(data);
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}


// BANCO DE DADOS LOCAL DO DISPOSITIVO (OFFLINE REAL)
function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('DJSevenDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('albums')) {
        db.createObjectStore('albums', { keyPath: 'slug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveAlbumOffline(album) {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('albums', 'readwrite');
    const store = tx.objectStore('albums');
    store.put(album);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOfflineAlbums() {
  const db = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('albums', 'readonly');
    const store = tx.objectStore('albums');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}


let tonearmTimer = null;
function startTonearmSync() {
  if (tonearmTimer) clearInterval(tonearmTimer);
  tonearmTimer = setInterval(() => {
    if (!isPlaying) return;
    const tracks = currentSide === 'A' ? (albumData.sideA || []) : (albumData.sideB || []);
    const totalTracks = tracks.length || 1;
    let trackFraction = 0;

    if (typeof ytPlayer !== 'undefined' && ytPlayer && ytPlayer.getCurrentTime && ytPlayer.getDuration) {
      const cur = ytPlayer.getCurrentTime() || 0;
      const dur = ytPlayer.getDuration() || 1;
      trackFraction = Math.min(1, Math.max(0, cur / dur));
    } else if (audioPlayer && audioPlayer.duration) {
      trackFraction = Math.min(1, Math.max(0, audioPlayer.currentTime / audioPlayer.duration));
    }

    const currentGlobalProgress = (currentTrackIndex + trackFraction) / totalTracks;
    const targetAngle = ANGLE_OUTER + (currentGlobalProgress * (ANGLE_INNER - ANGLE_OUTER));
    setTonearmAngle(Math.min(ANGLE_INNER, Math.max(ANGLE_OUTER, targetAngle)), false);
  }, 500);
}


let ytPlayer = null;
let isYtReady = false;
window.onYouTubeIframeAPIReady = function() {
  ytPlayer = new YT.Player("yt-audio-player", {
    height: "1",
    width: "1",
    playerVars: { autoplay: 1, controls: 0, playsinline: 1 },
    events: {
      "onReady": () => { isYtReady = true; },
      "onStateChange": (event) => {
        if (event.data === YT.PlayerState.PLAYING) {
          isPlaying = true;
          playBtn.textContent = '⏸';
          mainDisc.classList.add('rotating');
          if (typeof startTonearmSync === 'function') startTonearmSync();
          const currentTrack = (currentSide === 'A' ? albumData.sideA : albumData.sideB)[currentTrackIndex];
          const name = currentTrack ? (currentTrack.title || currentTrack.name) : '';
          trackStatusEl.innerHTML = '<span class="needle-icon">•</span> TOCANDO: ' + name;
        } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
          isPlaying = false;
          playBtn.textContent = '▶';
          mainDisc.classList.remove('rotating');
          if (event.data === YT.PlayerState.ENDED) nextTrack();
        }
      }
    }
  });
};
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
    audioPlayer.play().then(() => {
      trackStatusEl.innerHTML = '<span class="needle-icon">•</span> TOCANDO (OFFLINE): ' + name;
      isPlaying = true;
          playBtn.textContent = '⏸';
          mainDisc.classList.add('rotating');
          if (typeof startTonearmSync === 'function') startTonearmSync();
    }).catch(() => {
      trackStatusEl.innerHTML = '<span class="needle-icon">•</span> TOQUE NO PLAY';
      isPlaying = false;
      playBtn.textContent = '▶';
    });
  } else {
    const who = track.performer || albumData.artist;
    const cleanSearch = who + ' ' + name + ' audio original';
    fetch(activeBackend + "/api/search?q=" + encodeURIComponent(cleanSearch))
      .then(r => r.json())
      .then(d => {
        if (d.videoId && ytPlayer && ytPlayer.loadVideoById) {
          ytPlayer.loadVideoById(d.videoId);
          ytPlayer.playVideo();
          isPlaying = true;
          playBtn.textContent = '⏸';
        } else {
          trackStatusEl.innerHTML = '<span class="needle-icon">•</span> ERRO AO SINTONIZAR';
        }
      })
      .catch(err => {
        console.error(err);
        trackStatusEl.innerHTML = '<span class="needle-icon">•</span> ERRO DE CONEXÃO';
      });
  }
}

function pauseTrack() {
  if (typeof tonearmTimer !== 'undefined' && tonearmTimer) clearInterval(tonearmTimer);
  if (typeof ytPlayer !== "undefined" && ytPlayer && ytPlayer.pauseVideo) { ytPlayer.pauseVideo(); }
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
  else { if (typeof ytPlayer !== "undefined" && ytPlayer && ytPlayer.playVideo) { ytPlayer.playVideo(); isPlaying = true; playBtn.textContent = "⏸"; mainDisc.classList.add("rotating"); } else { playTrack(currentTrackIndex); } }
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
    const res = await fetch(activeBackend + '/api/scan', { method: 'POST', body: formData });
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
  if (!albumData || !albumData.title) {
    alert('Nenhum disco carregado!');
    return;
  }
  const slug = (albumData.slug || albumData.title).toLowerCase().replace(/[^a-z0-9]/g, '-');
  albumData.slug = slug;
  trackStatusEl.innerHTML = '<span class="needle-icon">•</span> BAIXANDO PARA A MEMÓRIA DO CELULAR...';

  try {
    const allTracks = [...(albumData.sideA || []), ...(albumData.sideB || [])];
    for (let i = 0; i < allTracks.length; i++) {
      const t = allTracks[i];
      const q = (t.performer || albumData.artist) + ' ' + (t.title || t.name) + ' audio original';
      trackStatusEl.innerHTML = '<span class="needle-icon">•</span> BAIXANDO FAIXA ' + (i + 1) + '/' + allTracks.length + '...';
      try {
        const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const resp = await fetch(activeBackend + '/api/get-audio?q=' + encodeURIComponent(q), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const blob = await resp.blob();
        const base64Audio = await new Promise((res) => {
          const reader = new FileReader();
          reader.onloadend = () => res(reader.result);
          reader.readAsDataURL(blob);
        });
        t.localUrl = base64Audio;
      }
      } catch (err) {
        console.warn('Erro ao baixar faixa:', t.title, err);
      }
    }

    await saveAlbumOffline(albumData);
    trackStatusEl.innerHTML = '<span class="needle-icon">•</span> DISCO 100% OFFLINE SALVO!';
    alert('Álbum completo e faixas baixadas! Pode colocar em Modo Avião e ouvir na Estante.');
  } catch (e) {
    console.error(e);
    trackStatusEl.innerHTML = '<span class="needle-icon">•</span> ERRO NO DOWNLOAD';
  }
});

async function loadShelf() {
  try {
    let albums = [];
    try {
      albums = await getOfflineAlbums();
    } catch(e) {}
    
    if (!albums || albums.length === 0) {
      try {
        const res = await fetch(activeBackend + '/api/library');
        albums = await res.json();
      } catch(e) {}
    }
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

      const playAction = async () => {
        try {
          const offlineList = await getOfflineAlbums();
          const found = offlineList.find(x => x.slug === item.slug);
          albumData = found || item;
        } catch(e) {
          albumData = item;
        }
        updateCoverArt(albumData.cover || albumData.coverUrl || '');
        albumTitleEl.textContent = albumData.title;
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
            const delRes = await fetch(activeBackend + '/api/library/' + item.slug, { method: 'DELETE' });
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
    const res = await fetch(activeBackend + '/api/add-booklet', { method: 'POST', body: formData });
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
