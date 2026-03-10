# PedruloGuess 🎵
Juego interactivo multijugador de adivinar canciones y vídeos con integración directa de contenido multimedia.

## 💻 Características Técnicas
- **Media Engine:** Uso de `yt-dlp` y `ffmpeg` para el procesamiento y streaming de contenido de YouTube en tiempo real.
- **Algoritmos:** Implementación de `string-similarity` para la validación inteligente de respuestas (tolerancia a errores tipográficos).
- **Sincronización:** WebSockets para mantener a todos los jugadores en la misma escena.

## 🌐 Acceso
Pruébalo aquí: [https://pedruloguess.ddnsfree.com/](https://pedruloguess.ddnsfree.com/)

## 🛠️ Instalación
1. Requiere `ffmpeg` instalado en el sistema.
2. `npm install`
3. `node server.js`
