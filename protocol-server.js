// protocol-server.js
const { Buffer } = require('buffer');

const { TYPES, CATS, parseMessage} = require('../kosci/public/protocol.js');


// pomocnik do zapisania jednego stringa w buf: [len:UInt8][UTF-8 bytes]
function writeString(buf, offset, str) {
  const b = Buffer.from(str, 'utf8');
  buf.writeUInt8(b.length, offset);
  b.copy(buf, offset + 1);
  return 1 + b.length;
}

/**
  ERROR: [ type:1 ][ msgLen:1 ][ msgBytes ]
 */
function buildError(message) {
  const msgBuf = Buffer.from(message, 'utf8');
  const buf = Buffer.alloc(1 + 1 + msgBuf.length);
  let off = 0;
  buf.writeUInt8(TYPES.ERROR, off++);
  buf.writeUInt8(msgBuf.length, off++);
  msgBuf.copy(buf, off);
  return buf;
}

/**
 * JOINED: [ type:1 ][ youId:1 ][ count:1 ]
 *         [ for each player: len:1 + nameBytes ]
 *         [ hostIndex:1 ]
 */

function buildJoined(youId, players, hostIndex) {
  // każdy player ma .id i .name
  // 1b type, 1b youIdLen + youId, 1b count,
  // [ for each player: idLen + id + nameLen + name ], 1b hostIndex
  const youBuf = Buffer.from(youId,'utf8');
  const nameBufs = players.map(p=>Buffer.from(p.name,'utf8'));
  const idBufs   = players.map(p=>Buffer.from(p.id,'utf8'));
  const namesTotal = players.reduce((s,_,i)=>s + 1 + idBufs[i].length + 1 + nameBufs[i].length, 0);
  const buf = Buffer.alloc(1 + 1 + youBuf.length + 1 + namesTotal + 1);

  let off = 0;
  buf.writeUInt8(TYPES.JOINED, off++);
  // youId
  buf.writeUInt8(youBuf.length, off);
  youBuf.copy(buf, off+1);
  off += 1 + youBuf.length;
  // count
  buf.writeUInt8(players.length, off++);
  // for each player: id + name
  for (let i=0; i<players.length; i++) {
    off += writeString(buf, off, players[i].id);
    off += writeString(buf, off, players[i].name);
  }
  // hostIndex
  buf.writeUInt8(hostIndex, off);
  return buf;
}


/**
 * LOBBY_UPDATE: [ type:1 ][ count:1 ]
 *               [ for each player: len:1 + nameBytes ]
 *               [ hostIndex:1 ]
 */

function buildLobbyUpdate(players, hostIndex) {
  const idBufs   = players.map(p=>Buffer.from(p.id,'utf8'));
  const nameBufs = players.map(p=>Buffer.from(p.name,'utf8'));
  const total    = players.reduce((s,_,i)=>s + 1 + idBufs[i].length + 1 + nameBufs[i].length, 0);
  const buf      = Buffer.alloc(1 + 1 + total + 1);

  let off = 0;
  buf.writeUInt8(TYPES.LOBBY_UPDATE, off++);
  buf.writeUInt8(players.length, off++);
  for (let i=0; i<players.length; i++) {
    off += writeString(buf, off, players[i].id);
    off += writeString(buf, off, players[i].name);
  }
  buf.writeUInt8(hostIndex, off);
  return buf;
}


/**
 * HOST_CHANGED: [ type:1 ][ newHostIndex:1 ]
 */
function buildHostChanged(hostIndex) {
  const buf = Buffer.alloc(1 + 1);
  buf.writeUInt8(TYPES.HOST_CHANGED, 0);
  buf.writeUInt8(hostIndex, 1);
  return buf;
}

/**
 * GAME_START: [ type:1 ][ jsonLen:2 ][ jsonBytes ]
 */
