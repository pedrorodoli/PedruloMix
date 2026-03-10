const socket = io();
const audioPlayer = document.getElementById('audioPlayer');
const playBtn = document.getElementById('playBtn');
const progressBar = document.getElementById('progressBar');
const segmentsContainer = document.getElementById('segments');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const guessesList = document.getElementById('guessesList');
const skipBtn = document.getElementById('skipBtn');
const resultModal = document.getElementById('resultModal');
const loadingOverlay = document.getElementById('loadingOverlay');
const attemptsCounter = document.getElementById('attemptsCounter');
const gameModeSelect = document.getElementById('gameMode');
const instructionText = document.getElementById('instructionText');

// Setup and Areas
const setupArea = document.getElementById('setupArea');
const gameArea = document.getElementById('gameArea');
const gameHeader = document.getElementById('gameHeader');
const mainHeader = document.getElementById('mainHeader');
const startGameBtn = document.getElementById('startGameBtn');
const editModeBtn = document.getElementById('editModeBtn');

// Modal Result Buttons
const modalChangeModeBtn = document.getElementById('modalChangeModeBtn');
const modalChangeSelectionBtn = document.getElementById('modalChangeSelectionBtn');

let gameState = {
    gameId: null,
    attempts: 0,
    maxAttempts: 6,
    durations: [],
    isPlaying: false,
    gameOver: false,
    startTime: 0,
    currentMode: 'normal',
    modeId: null,
    modeName: null
};

let playbackInterval = null; // Global para control absoluto
const BASE_URL = window.location.origin + '/api';

// --- UTILIDADES ---

function showLoading(show) {
    loadingOverlay.classList.toggle('hidden', !show);
}

function renderSegments() {
    segmentsContainer.innerHTML = '';
    for (let i = 0; i < gameState.maxAttempts; i++) {
        const segment = document.createElement('div');
        segment.className = 'segment';
        segment.style.flex = 1; 
        if (i <= gameState.attempts) segment.classList.add('active');
        segmentsContainer.appendChild(segment);
    }
}

function updateUIState() {
    attemptsCounter.textContent = `Intentos restantes: ${gameState.maxAttempts - gameState.attempts}`;
    
    // OCULTAR HEADER SI SE MOSTRÓ EL RESULTADO
    if (gameState.gameOver) {
        gameHeader.classList.add('hidden');
        return;
    }

    if (!setupArea.classList.contains('hidden')) {
        gameHeader.classList.add('hidden');
        
        // LÓGICA DE BOTÓN EMPEZAR
        if (gameState.currentMode === 'normal') {
            startGameBtn.classList.remove('hidden');
        } else {
            // Ocultar si no hay artista/álbum seleccionado
            if (!gameState.modeId) {
                startGameBtn.classList.add('hidden');
            } else {
                startGameBtn.classList.remove('hidden');
            }
        }
    } else {
        gameHeader.classList.remove('hidden');
        const prefix = gameState.currentMode === 'artist' ? 'de ' : 'del álbum ';
        instructionText.innerHTML = gameState.modeName ? 
            `Adivina la canción <span class="highlight">${prefix}${gameState.modeName}</span>` : 
            "Adivina el reggaeton";
        
        editModeBtn.textContent = gameState.currentMode === 'artist' ? 'Cambiar artista' : 'Cambiar álbum';
        editModeBtn.classList.toggle('visible', gameState.currentMode !== 'normal');
    }
}

function resetUI() {
    if (playbackInterval) clearInterval(playbackInterval);
    gameState.attempts = 0;
    gameState.isPlaying = false;
    gameState.gameOver = false;
    
    guessesList.innerHTML = '';
    resultModal.classList.add('hidden');
    if(searchInput) searchInput.value = '';
    if(searchResults) searchResults.classList.add('hidden');
    progressBar.style.width = '0%';
    playBtn.textContent = '▶';
    
    document.getElementById('inputArea').style.display = 'flex';
    setupArea.classList.remove('hidden');
    gameArea.classList.add('hidden');
    gameHeader.classList.add('hidden');
    mainHeader.classList.remove('hidden');
    
    audioPlayer.pause();
    audioPlayer.src = '';
}

