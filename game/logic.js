// game/logic.js
const { createInitialGameState } = require('./state');

function startGame(state) {
  state.phase      = 'playing';
  state.turnOrder  = state.players.map(p => p.id);
  state.currentTurn = 0;
  state.rollsLeft  = 3;
  state.locked     = [false, false, false, false, false];
  state.dice       = [0,0,0,0,0];
  // inicjalizacja scorecard…
  state.turnOrder.forEach(id => {
    state.scorecard[id] = { /* wszystkie kategorie null + total:0 */ };
  });
}

function rollDice(state) {
  if (state.rollsLeft <= 0) throw new Error('No rolls left');
  state.dice = state.dice.map((v,i) =>
    state.locked[i] ? v : Math.floor(Math.random()*6)+1
  );
  state.rollsLeft--;
}

function toggleLock(state, idx) {
  if (state.rollsLeft === 3 || state.rollsLeft === 0) return;
  state.locked[idx] = !state.locked[idx];
}

function score(state, playerId, category) {
  if (state.scorecard[playerId][category] !== null) throw new Error('Already scored');
  const pts = calculateScore(category, state.dice);
  state.scorecard[playerId][category] = pts;
  state.scorecard[playerId].total += pts;
  // przygotuj kolejną turę…
}

function isGameOver(state) {
  return state.turnOrder.every(id =>
    Object.values(state.scorecard[id]).every(v => v !== null)
  );
}

// ... dodatkowe helpery: calculateScore(), itd. ...

module.exports = { startGame, rollDice, toggleLock, score, isGameOver };
