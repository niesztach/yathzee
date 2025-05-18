import { 
  drawDice,
  showSetup,
  showGameOver
} from './ui.js';

import {
  TYPES,
  buildStart,
  buildRoll,
  buildToggle,
  buildEndTurn,
  buildSelect,
  categoryCodes,
  parseMessage
} from './protocol.js';

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


// ====== ELEMENTY DOM ======
const errDiv      =  document.getElementById('error');
const setupDiv    = document.getElementById('setup');
const lobbyDiv    = document.getElementById('lobby');
const gameCanvas  = document.getElementById('gameCanvas');
const ctx         = gameCanvas.getContext('2d');

const nameInput   = document.getElementById('playerName');
const roomInput   = document.getElementById('roomCodeInput');
const btnCreate   = document.getElementById('btnCreate');
const btnJoin     = document.getElementById('btnJoin');
const lobbyCodeSp = document.getElementById('lobbyCode');
const lobbyHostSp = document.getElementById('lobbyHost');
const playersList = document.getElementById('playersList');
const startBtn    = document.getElementById('startGame');
const cancelBtn   = document.getElementById('cancel');
const loadingDiv  = document.getElementById('loading');
const gameInfo    = document.getElementById('gameInfo');

//list kategorii i etykiety

const categories = [
  'ones','twos','threes','fours','fives','sixes', 'bonus',
  'threeOfAKind','fourOfAKind','fullHouse',
  'smallStraight','largeStraight','yahtzee','chance',
  'total'
];

const categoryLabels = {
  ones: 'Jedynki', twos: 'Dwójki', threes: 'Trójki',
  fours: 'Czwórki', fives: 'Piątki', sixes: 'Szóstki',
  threeOfAKind: 'Trójka', fourOfAKind: 'Czwórka',
  fullHouse: 'Full', smallStraight: 'Mały strit',
  largeStraight: 'Duży strit', yahtzee: 'Yahtzee',
  chance: 'Szansa', bonus: 'Bonus',
  total: 'Suma'
};



// ukrywamy lobby i canvas dopóki nie połączymy
lobbyDiv.style.display   = 'none';
gameCanvas.style.display = 'none';

// ====== OBSŁUGA ODŚWIEŻANIA KARTY ======
window.addEventListener('beforeunload', () => {
  isReloading = true;
});

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

  // Reszta UI zostanie ustawiona w handlerze 'reconnect' lub 'update'
});

  // ====== RENDEROWANIE GRY ======
  export function renderGame(state, scorePreview) {
    lastState = state;
    // 1) rysuj kostki
    drawDice(state.dice, state.locked);
    // 2) wyświetl bieżącą turę i rzuty
    document.getElementById('roundDisplay').textContent = `Tura: ${state.players[state.currentTurn].name}`;
    document.getElementById('rollsLeft').textContent = `Rzuty: ${state.rollsLeft}`;
    // 3) wypełnij tabelę i steruj przyciskami
    buildScoreBoard(state, scorePreview);
    document.getElementById('scoreTable').style.display = '';
  
    // 6) Pokaż planszę i infopanel
    setupDiv.style.display = 'none';
    lobbyDiv.style.display = 'none';
    gameCanvas.style.display = '';
    gameInfo.style.display   = '';
    document.getElementById('scoreTable').style.display = ''; // Pokaż tabelę wyników
  }



