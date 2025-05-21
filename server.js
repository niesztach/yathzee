const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const { categoryCodes } = require('./public/protocol.js');

const {
  TYPES,
  parseMessage,
  buildError,
  buildJoined,
  buildLobbyUpdate,
  buildHostChanged,
  buildGameStart,
  buildUpdate,
  buildGameOver,
  buildReconnect,
  buildDelta
} = require('./protocol-server.js');


const app = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server,
  perMessageDeflate: {    // ← WŁĄCZAMY
   // opcjonalne tuningi (podane sensowne minimum)
   threshold: 128,       // kompresuj ramki ≥128 B
   concurrencyLimit: 10, // jednocześnie max 10 strumieni deflate
 },
 });



// Serwuj pliki klienta (index.html + JS + assets)
app.use(express.static('public'));

server.listen(1234, '0.0.0.0', () => {
  console.log('Serwer HTTP + WS działa na porcie 1234');
});

function sendBinary(ws, buffer) {
  ws.send(buffer); // już Buffer
}

function broadcastBinaryToRoom(roomName, buffer) {
  const room = rooms.get(roomName);
  if (!room) return;
  for (const client of room.clients) {
    sendBinary(client, buffer);
  }
}

function broadcastState(room) {
  const curr = room.state;
  const prev = room.prevState
      ? room.prevState
      : structuredClone(curr);      //  ←  fallback kopia, nie referencja
  // 1) policz preview *dla każdego* gracza
  const previews = {};
  curr.players.forEach(p => {
    previews[p.id] = generateScorePreview(curr.dice, curr.scorecard[p.id]);
  });

  // 2) wyślij do każdego jego wariant
  room.clients.forEach(sock => {
    const buf = sock.supportsDelta
      ? buildDelta(prev, curr, previews[sock.playerId])
      : buildUpdate(curr, previews[sock.playerId]);
    sendBinary(sock, buf);
  });

  // 3) zapamiętaj snapshot na następną deltę
  room.prevState = structuredClone(curr);
}

// Każdy pokój ma swój stan gry i listę ws-ów
const rooms = new Map();

function generateUniqueId() { return Math.random().toString(36).slice(2); }

function createInitialGameState() {
  return {
    phase: 'lobby',
    players: [],
    dice: [0, 0, 0, 0, 0],
    locked: [false, false, false, false, false],
    currentTurn: 0,
    rollsLeft: 3,
    scorecard: {}, 
  };
}

function rollDice(state) {
  if (state.rollsLeft <= 0) {
    throw new Error('No rolls left'); 
  }
  state.dice = state.dice.map((val, i) =>
    state.locked[i] ? val : Math.floor(Math.random() * 6) + 1
  );
  state.rollsLeft--;
}

function toggleLock(state, index) {
  if (index < 0 || index >= state.dice.length) throw new Error('Invalid dice index');
  state.locked[index] = !state.locked[index];
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
    prevState: null,          //  ← NOWE
    hostId: null,
    hostName: null
  });
  res.json({ roomCode: code });
});

