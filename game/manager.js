// game/manager.js
const { createInitialGameState } = require('./state');
const logic = require('./logic');

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom(code) {
    this.rooms.set(code, {
      clients: new Set(),
      state:   createInitialGameState(),
      hostId:  null,
      hostName: null
    });
  }

  join(ws, roomCode, playerId, playerName) {
    const room = this.rooms.get(roomCode);
    // walidacje fazy, reconnect vs nowy join…
    // usuń konieczność powielania w server.js
  }

  handleMessage(ws, msg) {
    const room = this.rooms.get(ws.roomName);
    const state = room.state;
    const me = ws.playerId;
    const current = state.turnOrder[state.currentTurn];

    if (msg.type === 'start' && me === room.hostId) {
      logic.startGame(state);
      this.broadcast(roomCode, { type:'gameStart', state });
    }
    if (state.phase === 'playing' && me === current) {
      switch (msg.type) {
        case 'rollDice':
          logic.rollDice(state);
          this.broadcast(roomCode, { type:'update', state });
          break;
        // … inne akcje …
      }
    }
  }

  broadcast(roomCode, msg) {
    const room = this.rooms.get(roomCode);
    room.clients.forEach(ws => ws.send(JSON.stringify(msg)));
  }
}

module.exports = RoomManager;
