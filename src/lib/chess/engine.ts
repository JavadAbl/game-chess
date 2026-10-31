import { Chess, type Move, type Square } from 'chess.js'
import type { BoardCell, MoveDetail, PieceType, SquareColor } from './types'

/**
 * Thin wrapper around a module-level chess.js instance.
 * The React store and the 3D scene both read through this module so there is
 * exactly one authoritative game position on the client.
 */

let chess = new Chess()

export function resetEngine(fen?: string): void {
  chess = new Chess(fen)
}

export function loadFen(fen: string): boolean {
  try {
    chess.load(fen)
    return true
  } catch {
    return false
  }
}

export function currentFen(): string {
  return chess.fen()
}

export function turn(): SquareColor {
  return chess.turn()
}

export function inCheck(): boolean {
  return chess.inCheck()
}

/** Flat 64-cell snapshot, rank 8 → rank 1, file a → h. */
export function boardSnapshot(): BoardCell[] {
  const rows = chess.board()
  const out: BoardCell[] = []
  for (const row of rows) for (const cell of row) out.push(cell)
  return out
}

export function movesFrom(square: string): Move[] {
  return chess.moves({ square: square as Square, verbose: true }) as Move[]
}

export function legalTargetsFrom(square: string): string[] {
  return movesFrom(square).map((m) => m.to)
}

/** True if any legal move from→to is a promotion (i.e. the dialog must open). */
export function isPromotionPath(from: string, to: string): boolean {
  return movesFrom(from).some((m) => m.to === to && m.flags.includes('p'))
}

export function hasOwnPiece(square: string, color: SquareColor): boolean {
  const p = chess.get(square as Square)
  return !!p && p.color === color
}

/** Applies a move; throws if illegal (callers guard with cached legal targets). */
export function applyLocalMove(from: string, to: string, promotion?: string): Move {
  return chess.move({ from: from as Square, to: to as Square, promotion }) as Move
}

export function undoPly(): Move | null {
  return chess.undo()
}

/** Applies a move in SAN (used when rebuilding history from a server replay). */
export function applySan(san: string): Move {
  return chess.move(san) as Move
}

export function historyVerbose(): Move[] {
  return chess.history({ verbose: true }) as Move[]
}

export function pgn(): string {
  return chess.pgn()
}

export function toDetail(m: Move): MoveDetail {
  return {
    from: m.from,
    to: m.to,
    piece: m.piece as PieceType,
    color: m.color as SquareColor,
    captured: m.captured as PieceType | undefined,
    promotion: m.promotion as PieceType | undefined,
    flags: m.flags,
    san: m.san,
  }
}

export interface StatusInfo {
  over: boolean
  result: { winner: SquareColor | null; reason: 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty' } | null
  checkSquare: string | null
  inCheck: boolean
}

function findKingSquare(color: SquareColor): string | null {
  for (const cell of boardSnapshot()) {
    if (cell && cell.type === 'k' && cell.color === color) return cell.square
  }
  return null
}

export function gameStatus(): StatusInfo {
  const inCheckNow = chess.inCheck()
  const checkSquare = inCheckNow ? findKingSquare(chess.turn()) : null
  if (chess.isCheckmate()) {
    return {
      over: true,
      result: { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' },
      checkSquare,
      inCheck: true,
    }
  }
  if (chess.isStalemate()) {
    return { over: true, result: { winner: null, reason: 'stalemate' }, checkSquare, inCheck: inCheckNow }
  }
  if (chess.isInsufficientMaterial()) {
    return { over: true, result: { winner: null, reason: 'insufficient' }, checkSquare, inCheck: inCheckNow }
  }
  if (chess.isThreefoldRepetition()) {
    return { over: true, result: { winner: null, reason: 'threefold' }, checkSquare, inCheck: inCheckNow }
  }
  if (chess.isDraw()) {
    return { over: true, result: { winner: null, reason: 'fifty' }, checkSquare, inCheck: inCheckNow }
  }
  return { over: false, result: null, checkSquare, inCheck: inCheckNow }
}