// --- LOGICA PRINCIPAL ---

let isInitializing = false;

async function initGame() {
    if (isInitializing) return;
    isInitializing = true;

    // LIMPIEZA INICIAL PARA EVITAR BUCLES DE RESULTADOS
    resetUI();
    showLoading(true);
    setupArea.classList.add('hidden'); // Ocultar mientras carga

    if (!socket.id) {
        await new Promise(r => { socket.on('connect', r); setTimeout(r, 2000); });
    }

    try {
        const query = `socketId=${socket.id}&mode=${gameState.currentMode}&modeId=${gameState.modeId || ''}&t=${Date.now()}`;
        const res = await fetch(`${BASE_URL}/start-game?${query}`);
        const data = await res.json();
        
        if (res.status === 503) { 
            isInitializing = false;
            setTimeout(initGame, 2000); 
            return; 
        }

        gameState.gameId = data.gameId;
        gameState.durations = data.durations;
        gameState.startTime = data.startTime || 0;

        gameArea.classList.remove('hidden');
        gameHeader.classList.remove('hidden');

        audioPlayer.src = `${BASE_URL}/stream/${socket.id}?t=${Date.now()}`;
        audioPlayer.load();

        // Intento de desbloqueo de audio silencioso para móviles
        const silentUnlock = () => {
            audioPlayer.play().then(() => {
                audioPlayer.pause();
                console.log("Audio unlocked");
            }).catch(e => console.log("Unlock waiting for more interaction"));
            window.removeEventListener('touchstart', silentUnlock);
            window.removeEventListener('click', silentUnlock);
        };
        window.addEventListener('touchstart', silentUnlock);
        window.addEventListener('click', silentUnlock);

        audioPlayer.addEventListener('canplay', () => {
            showLoading(false);
            audioPlayer.currentTime = gameState.startTime;
        }, { once: true });
        
        setTimeout(() => showLoading(false), 5000);

        renderSegments();
        updateUIState();
    } catch (error) {
        console.error('Error starting game:', error);
        showLoading(false);
        setupArea.classList.remove('hidden');
    } finally {
        isInitializing = false;
    }
}

// --- AUDIO (RESTAURADO EXACTO A LÓGICA ESTABLE SEGÚN LOG) ---

async function playAudio() {
    if (gameState.isPlaying) {
        audioPlayer.pause();
        return;
    }

    try {
        audioPlayer.currentTime = gameState.startTime;
        const duration = gameState.durations[gameState.attempts];
        
        await audioPlayer.play();
        gameState.isPlaying = true;
        playBtn.textContent = '⏸';

        if (playbackInterval) clearInterval(playbackInterval);

        playbackInterval = setInterval(() => {
            if (!gameState.isPlaying || audioPlayer.paused || gameState.gameOver) {
                clearInterval(playbackInterval);
                playBtn.textContent = '▶';
                progressBar.style.width = '0%';
                return;
            }

            const elapsed = audioPlayer.currentTime - gameState.startTime;

            if (elapsed >= duration) {
                audioPlayer.pause();
                audioPlayer.currentTime = gameState.startTime;
                gameState.isPlaying = false;
                playBtn.textContent = '▶';
                progressBar.style.width = '0%';
                clearInterval(playbackInterval);
            } else {
                const segmentWidth = 100 / gameState.maxAttempts;
                const currentTotalUnlockedWidth = (gameState.attempts + 1) * segmentWidth;
                const progressPercent = (elapsed / duration) * currentTotalUnlockedWidth;
                progressBar.style.width = `${progressPercent}%`;
            }
        }, 30);
    } catch (e) {
        console.error('Playback failed:', e);
        gameState.isPlaying = false;
        playBtn.textContent = '▶';
    }
}

