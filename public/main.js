import { 
  drawDice, showSetup, showGameOver
} from './ui.js';

import { CATS, TYPES,  buildStart, buildRoll, buildToggle, buildSelect, categoryCodes, parseMessage} from './protocol.js';

// ====== ZMIENNE GLOBALNE ======
let ws;
let playerId = null;
let roomCode = null;
let playerName = null;
let isHost = false;
let userInitiatedClose = false; //flaga do rozróżnienia zamknięcia połączenia przez użytkownika
let players = [];
let isReloading = false; // flaga do rozróżnienia zamknięcia połączenia przez użytkownika
let isMyTurn = false;
let lastState = null;
let gameState    = null;   // dostajesz ją w TYPES.INIT / UPDATE
let scorePreview = null;

// ====== ELEMENTY DOM ======
const errDiv      =  document.getElementById('error');
const setupDiv    = document.getElementById('setup');
const lobbyDiv    = document.getElementById('lobby');
const gameCanvas  = document.getElementById('gameCanvas');
const nameInput   = document.getElementById('playerName');
const roomInput   = document.getElementById('roomCodeInput');
const btnCreate   = document.getElementById('btnCreate');
const btnJoin     = document.getElementById('btnJoin');
const lobbyCodeSp = document.getElementById('lobbyCode');
const lobbyHostSp = document.getElementById('lobbyHost');
const playersList = document.getElementById('playersList');
const startBtn    = document.getElementById('startGame');
const cancelBtn   = document.getElementById('cancel');
const gameInfo    = document.getElementById('gameInfo');
let isGameOver = false;
const PROTO_VER = 2;  

// ukrywamy lobby i canvas dopóki nie połączymy
lobbyDiv.style.display   = 'none';
gameCanvas.style.display = 'none';


//listy kategorii i etykiety
const categoryLabels = {
  ones: 'Jedynki', twos: 'Dwójki', threes: 'Trójki', fours: 'Czwórki', fives: 'Piątki', sixes: 'Szóstki', threeOfAKind: 'Trójka', fourOfAKind: 'Czwórka', 
  fullHouse: 'Full', smallStraight: 'Mały strit', largeStraight: 'Duży strit', yahtzee: 'Yahtzee', chance: 'Szansa', bonus: 'Bonus', total: 'Suma'};


// ====== OBSŁUGA ODŚWIEŻANIA KARTY ======
window.addEventListener('beforeunload', () => {
  isReloading = true; });

// Przywracanie danych z sessionStorage
window.addEventListener('load', () => {
  const storedRoomCode = sessionStorage.getItem('roomCode');
  const storedPlayerName = sessionStorage.getItem('playerName');
  const storedPlayerId = sessionStorage.getItem('playerId');
  const storedIsHost = sessionStorage.getItem('isHost') === 'true';
  const storedPhase = sessionStorage.getItem('phase');

  if (!storedRoomCode || !storedPlayerName) {
    return showSetup(); // Jeśli brakuje danych, wróć do ekranu początkowego
  }

  // Przywróć dane identyfikacyjne
  roomCode = storedRoomCode;
  playerName = storedPlayerName;
  playerId = storedPlayerId;
  isHost = storedIsHost;

  // Zawsze otwieraj połączenie WebSocket
  joinRoom(roomCode, playerName);

  // Ukryj setup, jeśli gra jest w toku
  if (storedPhase === 'playing') {
    setupDiv.style.display = 'none';
  }

  // UI ustawiane jest w handlerach reconnect / update
});

  // ====== RENDEROWANIE GRY ======
  export function renderGame(state, scorePreview) {
    lastState = state;
    //  rysuj kostki
    drawDice(state.dice, state.locked);
    //  wyświetl bieżącą turę i rzuty
    document.getElementById('roundDisplay').textContent = `${state.players[state.currentTurn].name}`; //tura
    document.getElementById('rollsLeft').textContent = `${state.rollsLeft}`; //rzuty
    //  wypełnij tabelę i steruj przyciskami
    buildScoreBoard(state, scorePreview);
    document.getElementById('scoreTable').style.display = '';
      // pokaż planszę i infopanel
    setupDiv.style.display = 'none';
    lobbyDiv.style.display = 'none';
    gameCanvas.style.display = '';
    gameInfo.style.display   = '';
    document.getElementById('scoreTable').style.display = ''; // pokaż tabelę wyników
  }


  function applyDelta(d) {
  if (d.dice) 
    gameState.dice = d.dice;
  if (d.locked) 
    gameState.locked = d.locked;
  if (d.rollsLeft!==undefined) 
    gameState.rollsLeft = d.rollsLeft;
  if (d.turn!==undefined) 
    gameState.currentTurn = d.turn;
  if (d.commit) {
    const { player, cat, val } = d.commit;
    gameState.scorecard[player][CATS[cat]] = val;
  }
  if (d.preview) scorePreview = arrayToPreviewObj(d.preview);
}