function calculateScore(dice, category) {
  const counts = Array(7).fill(0); // Licznik dla wartości od 1 do 6
  dice.forEach(d => counts[d]++);

  // sortowanie kostek do stritów
  const sortedDice = [...new Set(dice)].sort((a, b) => a - b);

  // Możliwe sekwencje dla stritów
  const smallStraights = [[1, 2, 3, 4], [2, 3, 4, 5], [3, 4, 5, 6]];
  const largeStraights = [ [1, 2, 3, 4, 5],  [2, 3, 4, 5, 6]];

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

function generateScorePreview(dice, scorecard ={}) {
  const categories = [
    'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
    'threeOfAKind', 'fourOfAKind', 'fullHouse',
    'smallStraight', 'largeStraight', 'yahtzee', 'chance'
  ];
  const preview = {};

  // Oblicz punkty dla każdej kategorii
  categories.forEach(category => {
    preview[category] = calculateScore(dice, category);
  });

  // Oblicz bonus
  const upperSectionCategories = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
  const upperSectionScore = upperSectionCategories.reduce((sum, category) => {
    return sum + (scorecard[category] || 0); // Dodaj istniejące punkty z scorecard
  }, 0);
  preview['bonus'] = upperSectionScore >= 63 ? 35 : 0;

    // Zamiast sumować wartości potencjalne, sumujemy to, co już ma gracz
    const actualScore = Object.values(scorecard).reduce((sum, pts) => sum + (pts || 0), 0);
    preview.total = actualScore + preview.bonus;

  return preview;
}


// ############  obsługa websocketów ###################

wss.on('connection', (ws, req) => {
  const url       = new URL(req.url, `http://${req.headers.host}`);
  const v         = Number(url.searchParams.get('v') || 1);
  ws.supportsDelta = v >= 2;               //  ← NOWE
  const roomName  = url.searchParams.get('room');
  const incomingId= url.searchParams.get('id');
  const playerName= url.searchParams.get('name')?.trim();
  const room      = rooms.get(roomName);
  if (!room) { ws.close(); return; }

  // Always register message handler
  ws.on('message', data => {
    const msg = parseMessage(data);
    const state = room.state;
    const current = state.players[state.currentTurn];

    // START
    if (msg.type===TYPES.START && ws.playerId===room.hostId && state.phase==='lobby') {
      state.phase='playing';
      room.prevState = structuredClone(state); //zeby mial odpowiedni preview na poczatku
      const cleanState = structuredClone(state);   
      delete cleanState.scorecard;                 // nie ma sensu wysylac punktacji przed rozpoczeciem gry
    return broadcastBinaryToRoom(roomName, buildGameStart(cleanState));
    }

    // ROLL
    if (msg.type===TYPES.ROLL) {
      if (ws.playerId!==current.id) return sendBinary(ws, buildError('To nie jest Twoja tura!'));
      if (state.locked.every(l=>l)) return sendBinary(ws, buildError('Nie możesz zablokować wszystkich kości przed rzutem.'));
      try {
        rollDice(state);
        broadcastState(room);  
        return; 
      } catch(e) { return sendBinary(ws, buildError(e.message)); }
    }

    // TOGGLE
    if (msg.type===TYPES.TOGGLE) {
      if (state.dice.includes(0)) return sendBinary(ws, buildError('Nie można blokować kości przed rzutem!'));
      try {
        toggleLock(state, msg.index);
        broadcastState(room);
        return;
      } catch(e) { return sendBinary(ws, buildError(e.message)); }
    }

  // SELECT
  if (msg.type === TYPES.SELECT) {
    const code = msg.categoryCode;
    const category = Object.entries(categoryCodes).find(([,c]) => c === code)?.[0];
    if (!category) return sendBinary(ws, buildError('Nieznana kategoria'));
    if (ws.playerId !== current.id) return sendBinary(ws, buildError('To nie jest Twoja tura!'));
    if (state.scorecard[ws.playerId][category] != null || state.dice.includes(0))
    return sendBinary(ws, buildError('Błąd - kategoria zajęta lub kości nie zostały rzucone!'));

    // Zapisanie wyniku
    state.scorecard[ws.playerId][category] = calculateScore(state.dice, category);

    // Przekazanie zmian delta
    state.lastCommit = {
      playerId: ws.playerId, cat: category, value: state.scorecard[ws.playerId][category]};

    // Sprawdź, czy to był ostatni ruch
    const allFilled = Object.values(state.scorecard).every(sc => Object.values(sc).every(v => v != null));

    // obsługa końca gry
    if (allFilled) {
      console.log('MSG: KONIEC GRY');
      state.phase = 'finished';
      broadcastState(room);
      return broadcastBinaryToRoom(roomName, buildGameOver(state.scorecard));
    }

    // NIE KONIEC GRY → zmień turę
    state.dice = [0, 0, 0, 0, 0];
    endTurn(state);
    broadcastState(room);
    return;
    }

    // Nieznany typ
    return sendBinary(ws, buildError('Nieznany typ wiadomości'));
  });

  // CLOSE handler – lobby cleanup & host changes
  ws.on('close', () => {
    room.clients.delete(ws);
    if (room.state.phase==='lobby') {
      room.state.players = room.state.players.filter(p=>p.id!==ws.playerId);
      if (ws.playerId===room.hostId) {
        if (room.clients.size>0) {
          const newHost=room.state.players[0];
          room.hostId=newHost.id; room.hostName=newHost.name;
          broadcastBinaryToRoom(roomName, buildHostChanged(room.hostId, room.hostName, room.state.players));
        } else {
          rooms.delete(roomName);
        }
      } else {
        broadcastBinaryToRoom(roomName, buildLobbyUpdate(room.state.players, room.hostId, room.hostName));
      }
    }
  });

  // RECONNECT lub NOWY GRACZ
  if (room.state.phase==='playing') {
    const ply = room.state.players.find(p=>p.id===incomingId);
    if (!ply) return sendBinary(ws, buildError('Nie rozpoznano gracza.'));
    room.clients.add(ws);
    ws.playerId=incomingId; ws.playerName=ply.name;
    return sendBinary(ws, buildReconnect(room.state, generateScorePreview(room.state.dice)));
  }
  if (!playerName) { ws.close(); return; }

  // NOWY GRACZ W LOBBY
  const pid = generateUniqueId();
  room.clients.add(ws);
  ws.playerId=pid; ws.playerName=playerName;
  if (!room.hostId) { room.hostId=pid; room.hostName=playerName; }
  room.state.players.push({id:pid,name:playerName});
  room.state.scorecard[pid]={
    ones:null,twos:null,threes:null,fours:null,fives:null,sixes:null,
    threeOfAKind:null,fourOfAKind:null,fullHouse:null,smallStraight:null,largeStraight:null,yahtzee:null,chance:null
  };
  sendBinary(ws, buildJoined(pid, room.state.players, room.hostId, room.hostName));
  broadcastBinaryToRoom(roomName, buildLobbyUpdate(room.state.players, room.hostId, room.hostName));
  console.log(`[WS] ${playerName} (${pid}) -> ${roomName}`);
});

