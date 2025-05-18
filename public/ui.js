// ====== FUNKCJA POKAZUJĄCA LOBBY ======
export function showSetup() {

    // pobranie elementów DOM
    const setupDiv   = document.getElementById('setup');
    const lobbyDiv   = document.getElementById('lobby');
    const gameCanvas = document.getElementById('gameCanvas');
    const gameInfo   = document.getElementById('gameInfo');

    setupDiv.style.display    = '';
    lobbyDiv.style.display    = 'none';
    gameCanvas.style.display  = 'none';
    gameInfo.style.display    = 'none';
    document.getElementById('scoreTable').style.display = 'none';
    // jeśli jest ekran gameOver, usuń go
    const over = document.getElementById('gameOver');
    if (over) over.remove();
  }
  
  
  // ====== RYSOWANIE KOSTEK ======
  export function drawDice(dice, locked = [false, false, false, false, false]) {

    //pobranie elementów DOM
    const gameCanvas = document.getElementById('gameCanvas');
    const ctx        = gameCanvas.getContext('2d');

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
  
  // ====== FUNKCJA RYSUJĄCA TABELĘ WYNIKOW ======
  
 
  
  


  
export function showGameOver(state, finalScorecard) {

  const setupDiv   = document.getElementById('setup');
  const lobbyDiv   = document.getElementById('lobby');
  const gameCanvas = document.getElementById('gameCanvas');
  const gameInfo   = document.getElementById('gameInfo');
  const scoreTable = document.getElementById('scoreTable');

    // 1. przygotuj listę wyników
    const upperCats = ['ones','twos','threes','fours','fives','sixes'];
const playersData = state.players.map(p => {
  const scores = finalScorecard[p.id];
  // suma górnej sekcji
  const upperSum = upperCats
    .reduce((s, c) => s + (scores[c] || 0), 0);
  const bonus = upperSum >= 63 ? 35 : 0;
  // suma wszystkich kategorii
  const actual = Object.values(scores)
    .reduce((s, v) => s + (v || 0), 0);
  const total = actual + bonus;
  return { name: p.name, upperSum, bonus, total };
});

    // 2. Sortuj po total malejąco
    playersData.sort((a, b) => b.total - a.total);
    // 3. Wyłon zwycięzcę (lub remis)
    const best = playersData[0].total;
    const winners = playersData
      .filter(x => x.total === best)
      .map(x => x.name)
      .join(', ');
  
    // 4. Zbuduj kontener
    const container = document.createElement('div');
    container.id = 'gameOver';
    container.innerHTML = `
      <h2>Wyniki Końcowe</h2>
      <p>Zwycięzca: <strong>${winners}</strong> — ${best} pkt</p>
      <table id="finalResults">
        <thead>
          <tr>
            <th>Gracz</th><th>Górna</th><th>Bonus</th><th>Razem</th>
          </tr>
        </thead>
        <tbody>
          ${playersData.map(p => `
            <tr>
              <td>${p.name}</td>
              <td>${p.upperSum}</td>
              <td>${p.bonus}</td>
              <td>${p.total}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <button id="newGameBtn">Nowa gra</button>
    `;
    // 5. Wyczyść UI gry i wstaw wyniki
    setupDiv.style.display = 'none';
    lobbyDiv.style.display = 'none';
    gameCanvas.style.display = 'none';
    gameInfo.style.display = 'none';
    scoreTable.style.display = 'none';
    document.getElementById('scoreTable').style.display = 'none';
  
    document.body.appendChild(container);
    container.querySelector('#newGameBtn').addEventListener('click', () => {
  // pokaż ekran tworzenia/łączenia nowego lobby
  showSetup();
});
  }
  