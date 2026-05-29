// chess-engine.js
// A complete chess rules engine using the 0x88 board representation.
// Pure logic (no DOM). Works both in Node (for testing) and in the browser.
//
// Implements: full legal move generation, castling, en passant, promotion,
// check / checkmate / stalemate detection, fifty-move rule, threefold
// repetition, and insufficient-material draws. Validated with perft.

export const WHITE = 'w';
export const BLACK = 'b';

export const PAWN = 'p', KNIGHT = 'n', BISHOP = 'b', ROOK = 'r', QUEEN = 'q', KING = 'k';

export const BITS = {
  NORMAL: 1,
  CAPTURE: 2,
  BIG_PAWN: 4,
  EP: 8,
  PROMOTION: 16,
  KSIDE: 32,
  QSIDE: 64,
};

// Castling-right bits.
const C = { WK: 1, WQ: 2, BK: 4, BQ: 8 };

const PIECE_OFFSETS = {
  n: [33, 31, -31, -33, 18, 14, -14, -18],
  b: [17, 15, -15, -17],
  r: [16, -16, 1, -1],
  q: [17, 15, -15, -17, 16, -16, 1, -1],
  k: [17, 15, -15, -17, 16, -16, 1, -1],
};

export function rank(sq) { return sq >> 4; }
export function file(sq) { return sq & 7; }
export function isOnBoard(sq) { return (sq & 0x88) === 0; }
export function squareName(sq) { return 'abcdefgh'[file(sq)] + (rank(sq) + 1); }
export function nameToSquare(name) {
  const f = 'abcdefgh'.indexOf(name[0]);
  const r = parseInt(name[1], 10) - 1;
  return r * 16 + f;
}
function swap(c) { return c === WHITE ? BLACK : WHITE; }

// Per-square mask applied to castling rights whenever a piece moves from or to
// that square (handles king/rook moving, and rook being captured at home).
const CASTLING_MASK = new Array(128).fill(15);
CASTLING_MASK[0]   = 15 & ~C.WQ;          // a1
CASTLING_MASK[4]   = 15 & ~(C.WK | C.WQ); // e1
CASTLING_MASK[7]   = 15 & ~C.WK;          // h1
CASTLING_MASK[112] = 15 & ~C.BQ;          // a8
CASTLING_MASK[116] = 15 & ~(C.BK | C.BQ); // e8
CASTLING_MASK[119] = 15 & ~C.BK;          // h8

export class Chess {
  constructor(fen) {
    this.board = new Array(128).fill(null);
    this.turn = WHITE;
    this.castling = 0;
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.kings = { w: -1, b: -1 };
    this.history = [];
    this.positionCounts = new Map();
    if (fen) this.loadFen(fen); else this.reset();
  }

