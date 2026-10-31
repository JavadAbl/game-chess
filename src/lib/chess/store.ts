import { create } from 'zustand'
import {
  applyLocalMove,
  applySan,
  currentFen,
  gameStatus,
  hasOwnPiece,
  historyVerbose,
  isPromotionPath,
  legalTargetsFrom,
  loadFen,
  pgn,
  resetEngine,
  toDetail,
  turn,
  undoPly,
} from './engine'
import type {
  AILevel,
  GameMode,
  GameResult,
  MoveDetail,
  PieceType,
  SquareColor,
} from './types'
import { requestAIMove, cancelPendingAIMoves } from './ai/aiClient'
import { getSocket } from '@/lib/net/socket'
import { sfx, setMuted } from '@/lib/audio/sfx'

/** The AI always plays Black and the human plays White. */
const AI_COLOR: SquareColor = 'b'

export type OnlineStatus = 'idle' | 'waiting' | 'connected'

interface OnlineMovePayload {
  move: { from: string; to: string; promotion?: string }
  fen: string
  san: string
  checkSquare: string | null
  over: boolean
  result: { winner: SquareColor | null; reason: string } | null
}

export interface RestoreSessionArgs {
  code: string
  token: string
  color: SquareColor
  fen: string
  sans: string[]
  opponentOnline: boolean
}

interface ChessState {
  // lifecycle
  phase: 'menu' | 'playing' | 'over'
  mode: GameMode
  orientation: SquareColor

  // position
  fen: string
  turn: SquareColor
  moveSeq: number
  /** Bumped on every game start (mode start, New, rematch, rejoin) — drives the random environment re-roll. */
  gameNonce: number
  lastMoveDetail: MoveDetail | null
  lastMove: { from: string; to: string } | null
  selected: string | null
  legalTargets: string[]
  checkSquare: string | null
  history: MoveDetail[]
  capturedByWhite: PieceType[]
  capturedByBlack: PieceType[]
  result: GameResult | null
  pgnText: string

  // ai
  aiLevel: AILevel
  aiThinking: boolean

  // online
  roomCode: string | null
  roomToken: string | null
  myColor: SquareColor | null
  onlineStatus: OnlineStatus
  opponentOnline: boolean
  socketConnected: boolean
  rematchMe: boolean
  rematchOpponent: boolean

  // ui
  pendingPromotion: { from: string; to: string } | null
  soundOn: boolean
  /** Beginner mode: glow every piece of the local player's side that has a legal move. */
  beginnerMode: boolean
  backend: 'webgpu' | 'webgl2' | null
  gpuSupported: boolean | null

  // actions
  goMenu: () => void
  startLocal: () => void
  startAI: (level: AILevel) => void
  setAiLevel: (level: AILevel) => void
  createOnlineRoom: () => void
  joinOnlineRoom: (code: string) => void
  leaveOnlineRoom: () => void
  resignOnline: () => void
  requestRematch: () => void

  onSquareClick: (square: string) => void
  deselect: () => void
  choosePromotion: (piece: PieceType) => void
  cancelPromotion: () => void
  undo: () => void
  newGameSameMode: () => void

  applyRemoteMove: (payload: OnlineMovePayload) => void
  onGameStart: () => void
  onGameOver: (result: { winner: SquareColor | null; reason: string }) => void
  onRematchUpdate: (flags: { w: boolean; b: boolean }) => void
  setOpponentOnline: (online: boolean) => void
  setSocketConnected: (connected: boolean) => void
  restoreOnlineSession: (args: RestoreSessionArgs) => void

  toggleSound: () => void
  toggleBeginner: () => void
  setBackend: (b: 'webgpu' | 'webgl2') => void
  setGpuSupported: (v: boolean) => void
  flipOrientation: () => void
}

function capturedArrays(history: MoveDetail[]): {
  capturedByWhite: PieceType[]
  capturedByBlack: PieceType[]
} {
  const capturedByWhite: PieceType[] = []
  const capturedByBlack: PieceType[] = []
  for (const m of history) {
    if (!m.captured) continue
    if (m.color === 'w') capturedByWhite.push(m.captured)
    else capturedByBlack.push(m.captured)
  }
  return { capturedByWhite, capturedByBlack }
}

/** Rebuilds a consistent snapshot from the engine (used by undo/reset/restore). */
function snapshotFromEngine(getMoveSeq: () => number) {
  const history = historyVerbose().map(toDetail)
  const last = history.length > 0 ? history[history.length - 1] : null
  const status = gameStatus()
  const { capturedByWhite, capturedByBlack } = capturedArrays(history)
  return {
    fen: currentFen(),
    turn: turn(),
    moveSeq: getMoveSeq() + 1,
    lastMoveDetail: null,
    lastMove: last ? { from: last.from, to: last.to } : null,
    selected: null,
    legalTargets: [] as string[],
    checkSquare: status.checkSquare,
    history,
    capturedByWhite,
    capturedByBlack,
    pendingPromotion: null,
  }
}