// ====== FUNKCJA ŁĄCZĄCA WS ======
function joinRoom(code, name) {
  roomCode   = code;
  playerName = name;
  sessionStorage.setItem('roomCode', roomCode);
  sessionStorage.setItem('playerName', playerName);
  sessionStorage.setItem('isHost', isHost);

  const idParam = playerId ? `&id=${playerId}` : '';
  ws = new WebSocket(`ws://${location.host}?room=${code}&name=${encodeURIComponent(name)}${idParam}`);
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
        players  = data.players;
        sessionStorage.setItem('playerId', playerId);
        isHost = (data.hostId === playerId);
        lobbyHostSp.textContent = data.hostName;
        document.getElementById('playerNameDisplay').textContent = playerName;
        updateLobbyUI();
        break;
      case TYPES.LOBBY_UPDATE:
      case TYPES.HOST_CHANGED:
        players = data.players;
        isHost = (data.hostId === playerId);
        lobbyHostSp.textContent = data.hostName;
        updateLobbyUI();
        break;
      case TYPES.GAME_START:
        sessionStorage.setItem('phase', 'playing');
        setupDiv.style.display   = 'none';
        lobbyDiv.style.display   = 'none';
        gameCanvas.style.display = '';
        gameInfo.style.display   = '';
        document.getElementById('scoreTable').style.display = '';
        const emptyPreview = {};
        categories.forEach(cat => {
          if (cat !== 'bonus' && cat !== 'total') emptyPreview[cat] = 0;
        });
        renderGame(data.state, emptyPreview);
        break;
      case TYPES.RECONNECT:
        document.getElementById('playerNameDisplay').textContent = playerName;
        renderGame(data.state, data.scorePreview);
        break;
      case TYPES.UPDATE:
        renderGame(data.state, data.scorePreview);
        sessionStorage.setItem('gameState', JSON.stringify({
          dice: data.state.dice,
          locked: data.state.locked,
          currentTurn: data.state.currentTurn,
          rollsLeft: data.state.rollsLeft,
          scorecard: data.state.scorecard,
          players: data.state.players,
        }));
        break;
      case TYPES.GAME_OVER:
        sessionStorage.setItem('phase', 'finished');
        showGameOver(data.scorecard);
        ws.close();
        sessionStorage.clear();
        showSetup();
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
    console.log("WebSocket został zamknięty. Kod:", event.code, "Powód:", event.reason, "Było czyste:", event.wasClean);
    if (isReloading) return;
    if (!event.wasClean && event.code !== 1006) alert(`Połączenie z grą zostało przerwane (Kod: ${event.code})`);
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
  // pobierz kod z serwera
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

document.getElementById('endTurn').addEventListener('click', () => {
  ws.send(buildEndTurn());
});

document.querySelectorAll('.die').forEach((die, index) => {
  die.addEventListener('click', () => {
    if (!isMyTurn) return;
    ws.send(buildToggle(index));
  });
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

export function buildScoreBoard(state, scorePreview) {

  // pobranie elementów DOM

  const table  = document.getElementById('scoreBoard');
  const theadR = table.querySelector('thead tr');
  const tbody   = table.querySelector('tbody');

  const upperSectionCategories = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

  // 1) nagłówek: "Kategoria" + imiona
  theadR.innerHTML = '<th>Kategoria</th>';
  state.players.forEach(p => {
    const th = document.createElement('th');
    th.textContent = p.name + (p.id === playerId ? ' (Ty)' : '');
    theadR.appendChild(th);
  });

  const currentPlayerId = state.players[state.currentTurn].id;
  // flaga: czy to jestem ja
  isMyTurn = (currentPlayerId === playerId);

  // 2) ciało tabeli – po jednej linii na kategorię
  tbody.innerHTML = '';
  categories.forEach(cat => {
    const tr = document.createElement('tr');
    tr.dataset.category = cat;

    // pierwsza kolumna: nazwa kategorii
    const tdLabel = document.createElement('td');
    tdLabel.textContent = categoryLabels[cat];
    tr.appendChild(tdLabel);

    // kolumny z punktami dla każdego gracza
    state.players.forEach(p => {
      const cell = document.createElement('td');
      const cat  = tr.dataset.category;
      const val  = state.scorecard[p.id][cat];
    
      // —————————————————————————————
      //  SPECIAL: BONUS
      // —————————————————————————————
      if (cat === 'bonus') {
        // najpierw policz sumę górnej sekcji
        const upperScore = upperSectionCategories
.reduce((sum, c) => sum + (state.scorecard[p.id][c] || 0), 0);
    
        // jeśli >=63, bonus = 35; inaczej 0 i pokaż progres
        if (upperScore >= 63) {
          cell.textContent = '35';
        } else {
          cell.textContent = `0 (${upperScore}/63)`;
        }
    
        tr.appendChild(cell);
        return;  // kończymy tutaj dla bonusu
      }
    
      // —————————————————————————————
      //  SPECIAL: TOTAL (jeśli chcesz inaczej, możesz tu wstawić swój kod)
      // —————————————————————————————
      if (cat === 'total') {
        // 1) policz sumę wszystkich wypełnionych kategorii
        const actualScore = Object
          .values(state.scorecard[p.id])
          .filter(v => typeof v === 'number')
          .reduce((sum, v) => sum + v, 0);
      
        // 2) policz bonus (górna sekcja)
        const upperSum = upperSectionCategories
          .reduce((sum, c) => sum + (state.scorecard[p.id][c] || 0), 0);
        const bonus = upperSum >= 63 ? 35 : 0;
      
        // 3) finalna suma = actualScore + bonus
        const total = actualScore + bonus;
      
        cell.textContent = total;
        tr.appendChild(cell);
        return;
      }
    
      // —————————————————————————————
      //  RESZTA KATEGORII (preview + przycisk lub wartość przeciwnika)
      // —————————————————————————————
  // JEŚLI TO MÓJ GRACZ:
  if (p.id === playerId) {
    if (!isMyTurn) {
      // nie moja tura – zero interakcji
      cell.textContent = val != null ? val : '–';
    } else {
      // moja tura – pokaz preview + button
      if (val != null) {
        cell.textContent = val;
      } else {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-container';
        // badge
        const badge = document.createElement('span');
        badge.className = 'preview-badge';
        badge.textContent = `+${scorePreview[cat]}`;
        // przycisk
        const btn = document.createElement('button');
        btn.className = 'acceptBtn';
        btn.dataset.category = cat;
        btn.disabled = false;
        btn.innerHTML = '<svg>…</svg>';
        wrapper.append(badge, btn);
        cell.appendChild(wrapper);
      }
    }
  }
  // INACZEJ – przeciwnik
  else {
    cell.textContent = val != null ? val : '–';
  }

  tr.appendChild(cell);
    });
    
    tbody.appendChild(tr);
  });
}