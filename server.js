const express = require('express');
const http    = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// Serwuj pliki klienta (index.html + JS + assets)
app.use(express.static('public'));

server.listen(1234, () => {
  console.log('Serwer HTTP + WS działa na porcie 1234');
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomName = url.searchParams.get('room');
  const incomingId = url.searchParams.get('id');
  const playerName = url.searchParams.get('name')?.trim();
  const room = rooms.get(roomName);

  // 1️⃣ Pokój musi istnieć
  if (!room) {
    ws.close();
    return;
  }

  // ── 1) ZAREJESTRUJ HANDLERY ZAWSZE ──────────────────────────────────────
  ws.on('message', data => {
    const msg = JSON.parse(data);
    const state = room.state;
    const currentPlayer = state.players[state.currentTurn];

    // START GRY
    if (msg.type === 'start' && ws.playerId === room.hostId && state.phase === 'lobby') {
      state.phase = 'playing';
      broadcastToRoom(roomName, { type: 'gameStart', state });
      return;
    }

    // RZUCANIE KOŚCI
    if (msg.type === 'rollDice') {
      if (ws.playerId !== currentPlayer.id) {
        ws.send(JSON.stringify({ type: 'error', message: 'To nie jest Twoja tura!' }));
        return;
      }
      try {
        rollDice(state);
        const preview = generateScorePreview(state.dice);
        broadcastToRoom(roomName, { type: 'update', state, scorePreview: preview });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      return;
    }

    // BLOKOWANIE KOŚCI
    if (msg.type === 'toggleLock') {

      if (state.dice.includes(0)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Nie można blokować kości przed rzutem!' }));
        return;
      }
      try {
        toggleLock(state, msg.index);
        const preview = generateScorePreview(state.dice);
        broadcastToRoom(roomName, { type: 'update', state, scorePreview: preview });
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
      return;
    }

    // ZAKOŃCZENIE TURY
    if (msg.type === 'endTurn') {
      endTurn(state);
      const preview = generateScorePreview(state.dice);
      broadcastToRoom(roomName, { type: 'update', state, scorePreview: preview });
      return;
    }

    // WYBÓR KATEGORII
    if (msg.type === 'selectCategory') {
      const { category } = msg;
      if (ws.playerId !== currentPlayer.id) {
        ws.send(JSON.stringify({ type: 'error', message: 'To nie jest Twoja tura!' }));
        return;
      }
      if ((state.scorecard[ws.playerId][category] !== null)||state.dice.includes(0)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Błąd - kategoria jest już zajęta lub kości nie zostały rzucone!' }));
        return;
      }
      // policz punkty i zmień turę
      state.scorecard[ws.playerId][category] = calculateScore(state.dice, category);
      state.dice = [0, 0, 0, 0, 0]; // reset kostek
      endTurn(state);
      // sprawdź koniec gry
      const allFilled = Object.values(state.scorecard)
        .every(scores => Object.values(scores).every(s => s !== null));
      if (allFilled) {
        state.phase = 'finished';
        broadcastToRoom(roomName, { type: 'gameOver', scorecard: state.scorecard });
      } else {
        const preview = generateScorePreview(state.dice);
        broadcastToRoom(roomName, { type: 'update', state, scorePreview: preview });
      }
      return;
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.state.phase === 'lobby') {
      // usuwanie gracza z lobby i ewentualna zmiana hosta...
      room.state.players = room.state.players.filter(p => p.id !== ws.playerId);
      if (ws.playerId === room.hostId) {
        if (room.clients.size > 0) {
          const newHost = room.state.players[0];
          room.hostId = newHost.id;
          room.hostName = newHost.name;
          broadcastToRoom(roomName, {
            type: 'hostChanged',
            hostId: room.hostId,
            hostName: room.hostName,
            players: room.state.players
          });
        } else {
          rooms.delete(roomName);
        }
      } else {
        broadcastToRoom(roomName, {
          type: 'lobbyUpdate',
          players: room.state.players,
          hostId: room.hostId,
          hostName: room.hostName
        });
      }
    }
  });
  // ── HANDLERY PODPIĘTE ────────────────────────────────────────────────────

  // teraz możesz bezpiecznie robić reconnect vs. new player:

  // 2) RECONNECT
  if (room.state.phase === 'playing') {
    const player = room.state.players.find(p => p.id === incomingId);
    if (!player) {
      ws.send(JSON.stringify({ type: 'error', message: 'Nie rozpoznano gracza.' }));
      return ws.close();
    }
    room.clients.add(ws);
    ws.playerId = incomingId;
    ws.playerName = player.name;
    sendJSON(ws, {
      type: 'reconnect',
      state: room.state,
      scorePreview: generateScorePreview(room.state.dice)
    });
    return;
  }

  // 3) NOWY GRACZ W LOBBY
  if (!playerName) {
    ws.close();
    return;
  }

  const playerId = generateUniqueId();
  room.clients.add(ws);
  ws.playerId = playerId;
  ws.playerName = playerName;

  // Jeśli pierwszy gracz, ustaw hosta
  if (!room.hostId) {
    room.hostId = playerId;
    room.hostName = playerName;
  }

  // Dodaj gracza do stanu gry
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
    chance: null
  };

  // Wyślij potwierdzenie dołączenia
  sendJSON(ws, {
    type: 'joined',
    playerId,
    players: room.state.players,
    hostId: room.hostId,
    hostName: room.hostName
  });

  // Powiadom wszystkich w pokoju o nowym graczu
  broadcastToRoom(roomName, {
    type: 'lobbyUpdate',
    players: room.state.players,
    hostId: room.hostId,
    hostName: room.hostName
  });

  console.log(`[WS Connect] Gracz ${playerName} (${playerId}) dołączył do pokoju ${roomName}`);
});

function calculateScore(dice, category) {
  const counts = Array(7).fill(0); // Licznik dla wartości od 1 do 6
  dice.forEach(d => counts[d]++);

  // Posortuj kostki i usuń duplikaty
  const sortedDice = [...new Set(dice)].sort((a, b) => a - b);

  // Możliwe sekwencje dla stritów
  const smallStraights = [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
    [3, 4, 5, 6]
  ];
  const largeStraights = [
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6]
  ];

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
    case 'smallStraight':
      return smallStraights.some(straight => straight.every(num => sortedDice.includes(num))) ? 30 : 0;
    case 'largeStraight':
      return largeStraights.some(straight => straight.every(num => sortedDice.includes(num))) ? 40 : 0;
    case 'yahtzee': 
      return counts.some(c => c === 5) && !dice.includes(0) ? 50 : 0;
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