  reset() {
    this.loadFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  loadFen(fen) {
    this.board = new Array(128).fill(null);
    this.kings = { w: -1, b: -1 };
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/'); // rows[0] is rank 8
    for (let r = 0; r < 8; r++) {
      const boardRank = 7 - r;
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) {
          f += parseInt(ch, 10);
        } else {
          const color = ch === ch.toUpperCase() ? WHITE : BLACK;
          const type = ch.toLowerCase();
          const sq = boardRank * 16 + f;
          this.board[sq] = { type, color };
          if (type === KING) this.kings[color] = sq;
          f++;
        }
      }
    }
    this.turn = parts[1] === 'b' ? BLACK : WHITE;
    this.castling = 0;
    if (parts[2] && parts[2] !== '-') {
      if (parts[2].includes('K')) this.castling |= C.WK;
      if (parts[2].includes('Q')) this.castling |= C.WQ;
      if (parts[2].includes('k')) this.castling |= C.BK;
      if (parts[2].includes('q')) this.castling |= C.BQ;
    }
    this.ep = (parts[3] && parts[3] !== '-') ? nameToSquare(parts[3]) : -1;
    this.half = parts[4] ? parseInt(parts[4], 10) : 0;
    this.full = parts[5] ? parseInt(parts[5], 10) : 1;
    this.history = [];
    this.positionCounts = new Map();
    this._recordPosition();
  }

  fen() {
    let s = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 16 + f];
        if (!p) { empty++; }
        else {
          if (empty) { s += empty; empty = 0; }
          s += p.color === WHITE ? p.type.toUpperCase() : p.type;
        }
      }
      if (empty) s += empty;
      if (r > 0) s += '/';
    }
    let cr = '';
    if (this.castling & C.WK) cr += 'K';
    if (this.castling & C.WQ) cr += 'Q';
    if (this.castling & C.BK) cr += 'k';
    if (this.castling & C.BQ) cr += 'q';
    return s + ' ' + this.turn + ' ' + (cr || '-') + ' ' +
      (this.ep >= 0 ? squareName(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
  }

  _posKey() {
    const f = this.fen().split(' ');
    return f[0] + ' ' + f[1] + ' ' + f[2] + ' ' + f[3];
  }
  _recordPosition() {
    const k = this._posKey();
    this.positionCounts.set(k, (this.positionCounts.get(k) || 0) + 1);
  }

  isAttacked(sq, byColor) {
    // Pawns.
    if (byColor === WHITE) {
      let s = sq - 17; if (isOnBoard(s)) { const p = this.board[s]; if (p && p.color === WHITE && p.type === PAWN) return true; }
      s = sq - 15; if (isOnBoard(s)) { const p = this.board[s]; if (p && p.color === WHITE && p.type === PAWN) return true; }
    } else {
      let s = sq + 17; if (isOnBoard(s)) { const p = this.board[s]; if (p && p.color === BLACK && p.type === PAWN) return true; }
      s = sq + 15; if (isOnBoard(s)) { const p = this.board[s]; if (p && p.color === BLACK && p.type === PAWN) return true; }
    }
    // Knights.
    for (const off of PIECE_OFFSETS.n) {
      const s = sq + off;
      if (isOnBoard(s)) { const p = this.board[s]; if (p && p.color === byColor && p.type === KNIGHT) return true; }
    }
    // King (adjacency).
    for (const off of PIECE_OFFSETS.k) {
      const s = sq + off;
      if (isOnBoard(s)) { const p = this.board[s]; if (p && p.color === byColor && p.type === KING) return true; }
    }
    // Bishop / queen (diagonals).
    for (const off of PIECE_OFFSETS.b) {
      let s = sq + off;
      while (isOnBoard(s)) {
        const p = this.board[s];
        if (p) { if (p.color === byColor && (p.type === BISHOP || p.type === QUEEN)) return true; break; }
        s += off;
      }
    }
    // Rook / queen (orthogonals).
    for (const off of PIECE_OFFSETS.r) {
      let s = sq + off;
      while (isOnBoard(s)) {
        const p = this.board[s];
        if (p) { if (p.color === byColor && (p.type === ROOK || p.type === QUEEN)) return true; break; }
        s += off;
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    return this.isAttacked(this.kings[color], swap(color));
  }

  _addMove(moves, from, to, flags) {
    const piece = this.board[from];
    const captured = this.board[to] ? this.board[to].type : ((flags & BITS.EP) ? PAWN : undefined);
    if (piece.type === PAWN && (rank(to) === 7 || rank(to) === 0)) {
      for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
        moves.push({ from, to, piece: piece.type, color: piece.color, captured, promotion: promo, flags: flags | BITS.PROMOTION });
      }
    } else {
      moves.push({ from, to, piece: piece.type, color: piece.color, captured, flags });
    }
  }

  generateMoves({ legal = true, square = null } = {}) {
    const moves = [];
    const us = this.turn;
    const them = swap(us);
    const secondRank = us === WHITE ? 1 : 6;
    const pawnDir = us === WHITE ? 16 : -16;

    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const piece = this.board[sq];
      if (!piece || piece.color !== us) continue;
      if (square !== null && sq !== square) continue;

      if (piece.type === PAWN) {
        let to = sq + pawnDir;
        if (isOnBoard(to) && !this.board[to]) {
          this._addMove(moves, sq, to, BITS.NORMAL);
          const dbl = sq + 2 * pawnDir;
          if (rank(sq) === secondRank && isOnBoard(dbl) && !this.board[dbl]) {
            this._addMove(moves, sq, dbl, BITS.BIG_PAWN);
          }
        }
        for (const dc of [pawnDir + 1, pawnDir - 1]) {
          to = sq + dc;
          if (!isOnBoard(to)) continue;
          const target = this.board[to];
          if (target && target.color === them) this._addMove(moves, sq, to, BITS.CAPTURE);
          else if (to === this.ep) this._addMove(moves, sq, to, BITS.EP | BITS.CAPTURE);
        }
      } else if (piece.type === KNIGHT || piece.type === KING) {
        for (const off of PIECE_OFFSETS[piece.type]) {
          const to = sq + off;
          if (!isOnBoard(to)) continue;
          const target = this.board[to];
          if (!target) this._addMove(moves, sq, to, BITS.NORMAL);
          else if (target.color === them) this._addMove(moves, sq, to, BITS.CAPTURE);
        }
      } else {
        for (const off of PIECE_OFFSETS[piece.type]) {
          let to = sq + off;
          while (isOnBoard(to)) {
            const target = this.board[to];
            if (!target) { this._addMove(moves, sq, to, BITS.NORMAL); }
            else { if (target.color === them) this._addMove(moves, sq, to, BITS.CAPTURE); break; }
            to += off;
          }
        }
      }
    }

    // Castling.
    const kingSq = this.kings[us];
    if (square === null || square === kingSq) {
      if (us === WHITE) {
        if ((this.castling & C.WK) && !this.board[5] && !this.board[6] &&
          this.board[7] && this.board[7].type === ROOK && this.board[7].color === WHITE &&
          !this.isAttacked(4, BLACK) && !this.isAttacked(5, BLACK) && !this.isAttacked(6, BLACK)) {
          moves.push({ from: 4, to: 6, piece: KING, color: WHITE, flags: BITS.KSIDE });
        }
        if ((this.castling & C.WQ) && !this.board[3] && !this.board[2] && !this.board[1] &&
          this.board[0] && this.board[0].type === ROOK && this.board[0].color === WHITE &&
          !this.isAttacked(4, BLACK) && !this.isAttacked(3, BLACK) && !this.isAttacked(2, BLACK)) {
          moves.push({ from: 4, to: 2, piece: KING, color: WHITE, flags: BITS.QSIDE });
        }
      } else {
        if ((this.castling & C.BK) && !this.board[117] && !this.board[118] &&
          this.board[119] && this.board[119].type === ROOK && this.board[119].color === BLACK &&
          !this.isAttacked(116, WHITE) && !this.isAttacked(117, WHITE) && !this.isAttacked(118, WHITE)) {
          moves.push({ from: 116, to: 118, piece: KING, color: BLACK, flags: BITS.KSIDE });
        }
        if ((this.castling & C.BQ) && !this.board[115] && !this.board[114] && !this.board[113] &&
          this.board[112] && this.board[112].type === ROOK && this.board[112].color === BLACK &&
          !this.isAttacked(116, WHITE) && !this.isAttacked(115, WHITE) && !this.isAttacked(114, WHITE)) {
          moves.push({ from: 116, to: 114, piece: KING, color: BLACK, flags: BITS.QSIDE });
        }
      }
    }

    if (!legal) return moves;

    const legalMoves = [];
    for (const m of moves) {
      this.makeMove(m);
      if (!this.isAttacked(this.kings[us], swap(us))) legalMoves.push(m);
      this.undoMove();
    }
    return legalMoves;
  }

  makeMove(m) {
    const us = this.turn;
    const them = swap(us);
    const hist = {
      move: m,
      castling: this.castling,
      ep: this.ep,
      half: this.half,
      full: this.full,
      kingsW: this.kings.w,
      kingsB: this.kings.b,
      captured: null,
      capturedSq: -1,
    };
    this.history.push(hist);

    const piece = this.board[m.from];

    if (m.flags & BITS.EP) {
      const capSq = us === WHITE ? m.to - 16 : m.to + 16;
      hist.captured = this.board[capSq];
      hist.capturedSq = capSq;
      this.board[capSq] = null;
    } else if (this.board[m.to]) {
      hist.captured = this.board[m.to];
      hist.capturedSq = m.to;
    }

    this.board[m.to] = piece;
    this.board[m.from] = null;

    if (m.flags & BITS.PROMOTION) {
      this.board[m.to] = { type: m.promotion, color: us };
    }

    if (piece.type === KING) {
      this.kings[us] = m.to;
      if (m.flags & BITS.KSIDE) {
        const rf = us === WHITE ? 7 : 119, rt = us === WHITE ? 5 : 117;
        this.board[rt] = this.board[rf]; this.board[rf] = null;
      } else if (m.flags & BITS.QSIDE) {
        const rf = us === WHITE ? 0 : 112, rt = us === WHITE ? 3 : 115;
        this.board[rt] = this.board[rf]; this.board[rf] = null;
      }
    }

    this.castling &= CASTLING_MASK[m.from];
    this.castling &= CASTLING_MASK[m.to];

    this.ep = (m.flags & BITS.BIG_PAWN) ? (us === WHITE ? m.from + 16 : m.from - 16) : -1;

    if (piece.type === PAWN || (m.flags & (BITS.CAPTURE | BITS.EP))) this.half = 0;
    else this.half += 1;

    if (us === BLACK) this.full += 1;

    this.turn = them;
    this._recordPosition();
  }

  undoMove() {
    const hist = this.history.pop();
    if (!hist) return null;

    const curKey = this._posKey();
    const c = this.positionCounts.get(curKey);
    if (c <= 1) this.positionCounts.delete(curKey); else this.positionCounts.set(curKey, c - 1);

    const m = hist.move;
    const us = swap(this.turn);
    this.turn = us;
    this.castling = hist.castling;
    this.ep = hist.ep;
    this.half = hist.half;
    this.full = hist.full;
    this.kings.w = hist.kingsW;
    this.kings.b = hist.kingsB;

    let movedPiece = this.board[m.to];
    if (m.flags & BITS.PROMOTION) movedPiece = { type: PAWN, color: us };
    this.board[m.from] = movedPiece;
    this.board[m.to] = null;

    if (hist.captured) this.board[hist.capturedSq] = hist.captured;

    if (m.flags & BITS.KSIDE) {
      const rf = us === WHITE ? 7 : 119, rt = us === WHITE ? 5 : 117;
      this.board[rf] = this.board[rt]; this.board[rt] = null;
    } else if (m.flags & BITS.QSIDE) {
      const rf = us === WHITE ? 0 : 112, rt = us === WHITE ? 3 : 115;
      this.board[rf] = this.board[rt]; this.board[rt] = null;
    }
    return m;
  }

  // ----- Public convenience API -----

  moves({ square = null } = {}) {
    const sq = typeof square === 'string' ? nameToSquare(square) : square;
    return this.generateMoves({ legal: true, square: sq });
  }

  move(m) {
    const legal = this.generateMoves({ legal: true });
    const from = typeof m.from === 'string' ? nameToSquare(m.from) : m.from;
    const to = typeof m.to === 'string' ? nameToSquare(m.to) : m.to;
    const promo = m.promotion || null;
    const found = legal.find(x => x.from === from && x.to === to && (x.promotion || null) === promo);
    if (!found) return null;
    this.makeMove(found);
    return found;
  }

  undo() { return this.undoMove(); }

  get(sq) { const s = typeof sq === 'string' ? nameToSquare(sq) : sq; return this.board[s]; }

  pieces() {
    const out = [];
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (p) out.push({ square: sq, file: file(sq), rank: rank(sq), type: p.type, color: p.color });
    }
    return out;
  }

  isCheckmate() { return this.inCheck() && this.generateMoves({ legal: true }).length === 0; }
  isStalemate() { return !this.inCheck() && this.generateMoves({ legal: true }).length === 0; }
  isThreefold() { return (this.positionCounts.get(this._posKey()) || 0) >= 3; }
  isFiftyMove() { return this.half >= 100; }

  isInsufficientMaterial() {
    const pieces = { w: [], b: [] };
    const bishops = [];
    for (let sq = 0; sq <= 119; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const p = this.board[sq];
      if (!p) continue;
      if (p.type !== KING) pieces[p.color].push(p.type);
      if (p.type === BISHOP) bishops.push((rank(sq) + file(sq)) % 2);
    }
    const all = pieces.w.concat(pieces.b);
    if (all.length === 0) return true;
    if (all.length === 1 && (all[0] === BISHOP || all[0] === KNIGHT)) return true;
    if (pieces.w.length === 1 && pieces.b.length === 1 && pieces.w[0] === BISHOP && pieces.b[0] === BISHOP) {
      if (bishops.length === 2 && bishops[0] === bishops[1]) return true;
    }
    return false;
  }

  isDraw() { return this.isStalemate() || this.isFiftyMove() || this.isThreefold() || this.isInsufficientMaterial(); }
  isGameOver() { return this.isCheckmate() || this.isDraw(); }

  perft(depth) {
    if (depth === 0) return 1;
    const moves = this.generateMoves({ legal: true });
    if (depth === 1) return moves.length;
    let nodes = 0;
    for (const m of moves) {
      this.makeMove(m);
      nodes += this.perft(depth - 1);
      this.undoMove();
    }
    return nodes;
  }
}
