// game/state.js
function createInitialGameState() {
    return {
      phase:      'lobby',
      players:    [],        // {id,name}
      turnOrder:  [],
      currentTurn: 0,
      dice:       [0,0,0,0,0],
      locked:     [false, false, false, false, false],
      rollsLeft:  3,
      scorecard:  {},
    };
  }
  
  module.exports = { createInitialGameState };
  