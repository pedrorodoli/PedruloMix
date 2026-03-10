const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { Server } = require("socket.io");
const ffmpeg = require('ffmpeg-static');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = 3020;

const DOWNLOAD_DIR = path.join(__dirname, 'data', 'songs_cache');
const COOKIES_PATH = 'C:\\Users\\Pedro\\Desktop\\Peticiones\\cookies.txt';
const SPOTIFY_CLIENT_ID = '6c5b314371124fc3baec843257c35246';
const SPOTIFY_CLIENT_SECRET = '1e00d483915647e29454a21e4b329f8e';
const YTDLP_PATH = path.join(__dirname, 'node_modules', 'ytdlp-nodejs', 'bin', 'yt-dlp.exe');
let spotifyToken = { value: null, expiry: 0 };

function clearCacheFolder() {
    if (fs.existsSync(DOWNLOAD_DIR)) {
        const files = fs.readdirSync(DOWNLOAD_DIR);
        for (const file of files) { try { fs.unlinkSync(path.join(DOWNLOAD_DIR, file)); } catch (e) {} }
    } else { fs.mkdirSync(DOWNLOAD_DIR, { recursive: true }); }
}
clearCacheFolder();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let allSongs = [];
const activeGames = new Map();

// --- SPOTIFY HELPERS ---
async function getSpotifyToken() {
    if (spotifyToken.value && Date.now() < spotifyToken.expiry) return spotifyToken.value;
    try {
        const res = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
            }
        });
        spotifyToken.value = res.data.access_token;
        spotifyToken.expiry = Date.now() + (res.data.expires_in * 1000) - 60000;
        return spotifyToken.value;
    } catch (e) { return null; }
}

async function fetchSpotifyPlaylist(playlistId) {
    const token = await getSpotifyToken();
    if (!token) return [];
    try {
        const res = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.data.items.map(item => {
            const t = item.track;
            if (!t) return null;
            return { id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(', '), thumbnail: t.album.images[0]?.url || '', duration_ms: t.duration_ms };
        }).filter(t => t !== null);
    } catch (e) { return []; }
}

// --- CORE HELPERS ---
async function getDuration(filePath) {
    return new Promise((resolve) => {
        const cmd = `"${ffmpeg}" -i "${filePath}" 2>&1`;
        exec(cmd, (error, stdout, stderr) => {
            const out = stdout || stderr;
            const match = out.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
            if (match) resolve((parseInt(match[1]) * 3600) + (parseInt(match[2]) * 60) + parseInt(match[3]));
            else resolve(180);
        });
    });
}

function cleanUpSong(socketId) {
    const game = activeGames.get(socketId);
    if (game && game.song) {
        const filePath = path.join(DOWNLOAD_DIR, `${game.song.id}.mp3`);
        if (fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch (e) {} }
    }
    activeGames.delete(socketId);
}