function saveSession(code: string, token: string): void {
  try {
    sessionStorage.setItem('gm3d.online', JSON.stringify({ code, token }))
  } catch {
    /* storage optional */
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem('gm3d.online')
  } catch {
    /* storage optional */
  }
}

const BEGINNER_KEY = 'gm3d.beginner'

function readBeginnerPref(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(BEGINNER_KEY) === '1'
  } catch {
    return false
  }
}

export const useChessStore = create<ChessState>()((set, get) => ({
  phase: 'menu',
  mode: 'local',
  orientation: 'w',

  fen: '',
  turn: 'w',
  moveSeq: 0,
  gameNonce: 0,
  lastMoveDetail: null,
  lastMove: null,
  selected: null,
  legalTargets: [],
  checkSquare: null,
  history: [],
  capturedByWhite: [],
  capturedByBlack: [],
  result: null,
  pgnText: '',

  aiLevel: 2,
  aiThinking: false,

  roomCode: null,
  roomToken: null,
  myColor: null,
  onlineStatus: 'idle',
  opponentOnline: false,
  socketConnected: false,
  rematchMe: false,
  rematchOpponent: false,

  pendingPromotion: null,
  soundOn: true,
  // SSR-safe start: the persisted preference is applied after mount by
  // hydrateBeginnerPref() — reading localStorage during module init would
  // make the server-rendered switch mismatch its hydrated state.
  beginnerMode: false,
  backend: null,
  gpuSupported: null,

  // ── navigation ──────────────────────────────────────────────
  goMenu: () => {
    cancelPendingAIMoves()
    const socket = getSocket()
    const { roomCode } = get()
    if (roomCode) socket.emit('room:leave', { code: roomCode })
    clearSession()
    resetEngine()
    set({
      phase: 'menu',
      onlineStatus: 'idle',
      roomCode: null,
      roomToken: null,
      myColor: null,
      opponentOnline: false,
      rematchMe: false,
      rematchOpponent: false,
      aiThinking: false,
      result: null,
      pgnText: '',
      orientation: 'w',
      ...snapshotFromEngine(() => get().moveSeq),
    })
  },

  // ── modes ───────────────────────────────────────────────────
  startLocal: () => {
    resetEngine()
    set({
      mode: 'local',
      phase: 'playing',
      gameNonce: get().gameNonce + 1,
      orientation: 'w',
      result: null,
      aiThinking: false,
      ...snapshotFromEngine(() => get().moveSeq),
    })
  },

  startAI: (level: AILevel) => {
    resetEngine()
    set({
      mode: 'ai',
      aiLevel: level,
      phase: 'playing',
      gameNonce: get().gameNonce + 1,
      orientation: 'w',
      result: null,
      aiThinking: false,
      ...snapshotFromEngine(() => get().moveSeq),
    })
  },

  setAiLevel: (level: AILevel) => set({ aiLevel: level }),

  createOnlineRoom: () => {
    const socket = getSocket()
    socket.emit('room:create', (ack: { ok: boolean; code?: string; token?: string }) => {
      if (ack.ok && ack.code && ack.token) {
        saveSession(ack.code, ack.token)
        set({
          mode: 'online',
          phase: 'playing',
          gameNonce: get().gameNonce + 1,
          onlineStatus: 'waiting',
          roomCode: ack.code,
          roomToken: ack.token,
          myColor: 'w',
          orientation: 'w',
          opponentOnline: false,
          rematchMe: false,
          rematchOpponent: false,
          result: null,
          aiThinking: false,
          ...snapshotFromEngine(() => get().moveSeq),
        })
      } else {
        sfx.illegal()
      }
    })
  },

  joinOnlineRoom: (code: string) => {
    const socket = getSocket()
    const normalized = code.trim().toUpperCase()
    socket.emit('room:join', { code: normalized }, (ack: { ok: boolean; token?: string; error?: string }) => {
      if (ack.ok && ack.token) {
        saveSession(normalized, ack.token)
        set({
          mode: 'online',
          onlineStatus: 'connected',
          roomCode: normalized,
          roomToken: ack.token,
          myColor: 'b',
          orientation: 'b',
          opponentOnline: true,
          rematchMe: false,
          rematchOpponent: false,
          result: null,
          aiThinking: false,
          ...snapshotFromEngine(() => get().moveSeq),
        })
      } else {
        sfx.illegal()
        set({ roomCode: null, roomToken: null, onlineStatus: 'idle' })
      }
    })
  },

  leaveOnlineRoom: () => {
    const socket = getSocket()
    const { roomCode } = get()
    if (roomCode) socket.emit('room:leave', { code: roomCode })
    clearSession()
    set({
      onlineStatus: 'idle',
      roomCode: null,
      roomToken: null,
      myColor: null,
      opponentOnline: false,
      rematchMe: false,
      rematchOpponent: false,
    })
    get().goMenu()
  },

  resignOnline: () => {
    const { roomCode, roomToken } = get()
    if (!roomCode || !roomToken) return
    getSocket().emit('game:resign', { code: roomCode, token: roomToken })
  },

  requestRematch: () => {
    const { roomCode, roomToken } = get()
    if (!roomCode || !roomToken) return
    set({ rematchMe: true })
    getSocket().emit('rematch:request', { code: roomCode, token: roomToken })
  },

  // ── gameplay ────────────────────────────────────────────────
  onSquareClick: (square: string) => {
    const state = get()
    if (state.phase !== 'playing' || state.pendingPromotion) return
    if (state.mode === 'ai' && (state.aiThinking || state.turn === AI_COLOR)) return
    if (state.mode === 'online' && state.myColor !== null && state.turn !== state.myColor) return

    // Complete a pending move
    if (state.selected && state.legalTargets.includes(square)) {
      const from = state.selected
      if (isPromotionPath(from, square)) {
        set({ pendingPromotion: { from, to: square } })
        return
      }
      playMove(from, square, undefined, set, get)
      return
    }

    // Select own piece
    const canPick =
      state.mode === 'local'
        ? hasOwnPiece(square, state.turn)
        : hasOwnPiece(square, state.mode === 'ai' ? 'w' : (state.myColor ?? 'w'))
    if (canPick) {
      const targets = legalTargetsFrom(square)
      if (targets.length === 0) {
        sfx.illegal()
        set({ selected: null, legalTargets: [] })
        return
      }
      sfx.click()
      set({ selected: square, legalTargets: targets })
      return
    }

    // Clicked elsewhere — deselect
    if (state.selected) set({ selected: null, legalTargets: [] })
  },

  /** Clears the active selection (right-click on the piece / Escape). */
  deselect: () => {
    const state = get()
    if (state.pendingPromotion) return // the promotion dialog owns cancel/ESC
    if (!state.selected) return
    set({ selected: null, legalTargets: [] })
  },

  choosePromotion: (piece: PieceType) => {
    const pending = get().pendingPromotion
    if (!pending) return
    set({ pendingPromotion: null })
    playMove(pending.from, pending.to, piece, set, get)
  },

  cancelPromotion: () => set({ pendingPromotion: null, selected: null, legalTargets: [] }),

  undo: () => {
    const state = get()
    if (state.mode === 'online' || state.aiThinking) return
    if (historyVerbose().length === 0) return
    undoPly()
    // In AI mode make sure the turn lands back on the human.
    if (state.mode === 'ai' && turn() === AI_COLOR && historyVerbose().length > 0) undoPly()
    sfx.click()
    set((s) => ({
      phase: 'playing',
      result: null,
      ...snapshotFromEngine(() => s.moveSeq),
    }))
  },

  newGameSameMode: () => {
    const state = get()
    if (state.mode === 'online') {
      state.requestRematch()
      return
    }
    resetEngine()
    sfx.click()
    set((s) => ({
      phase: 'playing',
      gameNonce: s.gameNonce + 1,
      result: null,
      aiThinking: false,
      rematchMe: false,
      rematchOpponent: false,
      ...snapshotFromEngine(() => s.moveSeq),
    }))
  },

  // ── online events ───────────────────────────────────────────
  applyRemoteMove: (payload: OnlineMovePayload) => {
    const state = get()
    if (state.mode !== 'online') return
    try {
      const mv = applyLocalMove(payload.move.from, payload.move.to, payload.move.promotion)
      onMoveApplied(toDetail(mv), set, get)
    } catch {
      // Desync — hard-resync from authoritative FEN.
      loadFen(payload.fen)
      set((s) => ({ ...snapshotFromEngine(() => s.moveSeq) }))
    }
  },

  onGameStart: () => {
    resetEngine()
    const { myColor } = get()
    set((s) => ({
      phase: 'playing',
      gameNonce: s.gameNonce + 1,
      onlineStatus: 'connected',
      result: null,
      rematchMe: false,
      rematchOpponent: false,
      orientation: myColor ?? 'w',
      ...snapshotFromEngine(() => s.moveSeq),
    }))
  },

  onGameOver: (result) => {
    if (get().phase === 'over') return // already finished via game:move
    const validReasons = ['checkmate', 'stalemate', 'insufficient', 'threefold', 'fifty', 'resign'] as const
    const reason = (validReasons as readonly string[]).includes(result.reason)
      ? (result.reason as (typeof validReasons)[number])
      : 'fifty'
    set({ phase: 'over', result: { winner: result.winner, reason }, pgnText: pgn() })
    sfx.gameEnd()
  },

  onRematchUpdate: (flags) => {
    set({ rematchMe: flags[get().myColor ?? 'w'], rematchOpponent: flags[get().myColor === 'w' ? 'b' : 'w'] })
  },

  setOpponentOnline: (online: boolean) => set({ opponentOnline: online }),
  setSocketConnected: (connected: boolean) => set({ socketConnected: connected }),

  restoreOnlineSession: ({ code, token, color, sans, opponentOnline }: RestoreSessionArgs) => {
    // Rebuild the full move list from SAN so history/captured state are correct.
    resetEngine()
    for (const san of sans) {
      try {
        applySan(san)
      } catch {
        break
      }
    }
    set({
      mode: 'online',
      phase: 'playing',
      gameNonce: get().gameNonce + 1,
      onlineStatus: 'connected',
      roomCode: code,
      roomToken: token,
      myColor: color,
      orientation: color,
      opponentOnline,
      result: null,
      rematchMe: false,
      rematchOpponent: false,
      ...snapshotFromEngine(() => get().moveSeq),
    })
  },

  // ── ui ──────────────────────────────────────────────────────
  toggleSound: () => {
    const next = !get().soundOn
    set({ soundOn: next })
    setMuted(!next)
  },
  /** Beginner hints persist across sessions so learners keep their glow. */
  toggleBeginner: () => {
    const next = !get().beginnerMode
    set({ beginnerMode: next })
    try {
      window.localStorage.setItem(BEGINNER_KEY, next ? '1' : '0')
    } catch {
      /* storage optional */
    }
    sfx.click()
  },
  setBackend: (b) => set({ backend: b }),
  setGpuSupported: (v) => set({ gpuSupported: v }),
  flipOrientation: () => {
    sfx.click()
    set((s) => ({ orientation: s.orientation === 'w' ? 'b' : 'w' }))
  },
}))