playBtn.addEventListener('click', () => {
    playAudio();
});

audioPlayer.addEventListener('pause', () => {
    if(!gameState.gameOver) {
        gameState.isPlaying = false;
        playBtn.textContent = '▶';
    }
});

// --- EVENTOS ---

startGameBtn.addEventListener('click', () => initGame());

gameModeSelect.addEventListener('change', (e) => {
    const newMode = e.target.value;
    if (setupArea.classList.contains('hidden') && !gameState.gameOver) {
        if (confirm('¿Cambiar de modo? Se perderá el progreso de la partida actual.')) {
            gameState.currentMode = newMode;
            if (gameState.currentMode === 'normal') {
                gameState.modeId = null;
                gameState.modeName = null;
                initGame();
            } else {
                gameState.modeId = null;
                gameState.modeName = null;
                resetUI();
                updateUIState();
                openModeSelector();
            }
        } else {
            gameModeSelect.value = gameState.currentMode;
        }
    } else {
        gameState.currentMode = newMode;
        if (gameState.currentMode === 'normal') {
            gameState.modeId = null;
            gameState.modeName = null;
            updateUIState();
        } else {
            gameState.modeId = null;
            gameState.modeName = null;
            updateUIState();
            openModeSelector();
        }
    }
});

editModeBtn.addEventListener('click', () => {
    openModeSelector();
});

modalChangeModeBtn.addEventListener('click', () => {
    resultModal.classList.add('hidden');
    resetUI();
    updateUIState();
});

modalChangeSelectionBtn.addEventListener('click', () => {
    openModeSelector();
});

function openModeSelector() {
    modeModalTitle.textContent = gameState.currentMode === 'artist' ? 'Selecciona Artista' : 'Selecciona Álbum';
    modeSearchInput.value = '';
    modeSearchResults.innerHTML = '';
    modeModal.classList.remove('hidden');
}

closeModeModal.addEventListener('click', () => {
    modeModal.classList.add('hidden');
    if (!gameState.modeId) {
        gameModeSelect.value = 'normal';
        gameState.currentMode = 'normal';
        updateUIState();
    }
});

let modeSearchTimeout;
modeSearchInput.addEventListener('input', (e) => {
    const q = e.target.value;
    clearTimeout(modeSearchTimeout);
    if (q.length < 2) return;
    modeSearchTimeout = setTimeout(async () => {
        const res = await fetch(`${BASE_URL}/search-mode?type=${gameState.currentMode}&q=${encodeURIComponent(q)}`);
        const results = await res.json();
        renderModeResults(results);
    }, 400);
});

function renderModeResults(results) {
    modeSearchResults.innerHTML = '';
    results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `<img src="${item.image}"><div style="text-align:left"><div style="font-weight:bold">${item.name}</div><div style="font-size:0.8em; color:#888">${item.artist || ''}</div></div>`;
        div.onclick = () => {
            gameState.modeId = item.id;
            gameState.modeName = item.name;
            modeModal.classList.add('hidden');
            updateUIState();
            initGame();
        };
        modeSearchResults.appendChild(div);
    });
}

document.addEventListener('click', (e) => {
    if (searchInput && !searchInput.contains(e.target) && searchResults && !searchResults.contains(e.target)) {
        searchResults.classList.add('hidden');
    }
});

