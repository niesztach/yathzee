// ====== ZMIENNE GLOBALNE ======
let ws;
let playerId = null;
let roomCode = null;
let playerName = null;
let isHost = false;
let userInitiatedClose = false; //flaga do rozróżnienia zamknięcia połączenia przez użytkownika
let players = [];
let isReloading = false; // flaga do rozróżnienia zamknięcia połączenia przez użytkownika

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

// ====== FUNKCJA POKAZUJĄCA LOBBY ======
function showSetup() {
  setupDiv.style.display = '';
  lobbyDiv.style.display = 'none';
  gameCanvas.style.display = 'none';
}

// ====== RYSOWANIE KOSTEK ======
function drawDice(dice, locked = [false, false, false, false, false]) {
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  dice.forEach((val, i) => {
    const x = 20 + i * 90;
    ctx.fillStyle = locked[i] ? '#ccc' : '#fff'; // Szare tło dla zablokowanych kostek
    ctx.fillRect(x, 20, 60, 60);
    ctx.strokeRect(x, 20, 60, 60);
    ctx.fillStyle = '#000';
    ctx.font = '30px sans-serif';
    ctx.fillText(val || '-', x + 20, 60);
  });
}

// ====== RENDEROWANIE GRY ======
function renderGame(state, scorePreview) {
  // 1) rysuj kostki
  drawDice(state.dice, state.locked);
  // 2) wyświetl bieżącą turę i rzuty
  document.getElementById('roundDisplay').textContent = `Tura: ${state.players[state.currentTurn].name}`;
  document.getElementById('rollsLeft').textContent = `Rzuty: ${state.rollsLeft}`;
  // 3) wypełnij tabelę i steruj przyciskami
  Object.entries(state.scorecard[playerId]).forEach(([cat, sc]) => {
    const cell   = document.getElementById(cat);
    const button = document.querySelector(`button[data-category="${cat}"]`);
    if (sc !== null) {
      cell.textContent = sc;
      button.disabled = true;
    } else {
      cell.textContent = `(${scorePreview[cat]})`;
      button.disabled = false;
    }
  });
  // 4) pokaż planszę i infopanel
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

// Zapisanie danych w sessionStorage
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
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'joined':
        playerId = msg.playerId;
        players  = msg.players;
        // Zapisanie playerId w sessionStorage
        sessionStorage.setItem('playerId', playerId);

       isHost = (msg.hostId === playerId);
       lobbyHostSp.textContent = msg.hostName;

       // Ustaw nazwę gracza w widoku gry
       document.getElementById('playerNameDisplay').textContent = playerName;

       updateLobbyUI();
        break;
      case 'playerJoined':
      case 'lobbyUpdate':
        players = msg.players;
        // aktualizacja hosta w razie zmiany
        isHost = (msg.hostId === playerId);
        lobbyHostSp.textContent = msg.hostName;
        updateLobbyUI();
        break;
      case 'hostChanged':
        // zmiana hosta w lobby
        isHost = (msg.hostId === playerId);
        lobbyHostSp.textContent = msg.hostName;
        updateLobbyUI();
        break;
      case 'gameStart':
        sessionStorage.setItem('phase', 'playing');
        setupDiv.style.display = 'none'; // Ukryj setup
        lobbyDiv.style.display = 'none';
        gameCanvas.style.display = '';
        gameInfo.style.display = '';
        document.getElementById('scoreTable').style.display = ''; // Pokaż tabelę wyników
        drawDice(msg.state.dice);
        break;
      
      case 'reconnect':
        console.log('Handler reconnect: Próbuję renderować grę...'); // Nowy log
        document.getElementById('playerNameDisplay').textContent = playerName;
        console.log('Handler reconnect: Renderowanie zakończono. WS State:',ws.readyState); // Nowy log
        renderGame(msg.state,  msg.scorePreview);
        break;
     
      case 'update':
        renderGame(msg.state, msg.scorePreview);
        // Zapisz stan gry w sessionStorage
        // sessionStorage.setItem('gameState', JSON.stringify({
        //   dice: msg.state.dice,
        //   locked: msg.state.locked,
        //   currentTurn: msg.state.currentTurn,
        //   rollsLeft: msg.state.rollsLeft,
        //   scorecard: msg.state.scorecard,
        //   players: msg.state.players,
        // }));
        break;

      case 'gameOver':
        sessionStorage.setItem('phase', 'finished');
        alert('Gra zakończona! Wyniki:');
        console.log(msg.scorecard);
        break;

      case 'error':
        alert(msg.message);
        break;
    }
  };

ws.onerror = (error) => {
  console.error("WebSocket napotkał błąd:", error); // Zobaczymy szczegóły błędu
};

ws.onclose = (event) => {
  // Sprawdź kody zamknięcia: https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
  console.log("WebSocket został zamknięty. Kod:", event.code, "Powód:", event.reason, "Było czyste:", event.wasClean);

  if (isReloading) {
     console.log("WebSocket zamknięty z powodu odświeżenia.");
     return;
  }

  // Poniższa logika wymaga dopracowania w zależności od Twoich potrzeb
  // i od tego, co znaczy userInitiatedClose w Twoim kodzie
  if (!event.wasClean && event.code !== 1006) { // 1006 to błąd połączenia (np. serwer padł)
     alert(`Połączenie z grą zostało przerwane (Kod: ${event.code}). Sprawdź konsolę po szczegóły.`);
  }


  if (!userInitiatedClose) {
     showSetup(); // Pokaż ekran setup
     errDiv.style.display = ''; // Pokaż div z błędem (jeśli taki masz)
     // Możesz ustawić tekst błędu np. "Utracono połączenie z grą."
  } else {
     // Jeśli zamknął celowo (np. przycisk wyjścia z lobby)
     sessionStorage.clear(); // Czyść storage tylko przy celowym wyjściu
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
  ws.send(JSON.stringify({ type: 'start' }));
});

cancelBtn.addEventListener('click', () => {
  userInitiatedClose = true; // flaga do rozróżnienia zamknięcia połączenia przez użytkownika
  sessionStorage.setItem('phase', 'lobby');
  ws.close();
});

document.getElementById('rollDice').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'rollDice' }));
});

document.getElementById('endTurn').addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'endTurn' }));
});

document.querySelectorAll('.die').forEach((die, index) => {
  die.addEventListener('click', () => {
    ws.send(JSON.stringify({ type: 'toggleLock', index })); // Wyślij komunikat do serwera
  });
});

gameCanvas.addEventListener('click', (event) => {
  const rect = gameCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  // Sprawdź, która kostka została kliknięta
  const index = Math.floor(x / 90); // Zakładamy, że każda kostka ma szerokość 90px
  if (index >= 0 && index < 5) {
    ws.send(JSON.stringify({ type: 'toggleLock', index })); // Wyślij komunikat do serwera
  }
});

document.getElementById('scoreRows').addEventListener('click', (event) => {
  const button = event.target.closest('button.acceptBtn');
  if (!button) return;

  const category = button.dataset.category;
  ws.send(JSON.stringify({ type: 'selectCategory', category }));
});

