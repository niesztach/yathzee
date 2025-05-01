const express = require('express');
const http    = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Serwuj pliki klienta (index.html + JS + assets)
app.use(express.static('public'));

server.listen(2223, () => {
  console.log('Serwer HTTP + WS działa na porcie 2222');
});


// Każdy pokój ma swój stan gry i listę ws-ów
const rooms = new Map();

function broadcastToRoom(roomName, msg) {
  const room = rooms.get(roomName);
  if (!room) return;
  for (const client of room.clients) {
          sendJSON(client, msg);
  }
}

function generateUniqueId() { return Math.random().toString(36).slice(2); }
function sendJSON(ws, obj) { ws.send(JSON.stringify(obj)); }
function createInitialGameState() {
  return {
    phase: 'lobby',
    players: [],      // tu będziesz trzymać listę graczy
    dice: [0,0,0,0,0],
    locked: [false, false, false, false, false],
    whoseTurn: null,
    rollsLeft: 0,
    scorecard: {},    // { playerId: { ones:null,… } }
  };
}

// ##########  tworzenie pokoju ##############
// Funkcja do generowania unikalnego kodu pokoju

function generateRoomCode() {
  const chars = 'QWERTYUIOPASDFGHJKLZXCVBNM0123456789';
  let code;
  do {
    code = [...Array(3)].map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// Endpoint do tworzenia pokoju

app.get('/create-room', (req, res) => {
  const code = generateRoomCode();
  rooms.set(code, {
    clients: new Set(),
    state: createInitialGameState(),
    hostId: null,
    hostName: null
  });
  res.json({ roomCode: code });
});



// ############  obsługa websocketów ###################


wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomName = url.searchParams.get('room');
  const playerName = url.searchParams.get('name')?.trim();
  const playerId = generateUniqueId();

  if (!roomName || !rooms.has(roomName) || !playerName) {
    ws.close();
    return;
  }

  const room = rooms.get(roomName);
  room.clients.add(ws);

  const existingPlayer = room.state.players.find(p => p.id === playerId);
  if (existingPlayer) {
    // Gracz wraca do pokoju
    existingPlayer.disconnected = false;
    existingPlayer.name = playerName; // Aktualizacja imienia, jeśli zmienione
    ws.playerId = existingPlayer.id;
    ws.roomName = roomName;
    ws.playerName = playerName;

    // Powiadom gracza o ponownym połączeniu
    sendJSON(ws, {
      type: 'reconnected',
      playerId: existingPlayer.id,
      players: room.state.players,
      hostId: room.hostId,
      hostName: room.hostName
    });

    // Powiadom innych graczy o aktualizacji
    broadcastToRoom(roomName, {
      type: 'lobbyUpdate',
      players: room.state.players,
      hostId: room.hostId,
      hostName: room.hostName
    });
    return;
  }

  if (!room.hostId) {
    room.hostId = playerId;
    room.hostName = playerName;
  }

  ws.playerId = playerId;
  ws.roomName = roomName;
  ws.playerName = playerName;

  // dopisz do stanu gry
  room.state.players.push({ id: playerId, name: playerName });
  room.state.scorecard[playerId] = {};

  // potwierdzenie do dołączającego
    sendJSON(ws, {
      type:    'joined',
      playerId,
      players: room.state.players,
      hostId:   room.hostId,
      hostName: room.hostName
    });
  
    // powiadom wszystkich o nowej liście w lobby
    broadcastToRoom(roomName, {
      type:    'lobbyUpdate',
      players: room.state.players,
      hostId:   room.hostId,
      hostName: room.hostName
    });

  ws.on('close', () => {
    const player = room.state.players.find(p => p.id === ws.playerId);
    if (player) {
      player.disconnected = true; // Oznacz gracza jako rozłączonego
    }

    room.clients.delete(ws);

    // Jeśli host odchodzi
    if (playerId === room.hostId) {
      if (room.clients.size > 0) {
        // Przekaż rolę hosta pierwszemu aktywnemu graczowi
        const newHost = room.state.players.find(p => !p.disconnected);
        if (newHost) {
          room.hostId = newHost.id;
          room.hostName = newHost.name;
          broadcastToRoom(roomName, {
            type: 'hostChanged',
            hostId: room.hostId,
            hostName: room.hostName,
            players: room.state.players
          });
        }
      } else {
        // Nikt nie został → usuń pokój
        rooms.delete(roomName);
        return;
      }
    } else {
      // Normalny gracz odchodzi → tylko aktualizacja lobby
      broadcastToRoom(roomName, {
        type: 'lobbyUpdate',
        players: room.state.players,
        hostId: room.hostId,
        hostName: room.hostName
      });
    }
  });
});

setInterval(() => {
  for (const [roomName, room] of rooms) {
    room.state.players = room.state.players.filter(p => !p.disconnected || Date.now() - p.lastSeen < 60000); // 60 sekund
    if (room.clients.size === 0 && room.state.players.length === 0) {
      rooms.delete(roomName); // Usuń pusty pokój
    }
  }
}, 30000); // Co 30 sekund


