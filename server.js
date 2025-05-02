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
    players: [],
    dice: [0, 0, 0, 0, 0],
    locked: [false, false, false, false, false],
    currentTurn: 0,
    rollsLeft: 3,
    scorecard: {}, // { playerId: { ones: null, twos: null, ... } }
  };
}

function rollDice(state) {
  if (state.rollsLeft <= 0) {
    throw new Error('No rolls left'); // Możesz to zastąpić komunikatem do klienta
  }
  state.dice = state.dice.map((val, i) =>
    state.locked[i] ? val : Math.floor(Math.random() * 6) + 1
  );
  state.rollsLeft--;
}

function toggleLock(state, index) {
  if (index < 0 || index >= state.dice.length) throw new Error('Invalid dice index');
  state.locked[index] = !state.locked[index]; // Zmień stan blokady
}

function endTurn(state) {
  state.rollsLeft = 3;
  state.locked = [false, false, false, false, false];
  state.currentTurn = (state.currentTurn + 1) % state.players.length;
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
  room.state.scorecard[playerId] = {
    ones: null,
    twos: null,
    threes: null,
    fours: null,
    fives: null,
    sixes: null,
    threeOfAKind: null,
    fourOfAKind: null,
    fullHouse: null,
    smallStraight: null,
    largeStraight: null,
    yahtzee: null,
    chance: null,
  };

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

  // 6️⃣ Obsługa akcji w grze
  ws.on('message', data => {
    const msg = JSON.parse(data);
    const state = room.state;

    // Zdefiniuj currentPlayer raz na początku
    const currentPlayer = state.players[state.currentTurn];

    switch (msg.type) {
      case 'rollDice':
        if (ws.playerId !== currentPlayer.id) {
          ws.send(JSON.stringify({ type: 'error', message: 'To nie jest Twoja tura!' }));
          return;
        }
        try {
          rollDice(state);
          const scorePreview = generateScorePreview(state.dice);
          broadcastToRoom(roomName, { type: 'update', state, scorePreview });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;

      case 'toggleLock':
        try {
          toggleLock(state, msg.index);
          broadcastToRoom(roomName, { type: 'update', state });
        } catch (err) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
        break;

      case 'endTurn':
        endTurn(state);
        broadcastToRoom(roomName, { type: 'update', state });
        break;

      case 'selectCategory':
        const { category } = msg;

        if (ws.playerId !== currentPlayer.id) {
          ws.send(JSON.stringify({ type: 'error', message: 'To nie jest Twoja tura!' }));
          return;
        }

        if (state.scorecard[ws.playerId][category] !== null) {
          ws.send(JSON.stringify({ type: 'error', message: 'Category already filled' }));
          return;
        }

        const score = calculateScore(state.dice, category);
        state.scorecard[ws.playerId][category] = score;

        endTurn(state);

        const allFilled = Object.values(state.scorecard).every(playerScores =>
          Object.values(playerScores).every(score => score !== null)
        );

        if (allFilled) {
          state.phase = 'finished';
          broadcastToRoom(roomName, { type: 'gameOver', scorecard: state.scorecard });
        } else {
          broadcastToRoom(roomName, { type: 'update', state });
        }
        break;
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

function calculateScore(dice, category) {
  const counts = Array(7).fill(0); // Licznik dla wartości od 1 do 6
  dice.forEach(d => counts[d]++);

  switch (category) {
    case 'ones': return counts[1] * 1;
    case 'twos': return counts[2] * 2;
    case 'threes': return counts[3] * 3;
    case 'fours': return counts[4] * 4;
    case 'fives': return counts[5] * 5;
    case 'sixes': return counts[6] * 6;
    case 'threeOfAKind': return counts.some(c => c >= 3) ? dice.reduce((a, b) => a + b, 0) : 0;
    case 'fourOfAKind': return counts.some(c => c >= 4) ? dice.reduce((a, b) => a + b, 0) : 0;
    case 'fullHouse': return counts.includes(3) && counts.includes(2) ? 25 : 0;
    case 'smallStraight': return [1, 1, 1, 1].every((v, i) => counts.slice(i + 1, i + 5).includes(v)) ? 30 : 0;
    case 'largeStraight': return [1, 1, 1, 1, 1].every((v, i) => counts.slice(i + 1, i + 6).includes(v)) ? 40 : 0;
    case 'yahtzee': return counts.some(c => c === 5) ? 50 : 0;
    case 'chance': return dice.reduce((a, b) => a + b, 0);
    default: return 0;
  }
}

function generateScorePreview(dice) {
  const categories = [
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'threeOfAKind', 'fourOfAKind', 'fullHouse',
    'smallStraight', 'largeStraight', 'yahtzee', 'chance'
  ];
  const preview = {};
  categories.forEach(category => {
    preview[category] = calculateScore(dice, category);
  });
  return preview;
}
