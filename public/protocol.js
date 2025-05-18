// protocol.js – binarny protokół komunikacji WebSocket

export const TYPES = {
  START:          0x01,
  ROLL:           0x02,
  TOGGLE:         0x03,
  END_TURN:       0x04,
  SELECT:         0x05,

  JOINED:         0x10,
  LOBBY_UPDATE:   0x11,
  HOST_CHANGED:   0x12,
  GAME_START:     0x13,
  UPDATE:         0x14,
  GAME_OVER:      0x15,
  RECONNECT:      0x16,

  ERROR:          0xFF
};

export const categoryCodes = {
  ones:            0,
  twos:            1,
  threes:          2,
  fours:           3,
  fives:           4,
  sixes:           5,
  threeOfAKind:    6,
  fourOfAKind:     7,
  fullHouse:       8,
  smallStraight:   9,
  largeStraight:  10,
  yahtzee:        11,
  chance:         12
};

// ==== wychodzące (Client → Server) ====
export function buildStart()   { return Uint8Array.of(TYPES.START).buffer; }
export function buildRoll()    { return Uint8Array.of(TYPES.ROLL).buffer; }
export function buildEndTurn() { return Uint8Array.of(TYPES.END_TURN).buffer; }
export function buildToggle(i) {
  const buf = new ArrayBuffer(2), v = new DataView(buf);
  v.setUint8(0, TYPES.TOGGLE);
  v.setUint8(1, i);
  return buf;
}
export function buildSelect(code) {
  const buf = new ArrayBuffer(2), v = new DataView(buf);
  v.setUint8(0, TYPES.SELECT);
  v.setUint8(1, code);
  return buf;
}

const textDecoder = new TextDecoder();

// ==== parseMessage (Server → Client) ====
export function parseMessage(raw) {
  // accept ArrayBuffer or any TypedArray (incl. Node Buffer if ever used)
  let view;
  if (raw instanceof ArrayBuffer) {
    view = new DataView(raw);
  } else if (ArrayBuffer.isView(raw)) {
    view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  } else {
    return { type: TYPES.ERROR, message: 'Unexpected payload format' };
  }

  let off = 0;
  const type = view.getUint8(off++);

  switch (type) {
    // proste komendy
    case TYPES.START:
    case TYPES.ROLL:
    case TYPES.END_TURN:
      return { type };

    case TYPES.TOGGLE:
      return { type, index: view.getUint8(off++) };

    case TYPES.SELECT:
      return { type, categoryCode: view.getUint8(off++) };

    case TYPES.JOINED: {
  // [type] już odczytane, off=1
  // youId
  const youIdLen = view.getUint8(off++);
  const youId = textDecoder.decode(
    new Uint8Array(view.buffer, view.byteOffset+off, youIdLen)
  );
  off += youIdLen;

  // count
  const count = view.getUint8(off++);
  const players = [];
  for (let i=0; i<count; i++) {
    // id
    const idLen = view.getUint8(off++);
    const id = textDecoder.decode(
      new Uint8Array(view.buffer, view.byteOffset+off, idLen)
    );
    off += idLen;
    // name
    const nameLen = view.getUint8(off++);
    const name = textDecoder.decode(
      new Uint8Array(view.buffer, view.byteOffset+off, nameLen)
    );
    off += nameLen;
    players.push({ id, name });
  }
  // hostIndex
  const hostIndex = view.getUint8(off++);
  const hostId   = players[hostIndex]?.id;
  const hostName = players[hostIndex]?.name;
  return { type, playerId: youId, players, hostId, hostName };
}

case TYPES.LOBBY_UPDATE: {
  const count = view.getUint8(off++);
  const players = [];
  for (let i=0; i<count; i++) {
    const idLen = view.getUint8(off++);
    const id = textDecoder.decode(
      new Uint8Array(view.buffer, view.byteOffset+off, idLen)
    );
    off += idLen;
    const nameLen = view.getUint8(off++);
    const name = textDecoder.decode(
      new Uint8Array(view.buffer, view.byteOffset+off, nameLen)
    );
    off += nameLen;
    players.push({ id, name });
  }
  const hostIndex = view.getUint8(off++);
  const hostId   = players[hostIndex]?.id;
  const hostName = players[hostIndex]?.name;
  return { type, players, hostId, hostName };
}


    // HOST_CHANGED: [type][newHostIndex]
    case TYPES.HOST_CHANGED: {
      const newHostIndex = view.getUint8(off++);
      return { type, hostId: newHostIndex };
    }

    // GAME_START: [type][jsonLen:2][json()]
    case TYPES.GAME_START: {
      const len = view.getUint16(off); off += 2;
      const slice = new Uint8Array(view.buffer, view.byteOffset + off, len);
      const state = JSON.parse(textDecoder.decode(slice));
      return { type, state };
    }

    // UPDATE / RECONNECT: [type][jsonLen:2][ {state,scorePreview} ]
    case TYPES.UPDATE:
    case TYPES.RECONNECT: {
      const len = view.getUint16(off); off += 2;
      const slice = new Uint8Array(view.buffer, view.byteOffset + off, len);
      const { state, scorePreview } = JSON.parse(textDecoder.decode(slice));
      return { type, state, scorePreview };
    }

    // GAME_OVER: [type][jsonLen:2][ scorecard ]
    case TYPES.GAME_OVER: {
      const len = view.getUint16(off); off += 2;
      const slice = new Uint8Array(view.buffer, view.byteOffset + off, len);
      const scorecard = JSON.parse(textDecoder.decode(slice));
      return { type, scorecard };
    }

    // ERROR: [type][msgLen][msgBytes]
    case TYPES.ERROR: {
      const len = view.getUint8(off++);
      const slice = new Uint8Array(view.buffer, view.byteOffset + off, len);
      const message = textDecoder.decode(slice);
      return { type, message };
    }

    default:
      return { type: TYPES.ERROR, message: 'Unknown message type '+ type };
  }
}
