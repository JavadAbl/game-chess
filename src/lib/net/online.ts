import { getSocket } from './socket'
import { useChessStore } from '@/lib/chess/store'
import { toast } from 'sonner'

/**
 * Binds server-push events to store actions exactly once. Called from the
 * app root on mount. Rejoin-on-reconnect is handled here too.
 */

let bound = false

function tryRejoin(): void {
  const raw = sessionStorage.getItem('gm3d.online')
  if (!raw) return
  try {
    const saved = JSON.parse(raw) as { code: string; token: string }
    const socket = getSocket()
    socket.emit('room:rejoin', { code: saved.code, token: saved.token }, (ack: { ok: boolean; color?: 'w' | 'b'; fen?: string; sans?: string[]; opponentOnline?: boolean }) => {
      if (ack.ok && ack.color && ack.fen) {
        useChessStore.getState().restoreOnlineSession({
          code: saved.code,
          token: saved.token,
          color: ack.color,
          fen: ack.fen,
          sans: ack.sans ?? [],
          opponentOnline: ack.opponentOnline ?? false,
        })
        toast.success('Reconnected to the room')
      } else {
        sessionStorage.removeItem('gm3d.online')
      }
    })
  } catch {
    sessionStorage.removeItem('gm3d.online')
  }
}

export function bindOnlineEvents(): void {
  if (bound) return
  bound = true
  const socket = getSocket()

  socket.on('connect', () => {
    useChessStore.getState().setSocketConnected(true)
    tryRejoin()
  })

  socket.on('disconnect', () => {
    useChessStore.getState().setSocketConnected(false)
  })

  socket.on('game:start', () => {
    useChessStore.getState().onGameStart()
  })

  socket.on('game:move', (payload: Parameters<ReturnType<typeof useChessStore.getState>['applyRemoteMove']>[0]) => {
    useChessStore.getState().applyRemoteMove(payload)
  })

  socket.on('game:over', (payload: { result: { winner: 'w' | 'b' | null; reason: string } }) => {
    useChessStore.getState().onGameOver(payload.result)
  })

  socket.on('opponent:joined', () => {
    useChessStore.getState().setOpponentOnline(true)
    toast.success('Opponent joined the game')
  })

  socket.on('opponent:rejoined', () => {
    useChessStore.getState().setOpponentOnline(true)
    toast.success('Opponent reconnected')
  })

  socket.on('opponent:left', () => {
    useChessStore.getState().setOpponentOnline(false)
    toast.warning('Opponent disconnected — waiting for them to come back…')
  })

  socket.on('rematch:update', (payload: { w: boolean; b: boolean }) => {
    useChessStore.getState().onRematchUpdate(payload)
  })
}
