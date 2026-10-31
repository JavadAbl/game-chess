export type SquareColor = 'w' | 'b'
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'
export type GameMode = 'ai' | 'local' | 'online'
export type AILevel = 1 | 2 | 3 | 4

/** One cell of the board snapshot (null = empty square). */
export type BoardCell = { square: string; type: PieceType; color: SquareColor } | null

/** Verbose, serializable description of a played move. */
export interface MoveDetail {
  from: string
  to: string
  piece: PieceType
  color: SquareColor
  captured?: PieceType
  promotion?: PieceType
  flags: string
  san: string
}

export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient'
  | 'threefold'
  | 'fifty'
  | 'resign'

export interface GameResult {
  winner: SquareColor | null
  reason: ResultReason
}

export function resultText(result: GameResult): string {
  if (result.winner === null) {
    switch (result.reason) {
      case 'stalemate':
        return 'Draw — stalemate'
      case 'insufficient':
        return 'Draw — insufficient material'
      case 'threefold':
        return 'Draw — threefold repetition'
      case 'fifty':
        return 'Draw — fifty-move rule'
      default:
        return 'Draw'
    }
  }
  const side = result.winner === 'w' ? 'White' : 'Black'
  if (result.reason === 'checkmate') return `${side} wins by checkmate`
  if (result.reason === 'resign') return `${side} wins by resignation`
  return `${side} wins`
}
