const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const RoomManager = require('./game/manager');

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
  const url        = new URL(req.url, `http://${req.headers.host}`);
  const roomName   = url.searchParams.get('room');
  const playerName = url.searchParams.get('name')?.trim();
  const incomingId = url.searchParams.get('id');
  const room       = rooms.get(roomName);

  // 1️⃣ Pokój musi istnieć
  if (!room) {
    ws.close();
    return;
  }

  // 2️⃣ Faza gry: tylko reconnect istniejących graczy
  if (room.state.phase === 'playing') {
    const existing = room.state.players.find(p => p.id === incomingId);
    if (!existing) {
      ws.close();
      return;
    }
    // zaakceptuj WS tego gracza
    ws.playerId   = incomingId;
    ws.playerName = existing.name;
    ws.roomName   = roomName;
    room.clients.add(ws);

    // wyślij pełny stan gry
    sendJSON(ws, { type: 'reconnect', state: room.state });
    return;
  }

  // 3️⃣ Faza lobby: nowy gracz
  if (!playerName) {
    ws.close();
    return;
  }
  const playerId = generateUniqueId();
  room.clients.add(ws);
  ws.playerId   = playerId;
  ws.playerName = playerName;
  ws.roomName   = roomName;

  // jeśli pierwszy, ustaw hosta
  if (!room.hostId) {
    room.hostId   = playerId;
    room.hostName = playerName;
  }

  // dopisz do listy i scorecard
  room.state.players.push({ id: playerId, name: playerName });
  room.state.scorecard[playerId] = {};

  // potwierdź dołączanie + powiadom wszystkich
  sendJSON(ws, {
    type:     'joined',
    playerId,
    players:  room.state.players,
    hostId:   room.hostId,
    hostName: room.hostName
  });
  broadcastToRoom(roomName, {
    type:     'lobbyUpdate',
    players:  room.state.players,
    hostId:   room.hostId,
    hostName: room.hostName
  });

  // 4️⃣ Obsługa start gry
  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.type === 'start' && ws.playerId === room.hostId) {
      room.state.phase = 'playing';
      broadcastToRoom(roomName, { type: 'gameStart', state: room.state });
    }
  });

  // 5️⃣ Obsługa rozłączenia
  ws.on('close', () => {
    room.clients.delete(ws);
    // usuń z listy tylko w lobby
    if (room.state.phase === 'lobby') {
      room.state.players = room.state.players.filter(p => p.id !== ws.playerId);
      // obsłuż zmianę hosta lub zamknięcie pokoju, jak dotąd
      if (ws.playerId === room.hostId) {
        if (room.clients.size > 0) {
          const newHost = room.state.players[0];
          room.hostId   = newHost.id;
          room.hostName = newHost.name;
          broadcastToRoom(roomName, {
            type:     'hostChanged',
            hostId:   room.hostId,
            hostName: room.hostName,
            players:  room.state.players
          });
        } else {
          rooms.delete(roomName);
        }
      } else {
        broadcastToRoom(roomName, {
          type:    'lobbyUpdate',
          players: room.state.players,
          hostId:   room.hostId,
          hostName: room.hostName
        });
      }
    }
    // w fazie gry połączenie dropnięte – nie usuwamy z players[], więc przy reconnect 
    // da się wrócić do rozgrywki
  });
});
