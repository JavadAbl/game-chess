import { Chess, type Move } from 'chess.js'
import type { AILevel } from '../types'

/**
 * Self-contained chess AI: material + piece-square evaluation, negamax with
 * alpha-beta pruning, MVV-LVA move ordering, light quiescence search and
 * time-budgeted iterative deepening. Runs inside a Web Worker (with a
 * main-thread fallback), so it never blocks the UI.
 */

const PIECE_VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 }

// Piece-square tables from White's point of view; index 0 = a8 … 63 = h1.
const PST: Record<string, number[]> = {
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
}

const MATE_SCORE = 100000

export interface SearchParams {
  fen: string
  level: AILevel
}

export interface SearchResult {
  from: string
  to: string
  promotion?: string
}

class SearchAbort extends Error {}

/** Static evaluation from the side-to-move's perspective. */
function evaluate(game: Chess): number {
  const board = game.board()
  let score = 0
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = board[r][c]
      if (!cell) continue
      const idx = cell.color === 'w' ? r * 8 + c : (7 - r) * 8 + c
      const v = PIECE_VALUES[cell.type] + PST[cell.type][idx]
      score += cell.color === 'w' ? v : -v
    }
  }
  return game.turn() === 'w' ? score : -score
}

function orderScore(m: Move): number {
  let s = 0
  if (m.captured) s += 10 * PIECE_VALUES[m.captured] - PIECE_VALUES[m.piece]
  if (m.promotion) s += 800
  if (m.san.includes('+')) s += 50
  return s
}

function orderMoves(moves: Move[]): void {
  moves.sort((a, b) => orderScore(b) - orderScore(a))
}

function qsearch(game: Chess, alpha: number, beta: number, deadline: number): number {
  if (Date.now() > deadline) throw new SearchAbort()
  const stand = evaluate(game)
  if (stand >= beta) return beta
  if (stand > alpha) alpha = stand
  const caps = (game.moves({ verbose: true }) as Move[]).filter(
    (m) => m.captured || m.promotion,
  )
  orderMoves(caps)
  for (const m of caps) {
    game.move(m)
    const score = -qsearch(game, -beta, -alpha, deadline)
    game.undo()
    if (score >= beta) return beta
    if (score > alpha) alpha = score
  }
  return alpha
}

function negamax(
  game: Chess,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  deadline: number,
): number {
  if (Date.now() > deadline) throw new SearchAbort()
  const moves = game.moves({ verbose: true }) as Move[]
  if (moves.length === 0) return game.inCheck() ? -MATE_SCORE + ply : 0
  if (depth === 0) return qsearch(game, alpha, beta, deadline)
  orderMoves(moves)
  let best = -Infinity
  for (const m of moves) {
    game.move(m)
    const score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, deadline)
    game.undo()
    if (score > best) best = score
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

function toResult(m: Move): SearchResult {
  return m.promotion
    ? { from: m.from, to: m.to, promotion: m.promotion }
    : { from: m.from, to: m.to }
}

const MAX_DEPTH: Record<AILevel, number> = { 1: 1, 2: 2, 3: 3, 4: 4 }
const TIME_BUDGET_MS: Record<AILevel, number> = { 1: 300, 2: 900, 3: 2000, 4: 3600 }

export function findBestMove({ fen, level }: SearchParams): SearchResult | null {
  const game = new Chess(fen)
  let moves = game.moves({ verbose: true }) as Move[]
  if (moves.length === 0) return null
  if (moves.length === 1) return toResult(moves[0])

  orderMoves(moves)
  const deadline = Date.now() + TIME_BUDGET_MS[level]
  let best = moves[0]
  let lastScored: { m: Move; s: number }[] = []

  try {
    for (let depth = 1; depth <= MAX_DEPTH[level]; depth++) {
      let alpha = -Infinity
      const scored: { m: Move; s: number }[] = []
      let localBest: Move | null = null
      for (const m of moves) {
        game.move(m)
        const s = -negamax(game, depth - 1, -Infinity, -alpha, 1, deadline)
        game.undo()
        scored.push({ m, s })
        if (s > alpha) {
          alpha = s
          localBest = m
        }
      }
      if (localBest) {
        best = localBest
        lastScored = scored
      }
      scored.sort((a, b) => b.s - a.s)
      moves = scored.map((x) => x.m)
    }
  } catch (err) {
    if (!(err instanceof SearchAbort)) throw err
  }

  // Easy level: add variety by picking randomly among near-best moves.
  if (level === 1 && lastScored.length > 1) {
    const bestScore = Math.max(...lastScored.map((x) => x.s))
    const pool = lastScored.filter((x) => x.s >= bestScore - 80)
    const pick = pool[Math.floor(Math.random() * pool.length)]
    return toResult(pick.m)
  }

  return toResult(best)
}