function buildGameStart(state) {
  const json    = JSON.stringify(state);
  const payload = Buffer.from(json, 'utf8');
  const buf     = Buffer.alloc(1 + 2 + payload.length);
  let off = 0;
  
  buf.writeUInt8(TYPES.GAME_START, off++);
  buf.writeUInt16BE(payload.length, off); off += 2;
  payload.copy(buf, off);
  return buf;
}

/**
 * UPDATE: [ type:1 ][ jsonLen:2 ][ jsonBytes ]
 */
function buildUpdate(state, scorePreview) {
  const json    = JSON.stringify({ state, scorePreview });
  const payload = Buffer.from(json, 'utf8');
  const buf     = Buffer.alloc(1 + 2 + payload.length);
  let off = 0;
  
  buf.writeUInt8(TYPES.UPDATE, off++);
  buf.writeUInt16BE(payload.length, off); off += 2;
  payload.copy(buf, off);
  return buf;
}

/**
 * GAME_OVER: [ type:1 ][ jsonLen:2 ][ jsonBytes ]
 */
function buildGameOver(scorecard) {
  const json    = JSON.stringify(scorecard);
  const payload = Buffer.from(json, 'utf8');
  const buf     = Buffer.alloc(1 + 2 + payload.length);
  let off = 0;
  
  buf.writeUInt8(TYPES.GAME_OVER, off++);
  buf.writeUInt16BE(payload.length, off); off += 2;
  payload.copy(buf, off);
  return buf;
}

/**
 * RECONNECT: [ type:1 ][ jsonLen:2 ][ jsonBytes ]
 */
function buildReconnect(state, scorePreview) {
  const slim    = {
    ...state,
    scorecard: pruneScorecard(state.scorecard) //  ← NOWE
  };
  const json    = JSON.stringify({ state: slim, scorePreview });
  const payload = Buffer.from(json, 'utf8');
  const buf     = Buffer.alloc(1 + 2 + payload.length);
  let off = 0;
  
  buf.writeUInt8(TYPES.RECONNECT, off++);
  buf.writeUInt16BE(payload.length, off); off += 2;
  payload.copy(buf, off);
  return buf;
}


let seq = 0;                    // globalny licznik delty

function arrayEq(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
         a.length === b.length &&
         a.every((v, i) => v === b[i]);
}

function buildDelta(prev, curr, previewForCurrent) {
  const d = { seq: ++seq };

  if (!arrayEq(prev.dice, curr.dice))        d.dice       = curr.dice;
  if (!arrayEq(prev.locked, curr.locked))    d.locked     = curr.locked;
  if (prev.rollsLeft !== curr.rollsLeft)     d.rollsLeft  = curr.rollsLeft;
  if (prev.currentTurn !== curr.currentTurn) d.turn       = curr.currentTurn;

  if (curr.lastCommit) {                     // commit to pojedyncza kategoria
    const { playerId, cat, value } = curr.lastCommit;
    d.commit = { player: playerId, cat: CATS.indexOf(cat), val: value };
  }

if (previewForCurrent)
  d.preview = CATS.map(c => previewForCurrent[c] ?? 0); // 13 pól


  // ↙ identyczne opakowanie jak w buildUpdate
  const payload = Buffer.from(JSON.stringify(d), 'utf8');
  const buf     = Buffer.alloc(1 + 2 + payload.length);
  let off = 0;
  buf.writeUInt8(TYPES.DELTA,    off++);
  buf.writeUInt16BE(payload.length, off); off += 2;
  payload.copy(buf, off);
  return buf;
}

function pruneScorecard(original) {
  const pruned = {};
  for (const [pid, card] of Object.entries(original)) {
    const compact = {};
    for (const [cat, val] of Object.entries(card)) {
      if (val != null) compact[cat] = val;     // zachowaj tylko wypełnione
    }
    pruned[pid] = compact;                     // może być pusty {}
  }
  return pruned;
}


module.exports = {
  buildError,
  buildJoined,
  buildLobbyUpdate,
  buildHostChanged,
  buildGameStart,
  buildUpdate,
  buildGameOver,
  buildReconnect,
  parseMessage,
  buildDelta,
  TYPES
};
