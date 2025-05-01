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

  if (storedRoomCode && storedPlayerName) {
    roomCode    = storedRoomCode;
    playerName  = storedPlayerName;
    playerId    = storedPlayerId;
    isHost      = storedIsHost;
  
    // jeśli byliśmy już w grze
    if (storedPhase === 'playing') {
      joinRoom(roomCode, playerName);
      // widok gry początkowo ukryty, pokażemy go po reconnectcie
    } else {
      // jak dotąd: reconnect do lobby
      joinRoom(roomCode, playerName);
    }
    console.log('Przywrócono dane z sessionStorage:', { roomCode, playerName, playerId, isHost });
  }
});

// ====== FUNKCJA POKAZUJĄCA LOBBY ======
function showSetup() {
  setupDiv.style.display = '';
  lobbyDiv.style.display = 'none';
  gameCanvas.style.display = 'none';
}

// ====== RYSOWANIE KOSTEK ======
function drawDice(dice) {
  ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  dice.forEach((val, i) => {
    const x = 20 + i * 90;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, 20, 60, 60);
    ctx.strokeRect(x, 20, 60, 60);
    ctx.fillStyle = '#000';
    ctx.font = '30px sans-serif';
    ctx.fillText(val || '-', x + 20, 60);
  });
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

  ws.onopen = () => console.log('Połączono z pokojem', code);

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
        // ukryj lobby, pokaż canvas i narysuj początek gry
        sessionStorage.setItem('phase', 'playing');
        lobbyDiv.style.display = 'none';
        setupDiv.style.display = 'none';
        gameCanvas.style.display = '';
        drawDice(msg.state.dice);
        break;
      case 'reconnect':
        // serwer przesyła pełny stan gry
        lobbyDiv.style.display   = 'none';
        setupDiv.style.display   = 'none';
        gameCanvas.style.display = '';
        // np. rysujesz kostki i inne elementy stanu:
        drawDice(msg.state.dice);
        // a jeśli masz więcej stanów (tury, locki, itp.) – zaktualizuj je tu
        break;
    }
  };

  ws.onclose = () => {
    if (isReloading) {
      // odświeżenie strony — nic nie robimy, sessionStorage zostaje
      return;
    }
  
    if (!isReloading && !userInitiatedClose) {
      //alert('Gra już się rozpoczęła, taki pokój nie istnieje bądź został usunięty – dołączanie jest zablokowane.');
      showSetup();
      errDiv.style.display = '';
    }

    // ### dlaczego to się odpala? ###
    if (userInitiatedClose) {
      // kliknięcie “Anuluj” → wyjście z lobby
      sessionStorage.clear();
      showSetup();
    } else {
      // awaria połączenia → komunikat i powrót do setup
      // alert('Nie udało się połączyć z serwerem/pokojem.');
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
  ws.send(JSON.stringify({ type: 'start' }));
});

cancelBtn.addEventListener('click', () => {
  userInitiatedClose = true; // flaga do rozróżnienia zamknięcia połączenia przez użytkownika
  sessionStorage.setItem('phase', 'lobby');
  ws.close();
});