searchInput.addEventListener('input', (e) => {
    const query = e.target.value;
    clearTimeout(window.searchT);
    if (!query || query.trim() === '') { searchResults.classList.add('hidden'); return; }
    window.searchT = setTimeout(async () => {
        const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`);
        renderSearchResults(await res.json());
    }, 300);
});

function renderSearchResults(results) {
    searchResults.innerHTML = '';
    if (searchInput.value.trim() === '' || !results.length) { searchResults.classList.add('hidden'); return; }
    results.forEach(song => {
        const div = document.createElement('div');
        div.className = 'search-result-item';
        div.innerHTML = `<img src="${song.thumbnail}"><div style="overflow:hidden"><div style="font-weight:bold; white-space:nowrap; text-overflow:ellipsis; overflow:hidden">${song.title}</div><div style="font-size:0.8em; color:#888; white-space:nowrap; text-overflow:ellipsis; overflow:hidden">${song.artist}</div></div>`;
        div.onclick = () => {
            searchResults.innerHTML = '';
            searchResults.classList.add('hidden');
            searchInput.value = '';
            submitGuess(song.id, song.title, song.artist);
        };
        searchResults.appendChild(div);
    });
    searchResults.classList.remove('hidden');
}

async function submitGuess(videoId, title, artist) {
    if (searchResults) {
        searchResults.innerHTML = '';
        searchResults.classList.add('hidden');
    }
    clearTimeout(window.searchT);

    const res = await fetch(`${BASE_URL}/guess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: gameState.gameId, videoId, title, artist })
    });
    const result = await res.json();
    if (result.correct) { 
        addGuessRow(title, 'correct'); 
        endGame(true, result.song); 
    } else { 
        addGuessRow(title, 'wrong'); 
        advanceTurn(); 
    }
}

skipBtn.onclick = () => { 
    if (gameState.gameOver || isInitializing) return;
    
    if (searchResults) {
        searchResults.innerHTML = '';
        searchResults.classList.add('hidden');
    }
    clearTimeout(window.searchT);

    addGuessRow('OMITIDO', 'skipped'); 
    advanceTurn(); 
};

function addGuessRow(text, type) {
    const div = document.createElement('div');
    div.className = `guess-row ${type}`;
    div.textContent = text;
    
    guessesList.appendChild(div);
    
    // Forzar re-pintado crítico para móviles
    guessesList.style.display = 'none';
    guessesList.offsetHeight; // Reflow
    guessesList.style.display = 'grid';
    
    // Asegurar visibilidad en el siguiente frame
    requestAnimationFrame(() => {
        div.style.visibility = 'visible';
        div.style.opacity = '1';
    });
}

function advanceTurn() {
    gameState.attempts++;
    if (gameState.attempts >= gameState.maxAttempts) {
        giveUp();
    } else { 
        renderSegments(); 
        updateUIState(); 
    }
}

async function giveUp() {
    const res = await fetch(`${BASE_URL}/giveup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: gameState.gameId })
    });
    const data = await res.json();
    endGame(false, data.song);
}

function endGame(won, song) {
    gameState.gameOver = true;
    mainHeader.classList.add('hidden');
    document.getElementById('resultTitle').textContent = won ? '¡HAS ACERTADO!' : '¡MÁS SUERTE LA PRÓXIMA!';
    document.getElementById('revealTitle').textContent = song.title;
    document.getElementById('revealArtist').textContent = song.artist;
    document.getElementById('revealImage').src = song.thumbnail;
    
    modalChangeSelectionBtn.textContent = gameState.currentMode === 'artist' ? 'Cambiar artista' : 'Cambiar álbum';
    modalChangeSelectionBtn.style.display = gameState.currentMode === 'normal' ? 'none' : 'block';

    resultModal.classList.remove('hidden');
    document.getElementById('inputArea').style.display = 'none';
}

document.getElementById('playFullBtn').onclick = () => { audioPlayer.currentTime = 0; audioPlayer.play(); };
document.getElementById('downloadBtn').onclick = () => { window.location.href = `${BASE_URL}/download/${gameState.gameId}`; };
document.getElementById('nextGameBtn').onclick = () => initGame();
document.getElementById('changeSongBtn').onclick = () => { 
    if(searchResults) searchResults.classList.add('hidden'); 
    if(confirm('¿Seguro que quieres cambiar de canción?')) initGame(); 
};

updateUIState();
