// // protocol-server.js – binarny protokół komunikacji WebSocket po stronie Node.js

// const { Buffer } = require('buffer');

// const TYPES = {
//   // klient → serwer
//   START:        0x01,
//   ROLL:         0x02,
//   TOGGLE:       0x03,
//   END_TURN:     0x04,
//   SELECT:       0x05,
//   // serwer → klient
//   JOINED:       0x10,
//   LOBBY_UPDATE: 0x11,
//   HOST_CHANGED: 0x12,
//   GAME_START:   0x13,
//   UPDATE:       0x14,
//   GAME_OVER:    0x15,
//   RECONNECT:    0x16,
//   ERROR:        0xFF
// };

// // ===== DEKODOWANIE (Client → Server) =====
// function parseMessage(buffer) {
//   if (!Buffer.isBuffer(buffer)) {
//     return { type: TYPES.ERROR, message: 'Expected Buffer' };
//   }
//   const type = buffer.readUInt8(0);
//   switch (type) {
//     case TYPES.START:
//     case TYPES.ROLL:
//     case TYPES.END_TURN:
//       return { type };
//     case TYPES.TOGGLE:
//       return { type, index: buffer.readUInt8(1) };
//     case TYPES.SELECT:
//       return { type, categoryCode: buffer.readUInt8(1) };
//     default:
//       return { type: TYPES.ERROR, message: 'Unknown message type' };
//   }
// }

// // ===== BUDOWANIE WIADOMOŚCI (Server → Client) =====

// // pomocnik: serializujemy obiekt JS do JSON i bufora
// function jsonBuffer(obj) {
//   const json = JSON.stringify(obj);
//   return Buffer.from(json);
// }

// function buildError(message) {
//   return jsonBuffer({ type: 'error', message });
// }

// function buildJoined(playerId, players, hostId, hostName) {
//   return jsonBuffer({ type: 'joined', playerId, players, hostId, hostName });
// }

// function buildLobbyUpdate(players, hostId, hostName) {
//   return jsonBuffer({ type: 'lobbyUpdate', players, hostId, hostName });
// }

// function buildHostChanged(hostId, hostName, players) {
//   return jsonBuffer({ type: 'hostChanged', hostId, hostName, players });
// }

// function buildGameStart(state) {
//   return jsonBuffer({ type: 'gameStart', state });
// }

// function buildUpdate(state, scorePreview) {
//   return jsonBuffer({ type: 'update', state, scorePreview });
// }

// function buildGameOver(scorecard) {
//   return jsonBuffer({ type: 'gameOver', scorecard });
// }

// function buildReconnect(state, scorePreview) {
//   return jsonBuffer({ type: 'reconnect', state, scorePreview });
// }

// module.exports = {
//   TYPES,
//   parseMessage,
//   buildError,
//   buildJoined,
//   buildLobbyUpdate,
//   buildHostChanged,
//   buildGameStart,
//   buildUpdate,
//   buildGameOver,
//   buildReconnect
// };

// protocol-server.js
const { Buffer } = require('buffer');

const TYPES = {
  // klient → serwer
  START:        0x01,
  ROLL:         0x02,
  TOGGLE:       0x03,
  END_TURN:     0x04,
  SELECT:       0x05,
  // serwer → klient
  JOINED:       0x10,
  LOBBY_UPDATE: 0x11,
  HOST_CHANGED: 0x12,
  GAME_START:   0x13,
  UPDATE:       0x14,
  GAME_OVER:    0x15,
  RECONNECT:    0x16,
  ERROR:        0xFF
};

function parseMessage(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return { type: TYPES.ERROR, message: 'Expected Buffer' };
  }
  const type = buffer.readUInt8(0);
  switch (type) {
    // klient → serwer
    case TYPES.START:
    case TYPES.ROLL:
    case TYPES.END_TURN:
      return { type };
    case TYPES.TOGGLE:
      return { type, index: buffer.readUInt8(1) };
    case TYPES.SELECT:
      return { type, categoryCode: buffer.readUInt8(1) };
    // pozostałe są po stronie serwera, ale rzadko przychodzą tu
    default:
      return { type: TYPES.ERROR, message: 'Unknown message type' };
  }
}

// helper: prefixujemy type + JSON(payload)
function buildBuffer(type, objPayload) {
  const json = JSON.stringify(objPayload);
  const payload = Buffer.from(json);
  const buf = Buffer.alloc(1 + payload.length);
  buf.writeUInt8(type, 0);
  payload.copy(buf, 1);
  return buf;
}

function buildError(message) {
  return buildBuffer(TYPES.ERROR, { message });
}

function buildJoined(playerId, players, hostId, hostName) {
  return buildBuffer(TYPES.JOINED, { playerId, players, hostId, hostName });
}

function buildLobbyUpdate(players, hostId, hostName) {
  return buildBuffer(TYPES.LOBBY_UPDATE, { players, hostId, hostName });
}

function buildHostChanged(hostId, hostName, players) {
  return buildBuffer(TYPES.HOST_CHANGED, { hostId, hostName, players });
}

function buildGameStart(state) {
  return buildBuffer(TYPES.GAME_START, { state });
}

function buildUpdate(state, scorePreview) {
  return buildBuffer(TYPES.UPDATE, { state, scorePreview });
}

function buildGameOver(scorecard) {
  return buildBuffer(TYPES.GAME_OVER, { scorecard });
}

function buildReconnect(state, scorePreview) {
  return buildBuffer(TYPES.RECONNECT, { state, scorePreview });
}

module.exports = {
  TYPES,
  parseMessage,
  buildError,
  buildJoined,
  buildLobbyUpdate,
  buildHostChanged,
  buildGameStart,
  buildUpdate,
  buildGameOver,
  buildReconnect
};
