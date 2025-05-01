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
  const incomingId = url.searchParams.get('id');
  const playerId = generateUniqueId();

  if (!roomName || !rooms.has(roomName) || !playerName) {
    ws.close();
    return;
  }

  const room = rooms.get(roomName);
  
  //####
  if (room.state.phase === 'playing') {
    // 2a) pozwól reconnect tylko temu, kto już był w players[]
    const existing = room.state.players.find(p => p.id === incomingId);
    if (!existing) {
      ws.close();
      return;
    }
    // 2b) zaakceptuj nowe ws dla tego samego playerId
    ws.playerId   = incomingId;
    ws.playerName = existing.name;
    ws.roomName   = roomName;
    room.clients.add(ws);

    // 2c) od razu wyślij stan gry, żeby klient mógł zrekonstruować widok
    sendJSON(ws, {
      type:  'reconnect',
      state: room.state
    });
    // i nie robimy dalszej logiki lobby
    return;
  }
  //####
  


  // sprawdź, czy pokój istnieje i czy jest w fazie lobby
  // jeśli nie, zamknij połączenie i nie dodawaj gracza
  if (!room || room.state.phase !== 'lobby') {
    ws.close();
    return;
  }

  room.clients.add(ws);

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

  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.type === 'start' && ws.playerId === room.hostId) {
      // ustawiamy fazę gry
      room.state.phase = 'playing';
      // rozsyłamy do wszystkich aktualny stan początkowy
      broadcastToRoom(roomName, {
        type: 'gameStart',
        state: room.state
      });
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    room.state.players = room.state.players.filter(p => p.id !== ws.playerId);
        // jeśli host odchodzi
    if (playerId === room.hostId) {
      if (room.clients.size > 0) {
        // przekaż rolę hosta pierwszemu
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
       // nikt nie został → usuń pokój
        rooms.delete(roomName);
        return;
      }
    } else {
      // normalny gracz odchodzi → tylko aktualizacja lobby
      broadcastToRoom(roomName, {
        type:    'lobbyUpdate',
        players: room.state.players,
        hostId:   room.hostId,
        hostName: room.hostName
      });
    }
  });
});