function arrayToPreviewObj(arr) {
  return Object.fromEntries(CATS.map((c,i) => [c, arr[i]]));
}

function persistStablePart() {
  if (!gameState) return; 
  sessionStorage.setItem('gameState', JSON.stringify({
    dice:         gameState.dice,
    locked:       gameState.locked,
    currentTurn:  gameState.currentTurn,
    rollsLeft:    gameState.rollsLeft,
    scorecard:    gameState.scorecard,
    players:      gameState.players,
  }));
}


// ====== FUNKCJA ŁĄCZĄCA WS ======
function joinRoom(code, name) {
  roomCode   = code;
  playerName = name;
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('playerName', playerName);
  sessionStorage.setItem('isHost', isHost);

  const idParam = playerId ? `&id=${playerId}` : '';
  ws = new WebSocket(`ws://${location.host}?room=${code}` + `&name=${encodeURIComponent(name)}` + `&v=${PROTO_VER}${idParam}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    console.log('Połączono z pokojem', code);
    isReloading = false;
  };

  ws.onmessage = e => {

    const { type, ...data } = parseMessage(e.data);
    switch (type) {
      case TYPES.JOINED:
        playerId = data.playerId;
        players = data.players;
        sessionStorage.setItem('playerId', playerId);
        isHost = (data.hostId === playerId);
        lobbyHostSp.textContent = data.hostName;
        document.getElementById('playerNameDisplay').textContent = playerName;
        updateLobbyUI();
        break;

      case TYPES.LOBBY_UPDATE:
        players = data.players;
        isHost = (data.hostId === playerId);
        lobbyHostSp.textContent = data.hostName;
        updateLobbyUI();
        break;

      case TYPES.HOST_CHANGED:
        isHost = (data.hostId === playerId);
        updateLobbyUI();
        break;

      case TYPES.GAME_START:
        const emptyCard = Object.fromEntries(
          CATS.map(c => [c, null])
        );
        // scorecard
        const rebuilt = {};
        data.state.players.forEach(p => {
          rebuilt[p.id] = { ...emptyCard };
        });

        // 3) pełny gameState z nadpisanym, pustym scorecard
        gameState = {...data.state, scorecard: rebuilt};

        // 4) preview 0-owe jak dotąd
        scorePreview = Object.fromEntries(CATS.map(c => [c, 0]));

        renderGame(gameState, scorePreview);
        persistStablePart();
        break;

      case TYPES.RECONNECT:
        document.getElementById('playerNameDisplay').textContent = playerName;
        gameState = data.state;
        scorePreview = data.scorePreview;
        renderGame(gameState, scorePreview);
        persistStablePart();
        break;

      case TYPES.DELTA:
        console.log('Delta update');
        if (!gameState) return;           // delta przed pełnym stanem – ignoruj
        applyDelta(data.delta);
        renderGame(gameState, scorePreview);
        if (data.delta.commit || data.delta.turn !== undefined)
          persistStablePart();
        break;

      // case TYPES.UPDATE:
      //   console.warn('UPDATE (fallback)!', data);
      //   gameState = data.state;
      //   scorePreview = data.scorePreview;
      //   renderGame(gameState, scorePreview);
      //   persistStablePart();       // to ZAPISZE stan – nie powielaj ręcznie
      //   break;

      case TYPES.GAME_OVER:
        sessionStorage.setItem('phase', 'finished');
        showGameOver(lastState, data.scorecard);
        isGameOver = true;
        ws.close(1000, 'game over');
        sessionStorage.clear();
        break;

      case TYPES.ERROR:
        alert(data.message);
        break;
      default:
        console.warn('Nieznany typ wiadomości:', type);
        break;
    }
  };

  ws.onerror = (error) => console.error("WebSocket napotkał błąd:", error);

  ws.onclose = (event) => {
    if (isGameOver) return; 
    console.log("WebSocket został zamknięty. Kod:", event.code, "Powód:", event.reason);
    if (isReloading) return;
    if (!userInitiatedClose) {
      showSetup();
      errDiv.style.display = '';
    } else {
      sessionStorage.clear();
      showSetup();
    }
  };
}

// ====== AKTUALIZACJA LOBBY ======
function updateLobbyUI() {
  // widoki
  setupDiv.style.display = 'none';
  lobbyDiv.style.display = '';
  lobbyCodeSp.textContent = roomCode;

  // lista graczy wg imion
  playersList.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p.name;
    if (p.id === playerId) li.style.fontWeight = 'bold';
    playersList.appendChild(li);
  });

  // start tylko dla hosta i min. 2 graczy
  startBtn.disabled = !(isHost && players.length >= 2);
}

// ====== OBSŁUGA PRZYCISKÓW ======
btnCreate.addEventListener('click', async () => {
  const name = nameInput.value.trim();
  if (!name) return alert('Podaj imię');
  playerName = name;
  // pobranie kodu pokoju
  const res  = await fetch('/create-room');
  const { roomCode: code } = await res.json();
  isHost = true;
  joinRoom(code, name);
  errDiv.style.display = 'none';
});

btnJoin.addEventListener('click', () => {
  const name = nameInput.value.trim();
  const code = roomInput.value.trim().toUpperCase();
  if (!name || !code) return alert('Podaj imię i kod pokoju');
  isHost = false;
  joinRoom(code, name);
  errDiv.style.display = 'none';
});

startBtn.addEventListener('click', () => {
  sessionStorage.setItem('phase', 'playing');
  ws.send(buildStart());
});

cancelBtn.addEventListener('click', () => {
  userInitiatedClose = true; // flaga do rozróżnienia zamknięcia połączenia przez użytkownika
  sessionStorage.setItem('phase', 'lobby');
  ws.close();
});

document.getElementById('rollDice').addEventListener('click', () => {
  ws.send(buildRoll());
});


// sprawdz która kostka została kliknięta
gameCanvas.addEventListener('click', (event) => {
  if (!isMyTurn) return;
  const rect = gameCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const index = Math.floor(x / 90);
  if (index >= 0 && index < 5) {
    ws.send(buildToggle(index));
  }
});

document.getElementById('scoreBoard').addEventListener('click', e => {
  const btn = e.target.closest('button.acceptBtn');
  if (!btn) return;
  const category = btn.dataset.category;
  const code = categoryCodes[category];
  if (code === undefined) return;
  ws.send(buildSelect(code));
});

// Buduje i renderuje tabelę wyników (scoreboard)
export function buildScoreBoard(state, scorePreview) {
  const table  = document.getElementById('scoreBoard');
  const theadR = table.querySelector('thead tr');
  const tbody  = table.querySelector('tbody');
  const upperSectionCategories = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

  // Nagłówek: Kategoria + imiona graczy
  theadR.innerHTML = '<th>Kategoria</th>';
  state.players.forEach(p => {
    const th = document.createElement('th');
    th.textContent = p.name + (p.id === playerId ? ' (Ty)' : '');
    theadR.appendChild(th);
  });

  // Czyja tura?
  const currentPlayerId = state.players[state.currentTurn].id;
  isMyTurn = (currentPlayerId === playerId);

  // Ciało tabeli – po jednej linii na kategorię
  tbody.innerHTML = '';
  CATS.forEach(cat => {
    const tr = document.createElement('tr');
    tr.dataset.category = cat;

    // Nazwa kategorii
    const tdLabel = document.createElement('td');
    tdLabel.textContent = categoryLabels[cat];
    tr.appendChild(tdLabel);

    // Kolumny z punktami dla każdego gracza
    state.players.forEach(p => {
      const cell = document.createElement('td');
      const catName = tr.dataset.category;
      const val = state.scorecard[p.id][catName];

      // Obsługa bonusu
      if (catName === 'bonus') {
        const upperScore = upperSectionCategories
          .reduce((sum, c) => sum + (state.scorecard[p.id][c] || 0), 0);
        cell.textContent = upperScore >= 63 ? '35' : `0 (${upperScore}/63)`;
        tr.appendChild(cell);
        return;
      }

      // obliczenie sumy punktow
      if (catName === 'total') {
        const actualScore = Object
          .values(state.scorecard[p.id])
          .filter(v => typeof v === 'number')
          .reduce((sum, v) => sum + v, 0);
        const upperSum = upperSectionCategories
          .reduce((sum, c) => sum + (state.scorecard[p.id][c] || 0), 0);
        const bonus = upperSum >= 63 ? 35 : 0;
        const total = actualScore + bonus;
        cell.textContent = total;
        tr.appendChild(cell);
        return;
      }

      // Pozostałe kategorie
      if (p.id === playerId) {
        // Moja kolumna
        if (!isMyTurn) {
          cell.textContent = val != null ? val : '–';
        } else {
          if (val != null) {
            cell.textContent = val;
          } else {
            // Podgląd punktów + przycisk akceptacji
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-container';
            const badge = document.createElement('span');
            badge.className = 'preview-badge';
            badge.textContent = `+${scorePreview[catName]}`;
            const btn = document.createElement('button');
            btn.className = 'acceptBtn';
            btn.dataset.category = catName;
            btn.disabled = false;
            btn.innerHTML = '<svg>…</svg>';
            wrapper.append(badge, btn);
            cell.appendChild(wrapper);
          }
        }
      } else {
        // Kolumna przeciwnika
        cell.textContent = val != null ? val : '–';
      }

      tr.appendChild(cell);
    });

    tbody.appendChild(tr);
  });
}