// ── helpers that need set/get ─────────────────────────────────

/**
 * Applies the persisted beginner preference once, after React has hydrated.
 * Called from a ChessApp mount effect; the subscription in ChessCanvas picks
 * the change up and paints the hints without any further wiring.
 */
export function hydrateBeginnerPref(): void {
  const pref = readBeginnerPref()
  if (pref !== useChessStore.getState().beginnerMode) {
    useChessStore.setState({ beginnerMode: pref })
  }
}

type SetState = (partial: Partial<ChessState> | ((s: ChessState) => Partial<ChessState>)) => void
type GetState = () => ChessState

function playMove(from: string, to: string, promotion: string | undefined, set: SetState, get: GetState): void {
  try {
    const mv = applyLocalMove(from, to, promotion)
    onMoveApplied(toDetail(mv), set, get)
  } catch {
    sfx.illegal()
    set({ selected: null, legalTargets: [] })
  }
}

function onMoveApplied(detail: MoveDetail, set: SetState, get: GetState): void {
  const history = historyVerbose().map(toDetail)
  const status = gameStatus()
  const { capturedByWhite, capturedByBlack } = capturedArrays(history)

  // Sounds — order matters: board sound first, then contextual cues.
  if (detail.captured) sfx.capture()
  else if (detail.flags.includes('k') || detail.flags.includes('q')) sfx.castle()
  else sfx.move()
  if (detail.promotion) sfx.promote()
  if (status.over) sfx.gameEnd()
  else if (status.inCheck) sfx.check()

  set((s) => ({
    fen: currentFen(),
    turn: turn(),
    moveSeq: s.moveSeq + 1,
    lastMoveDetail: detail,
    lastMove: { from: detail.from, to: detail.to },
    selected: null,
    legalTargets: [],
    checkSquare: status.checkSquare,
    history,
    capturedByWhite,
    capturedByBlack,
    pendingPromotion: null,
    phase: status.over ? 'over' : 'playing',
    result: status.result ?? s.result,
    pgnText: status.over ? pgn() : s.pgnText,
  }))

  // Trigger the AI when it is its turn.
  const state = get()
  if (state.mode === 'ai' && !status.over && turn() === AI_COLOR) {
    const requestSeq = state.moveSeq
    set({ aiThinking: true })
    requestAIMove({ fen: currentFen(), level: state.aiLevel }, (res) => {
      const now = get()
      if (now.mode !== 'ai' || now.phase !== 'playing') {
        set({ aiThinking: false })
        return
      }
      set({ aiThinking: false })
      if (!res || now.moveSeq !== requestSeq || turn() !== AI_COLOR) return
      playMove(res.from, res.to, res.promotion, set, get)
    })
  }
}
