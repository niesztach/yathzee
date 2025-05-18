// protocol.js – binarny protokół komunikacji WebSocket

// Typy wiadomości (1 bajt na typ)
export const TYPES = {
  START: 0x01,
  ROLL: 0x02,
  TOGGLE: 0x03,
  END_TURN: 0x04,
  SELECT: 0x05,

  JOINED: 0x10,
  LOBBY_UPDATE: 0x11,
  HOST_CHANGED: 0x12,
  GAME_START: 0x13,
  UPDATE: 0x14,
  GAME_OVER: 0x15,
  RECONNECT: 0x16,

  ERROR: 0xFF
};

// ===== WYCHODZĄCE (Client -> Server) =====

export function buildStart() {
  return Uint8Array.of(TYPES.START).buffer;
}

export function buildRoll() {
  return Uint8Array.of(TYPES.ROLL).buffer;
}

export function buildToggle(index) {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, TYPES.TOGGLE);
  view.setUint8(1, index);
  return buf;
}

export function buildEndTurn() {
  return Uint8Array.of(TYPES.END_TURN).buffer;
}

export function buildSelect(categoryCode) {
  const buf = new ArrayBuffer(2);
  const view = new DataView(buf);
  view.setUint8(0, TYPES.SELECT);
  view.setUint8(1, categoryCode); // zakodowany numer kategorii
  return buf;
}

// ===== DEKODOWANIE (Server lub Client) =====

// export function parseMessage(buffer) {
    
//     if (!(buffer instanceof ArrayBuffer)) {
//         console.error('Oczekiwano ArrayBuffer, a otrzymano:', buffer);
//         return { type: TYPES.ERROR, message: 'Nieprawidłowy format' };
//     }

//   const view = new DataView(buffer);
//   const type = view.getUint8(0);
//   switch (type) {
//     case TYPES.START:
//     case TYPES.ROLL:
//     case TYPES.END_TURN:
//       return { type };
//     case TYPES.TOGGLE:
//       return { type, index: view.getUint8(1) };
//     case TYPES.SELECT:
//       return { type, categoryCode: view.getUint8(1) };
//     default:
//       return { type: TYPES.ERROR, message: 'Unknown message type' };
//   }
// }

export function parseMessage(buffer) {
  if (!(buffer instanceof ArrayBuffer)) {
    return { type: TYPES.ERROR, message: 'Expected ArrayBuffer' };
  }
  const view = new DataView(buffer);
  const type = view.getUint8(0);
  // payload to pozostałe bajty od 1 do końca
  const payloadBytes = new Uint8Array(buffer, 1);
  // pomocnik do dekodowania JSON-u
  const text = new TextDecoder().decode(payloadBytes);
  let data = null;
  try { data = JSON.parse(text); } catch { /* nie zawsze JSON */ }

  switch (type) {
    // klient → serwer
    case TYPES.START:
    case TYPES.ROLL:
    case TYPES.END_TURN:
      return { type };
    case TYPES.TOGGLE:
      return { type, index: view.getUint8(1) };
    case TYPES.SELECT:
      return { type, categoryCode: view.getUint8(1) };
    // odpowiedzi serwera
    case TYPES.JOINED:
    case TYPES.LOBBY_UPDATE:
    case TYPES.HOST_CHANGED:
    case TYPES.GAME_START:
    case TYPES.UPDATE:
    case TYPES.GAME_OVER:
    case TYPES.RECONNECT:
      // data to obiekt z polami zależnymi od typu
      return { type, ...data };
    case TYPES.ERROR:
      return { type, message: (data && data.message) || 'Error' };
    default:
      return { type: TYPES.ERROR, message: 'Unknown message type' };
  }
}

// ===== KATEGORIE KODOWANE NUMERYCZNIE =====
export const categoryCodes = {
  ones: 0,
  twos: 1,
  threes: 2,
  fours: 3,
  fives: 4,
  sixes: 5,
  threeOfAKind: 6,
  fourOfAKind: 7,
  fullHouse: 8,
  smallStraight: 9,
  largeStraight: 10,
  yahtzee: 11,
  chance: 12
};