async function downloadSong(song) {
    const filePath = path.join(DOWNLOAD_DIR, `${song.id}.mp3`);
    if (fs.existsSync(filePath)) return filePath;

    // BÚSQUEDA MÁS PRECISA
    const searchQuery = `ytsearch1:"${song.artist} - ${song.title} (Official Audio)"`;
    const outputTemplate = path.join(DOWNLOAD_DIR, `${song.id}.%(ext)s`);
    const cmd = `"${YTDLP_PATH}" ${searchQuery} -x --audio-format mp3 --ffmpeg-location "${ffmpeg}" -o "${outputTemplate}" --no-playlist --cookies "${COOKIES_PATH}" --max-filesize 50M`;

    return new Promise((resolve, reject) => {
        exec(cmd, async (error) => {
            if (error) return reject(error);
            let attempts = 0;
            let finalPath = null;

            while (attempts < 15) {
                const files = fs.readdirSync(DOWNLOAD_DIR);
                const found = files.find(f => f.includes(song.id));
                if (found) {
                    const currentPath = path.join(DOWNLOAD_DIR, found);
                    if (fs.statSync(currentPath).size > 1000) {
                        if (!found.endsWith('.mp3')) fs.renameSync(currentPath, filePath);
                        finalPath = filePath;
                        break;
                    }
                }
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            if (!finalPath) return reject(new Error('Timeout'));

            // VALIDACIÓN DE DURACIÓN (Spotify vs YouTube)
            const duration = await getDuration(finalPath);
            const expected = song.duration_ms / 1000;
            const diff = Math.abs(duration - expected);

            if (diff > 25) { // Si hay más de 25s de diferencia, probablemente es el vídeo equivocado
                console.log(`[AVISO] Duración incorrecta (${duration}s vs ${expected.toFixed(0)}s). Descartando...`);
                if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
                return reject(new Error('Duration mismatch'));
            }

            resolve(finalPath);
        });
    });
}

// --- API ---
app.get('/api/search-mode', async (req, res) => {
    const { type, q } = req.query;
    const token = await getSpotifyToken();
    if (!token) return res.json([]);
    try {
        const response = await axios.get(`https://api.spotify.com/v1/search`, {
            params: { q, type, limit: 10 },
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const items = type === 'artist' ? response.data.artists.items : response.data.albums.items;
        res.json(items.map(item => ({ id: item.id, name: item.name, image: item.images[item.images.length - 1]?.url || '', artist: type === 'album' ? item.artists.map(a => a.name).join(', ') : '' })));
    } catch (e) { res.json([]); }
});

app.get('/api/start-game', async (req, res) => {
    const { socketId, mode, modeId } = req.query;
    if (!socketId) return res.status(400).json({ message: 'Socket ID required' });
    cleanUpSong(socketId);

    let pool = [];
    const token = await getSpotifyToken();

    if (mode === 'artist' && modeId) {
        try {
            const albumsRes = await axios.get(`https://api.spotify.com/v1/artists/${modeId}/albums?include_groups=album,single&limit=50&market=ES`, { headers: { 'Authorization': `Bearer ${token}` } });
            for (const album of albumsRes.data.items) {
                const tracksRes = await axios.get(`https://api.spotify.com/v1/albums/${album.id}/tracks?limit=50`, { headers: { 'Authorization': `Bearer ${token}` } });
                pool.push(...tracksRes.data.items.map(t => ({ id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(', '), thumbnail: album.images[0]?.url || '', duration_ms: t.duration_ms })));
            }
        } catch (e) {}
    } else if (mode === 'album' && modeId) {
        try {
            const albumRes = await axios.get(`https://api.spotify.com/v1/albums/${modeId}`, { headers: { 'Authorization': `Bearer ${token}` } });
            pool = albumRes.data.tracks.items.map(t => ({ id: t.id, title: t.name, artist: t.artists.map(a => a.name).join(', '), thumbnail: albumRes.data.images[0]?.url || '', duration_ms: t.duration_ms }));
        } catch (e) {}
    } else {
        pool = allSongs;
    }

    if (!pool || pool.length === 0) return res.status(503).json({ message: 'No songs found' });

    const seen = new Set();
    pool = pool.filter(s => seen.has(s.id) ? false : seen.add(s.id));

    let selectedSong = null;
    let filePath = null;
    let retries = 15; // Más reintentos para asegurar que pase la validación de duración

    while (retries > 0 && !filePath) {
        const candidate = pool[Math.floor(Math.random() * pool.length)];
        try {
            filePath = await downloadSong(candidate);
            selectedSong = candidate;
        } catch (e) {
            console.log(`[REINTENTO] ${candidate.title} descartada por: ${e.message}`);
            retries--;
        }
    }

    if (!selectedSong) return res.status(500).json({ message: 'No song ready' });

    console.log(`[PARTIDA] Elegida: ${selectedSong.title} (${selectedSong.artist})`);

    const duration = await getDuration(filePath);
    const startTime = Math.floor(Math.random() * Math.max(0, duration - 60));
    activeGames.set(socketId, { song: selectedSong, startTime });

    res.setHeader('Cache-Control', 'no-store');
    res.json({ gameId: socketId, song: mode !== 'normal' ? selectedSong : null, startTime, attempts: 6, durations: [1, 2, 4, 7, 11, 16] });
});

app.get('/api/stream/:socketId', (req, res) => {
    const game = activeGames.get(req.params.socketId);
    if (!game) return res.status(404).send('Not found');
    const filePath = path.join(DOWNLOAD_DIR, `${game.song.id}.mp3`);
    if (!fs.existsSync(filePath)) return res.status(404).send('No file');
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(filePath);
});

app.get('/api/download/:socketId', (req, res) => {
    const game = activeGames.get(req.params.socketId);
    if (!game) return res.status(404).send('Not found');
    const filePath = path.join(DOWNLOAD_DIR, `${game.song.id}.mp3`);
    res.download(filePath, `${game.song.title}.mp3`);
});

app.get('/api/search', async (req, res) => {

    const token = await getSpotifyToken();

    if (!token) return res.json([]);

    const query = req.query.q;

    try {

        const response = await axios.get('https://api.spotify.com/v1/search', { params: { q: query, type: 'track', limit: 20 }, headers: { 'Authorization': `Bearer ${token}` } });

        const norm = (s) => s?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

        const queryNorm = norm(query);



        const seen = new Set();

        const results = response.data.tracks.items

            .map(item => ({ id: item.id, title: item.name, artist: item.artists.map(a => a.name).join(', '), thumbnail: item.album.images[item.album.images.length - 1]?.url || '' }))

            .filter(item => {

                // 1. Verificar si coincide con la búsqueda

                const isMatch = norm(item.title).includes(queryNorm) || norm(item.artist).includes(queryNorm);

                if (!isMatch) return false;



                // 2. Verificar si es un duplicado (Mismo título y artista)

                const key = `${norm(item.title)}|${norm(item.artist)}`;

                if (seen.has(key)) return false;

                seen.add(key);

                return true;

            })

            .slice(0, 10);

        res.json(results);

    } catch (e) { res.json([]); }

});

app.post('/api/guess', (req, res) => {
    const { gameId, videoId, title, artist } = req.body;
    const game = activeGames.get(gameId);
    if (!game) return res.status(404).json({ message: 'Game not found' });
    const norm = (s) => s?.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const idMatch = videoId === game.song.id;
    const textMatch = norm(title) === norm(game.song.title) && norm(artist) === norm(game.song.artist);
    if (idMatch || textMatch) res.json({ correct: true, song: game.song });
    else res.json({ correct: false });
});

app.post('/api/giveup', (req, res) => {
    const game = activeGames.get(req.body.gameId);
    res.json({ song: game ? game.song : null });
});

io.on('connection', (socket) => {
    socket.on('disconnect', () => cleanUpSong(socket.id));
});

(async () => {
    console.log('Cargando catálogo base...');
    const token = await getSpotifyToken();
    if (!token) return;
    const queries = ['reggaeton classics', 'reggaeton 2020', 'reggaeton 2021', 'reggaeton 2022', 'reggaeton 2023', 'reggaeton 2024', 'reggaeton 2025', 'reggaeton 2026'];
    try {
        for (const q of queries) {
            const searchRes = await axios.get(`https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=playlist&limit=2`, { headers: { 'Authorization': `Bearer ${token}` } });
            const playlistIds = searchRes.data.playlists.items.filter(p => p !== null).map(p => p.id);
            for (const id of playlistIds) {
                const tracks = await fetchSpotifyPlaylist(id);
                allSongs.push(...tracks);
            }
        }
        const seen = new Set();
        allSongs = allSongs.filter(s => seen.has(s.id) ? false : seen.add(s.id));
        console.log(`Catálogo base listo: ${allSongs.length} canciones.`);
        server.listen(PORT, () => console.log(`Pedruloguess en puerto ${PORT}`));
    } catch (e) { if (!server.listening) server.listen(PORT, () => console.log(`Pedruloguess en puerto ${PORT}`)); }
})();