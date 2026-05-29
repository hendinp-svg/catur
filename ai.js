// ai.js
// A compact but respectable chess AI: negamax + alpha-beta pruning, piece-square
// tables, MVV-LVA capture ordering, a quiescence search to avoid the horizon
// effect, and time-bounded iterative deepening so it stays responsive.

import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, BITS, rank, file } from './chess-engine.js';

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const MATE = 1000000;

// Piece-square tables, written in a8-first orientation (row 0 = rank 8).
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
};

function pstValue(type, sq, color) {
  const idx = color === WHITE ? (7 - rank(sq)) * 8 + file(sq) : rank(sq) * 8 + file(sq);
  return PST[type][idx];
}

// Static evaluation from White's point of view (positive = White is better).
function evaluate(game) {
  let score = 0;
  for (let sq = 0; sq <= 119; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = game.board[sq];
    if (!p) continue;
    const v = VALUE[p.type] + pstValue(p.type, sq, p.color);
    score += p.color === WHITE ? v : -v;
  }
  return score;
}

function orderMoves(moves) {
  for (const m of moves) {
    let s = 0;
    if (m.flags & (BITS.CAPTURE | BITS.EP)) {
      const victim = m.captured ? VALUE[m.captured] : VALUE.p;
      s += 10 * victim - VALUE[m.piece];
    }
    if (m.flags & BITS.PROMOTION) s += VALUE[m.promotion] || VALUE.q;
    m._order = s;
  }
  moves.sort((a, b) => b._order - a._order);
  return moves;
}

function quiesce(game, alpha, beta, deadline) {
  const sign = game.turn === WHITE ? 1 : -1;
  const standPat = sign * evaluate(game);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  if (Date.now() > deadline) return alpha;

  const caps = orderMoves(game.generateMoves({ legal: true }).filter(m => m.flags & (BITS.CAPTURE | BITS.EP)));
  for (const m of caps) {
    game.makeMove(m);
    const score = -quiesce(game, -beta, -alpha, deadline);
    game.undoMove();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(game, depth, alpha, beta, ply, deadline, useQuiesce) {
  if (Date.now() > deadline) throw 'TIMEOUT';

  const moves = game.generateMoves({ legal: true });
  if (moves.length === 0) {
    if (game.inCheck()) return -(MATE - ply); // checkmate: worse the later it is preferred sooner
    return 0; // stalemate
  }
  if (depth === 0) {
    return useQuiesce ? quiesce(game, alpha, beta, deadline) : (game.turn === WHITE ? 1 : -1) * evaluate(game);
  }

  orderMoves(moves);
  let best = -Infinity;
  for (const m of moves) {
    game.makeMove(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, deadline, useQuiesce);
    game.undoMove();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function searchDepth(game, depth, deadline, useQuiesce) {
  const moves = orderMoves(game.generateMoves({ legal: true }));
  if (moves.length === 0) return null;
  let best = null, bestScore = -Infinity, alpha = -Infinity;
  const beta = Infinity;
  const scored = [];
  for (const m of moves) {
    game.makeMove(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, 1, deadline, useQuiesce);
    game.undoMove();
    scored.push({ move: m, score });
    if (score > bestScore) { bestScore = score; best = m; }
    if (score > alpha) alpha = score;
  }
  return { move: best, score: bestScore, scored };
}

/**
 * Pick a move for the side to move.
 * level: 'easy' | 'medium' | 'hard'
 * Returns { from, to, promotion?, flags } move object (legal), or null.
 */
export function pickMove(game, level = 'medium') {
  const legal = game.generateMoves({ legal: true });
  if (legal.length === 0) return null;

  if (level === 'easy') {
    // Shallow look, and frequently make a casual (suboptimal) choice so a
    // beginner can win. ~45% of the time, pick a random non-blundering move.
    if (Math.random() < 0.45) {
      // Avoid hanging the queen for free if trivially obvious: just pick random.
      return legal[Math.floor(Math.random() * legal.length)];
    }
    const deadline = Date.now() + 400;
    try {
      const res = searchDepth(game, 1, deadline, false);
      // Among moves within 60cp of best, choose randomly for variety.
      if (res && res.scored) {
        const top = res.scored.filter(s => s.score >= res.score - 60);
        return top[Math.floor(Math.random() * top.length)].move;
      }
      return res ? res.move : legal[0];
    } catch (e) {
      return legal[Math.floor(Math.random() * legal.length)];
    }
  }

  const config = {
    medium: { maxDepth: 3, time: 700, q: false },
    hard: { maxDepth: 5, time: 1400, q: true },
  }[level] || { maxDepth: 3, time: 700, q: false };

  const start = Date.now();
  const deadline = start + config.time;
  let best = { move: legal[0], score: 0 };

  // Iterative deepening: keep the best result from the last fully-completed depth.
  for (let d = 1; d <= config.maxDepth; d++) {
    try {
      const res = searchDepth(game, d, deadline, config.q);
      if (res && res.move) best = res;
    } catch (e) {
      break; // ran out of time; keep previous depth's best
    }
    if (Date.now() > deadline) break;
    // Found a forced mate — no need to search deeper.
    if (Math.abs(best.score) > MATE - 1000) break;
  }
  return best.move;
}

export { evaluate };
