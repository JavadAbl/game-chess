import { createServer } from 'http'
import { Server, type Socket } from 'socket.io'
import { Chess } from 'chess.js'

/**
 * Online chess mini-service (port 3003).
 * Rooms are in-memory; every move is re-validated with chess.js before it is
 * broadcast, so a tampered client cannot produce an illegal position.
 */

const PORT = 3003

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path, it is used by Caddy to forward the request
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

type SeatColor = 'w' | 'b'

interface Seat {
  socketId: string
  token: string
  online: boolean
}

interface Room {
  code: string
  white: Seat
  black: Seat | null
  chess: Chess
  status: 'waiting' | 'playing' | 'finished'
  rematch: { w: boolean; b: boolean }
  disconnectTimer: ReturnType<typeof setTimeout> | null
}

const rooms = new Map<string, Room>()
const DISCONNECT_GRACE_MS = 90_000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function genCode(): string {
  let code = ''
  do {
    code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('')
  } while (rooms.has(code))
  return code
}

function genToken(): string {
  return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function seatByToken(room: Room, token: string): SeatColor | null {
  if (room.white.token === token) return 'w'
  if (room.black && room.black.token === token) return 'b'
  return null
}

function seat(room: Room, color: SeatColor): Seat | null {
  if (color === 'w') return room.white
  return room.black
}

function findKingSquare(chess: Chess, color: SeatColor): string | null {
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square
    }
  }
  return null
}

function statusOf(room: Room): {
  over: boolean
  result: { winner: SeatColor | null; reason: string } | null
  checkSquare: string | null
} {
  const inCheck = room.chess.inCheck()
  const checkSquare = inCheck ? findKingSquare(room.chess, room.chess.turn()) : null
  if (room.chess.isCheckmate()) {
    return {
      over: true,
      result: { winner: room.chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' },
      checkSquare,
    }
  }
  if (room.chess.isStalemate()) return { over: true, result: { winner: null, reason: 'stalemate' }, checkSquare }
  if (room.chess.isInsufficientMaterial()) {
    return { over: true, result: { winner: null, reason: 'insufficient' }, checkSquare }
  }
  if (room.chess.isThreefoldRepetition()) {
    return { over: true, result: { winner: null, reason: 'threefold' }, checkSquare }
  }
  if (room.chess.isDraw()) return { over: true, result: { winner: null, reason: 'fifty' }, checkSquare }
  return { over: false, result: null, checkSquare }
}

function historySans(room: Room): string[] {
  return room.chess.history()
}

function clearDisconnectTimer(room: Room): void {
  if (room.disconnectTimer) {
    clearTimeout(room.disconnectTimer)
    room.disconnectTimer = null
  }
}

function scheduleRoomCleanup(room: Room, offlineColor: SeatColor): void {
  clearDisconnectTimer(room)
  room.disconnectTimer = setTimeout(() => {
    const s = seat(room, offlineColor)
    if (s && !s.online) {
      rooms.delete(room.code)
      console.log(`Room ${room.code} removed (player offline timeout)`)
    }
  }, DISCONNECT_GRACE_MS)
}

function resetForRematch(room: Room): void {
  room.chess = new Chess()
  room.status = 'playing'
  room.rematch = { w: false, b: false }
  io.to(room.code).emit('game:start', { fen: room.chess.fen() })
  console.log(`Room ${room.code}: rematch started`)
}

function asAck(a?: unknown, b?: unknown): ((response: unknown) => void) | undefined {
  if (typeof a === 'function') return a as (response: unknown) => void
  if (typeof b === 'function') return b as (response: unknown) => void
  return undefined
}

io.on('connection', (socket: Socket) => {
  console.log(`Socket connected: ${socket.id}`)

  socket.on('room:create', (a?: unknown, b?: unknown) => {
    const ack = asAck(a, b)
    const code = genCode()
    const room: Room = {
      code,
      white: { socketId: socket.id, token: genToken(), online: true },
      black: null,
      chess: new Chess(),
      status: 'waiting',
      rematch: { w: false, b: false },
      disconnectTimer: null,
    }
    rooms.set(code, room)
    socket.join(code)
    ack?.({ ok: true, code, token: room.white.token, color: 'w' })
    console.log(`Room ${code} created by ${socket.id}`)
  })

  socket.on(
    'room:join',
    (data: { code?: string }, b?: unknown) => {
      const ack = asAck(undefined, b)
      const code = (data.code ?? '').trim().toUpperCase()
      const room = rooms.get(code)
      if (!room) {
        ack?.({ ok: false, error: 'Room not found — check the code' })
        return
      }
      if (room.black) {
        ack?.({ ok: false, error: 'Room is full' })
        return
      }
      room.black = { socketId: socket.id, token: genToken(), online: true }
      room.status = 'playing'
      clearDisconnectTimer(room)
      socket.join(code)
      ack?.({ ok: true, code, token: room.black.token, color: 'b' })
      io.to(code).emit('game:start', { fen: room.chess.fen() })
      // Everyone except the joiner (i.e. the host) marks the opponent online.
      socket.to(code).emit('opponent:joined', {})
      console.log(`Room ${code}: black joined (${socket.id})`)
    },
  )

  socket.on('room:rejoin', (data: { code?: string; token?: string }, b?: unknown) => {
    const ack = asAck(undefined, b)
    const code = (data.code ?? '').trim().toUpperCase()
    const token = data.token ?? ''
    const room = rooms.get(code)
    if (!room) {
      ack?.({ ok: false, error: 'Room no longer exists' })
      return
    }
    let color: SeatColor | null = seatByToken(room, token)
    if (!color) {
      ack?.({ ok: false, error: 'Invalid token' })
      return
    }
    const s = seat(room, color)
    if (s) {
      s.socketId = socket.id
      s.online = true
    }
    clearDisconnectTimer(room)
    socket.join(code)
    ack?.({
      ok: true,
      color,
      fen: room.chess.fen(),
      sans: historySans(room),
      status: room.status,
      opponentOnline: color === 'w' ? !!room.black?.online : room.white.online,
    })
    socket.to(code).emit('opponent:rejoined', {})
    console.log(`Room ${code}: ${color} rejoined`)
  })

  socket.on(
    'game:move',
    (
      data: { code?: string; token?: string; from?: string; to?: string; promotion?: string },
      b?: unknown,
    ) => {
      const ack = asAck(undefined, b)
      const code = (data.code ?? '').trim().toUpperCase()
      const room = rooms.get(code)
      if (!room) {
        ack?.({ ok: false, error: 'Room not found' })
        return
      }
      const color = seatByToken(room, data.token ?? '')
      if (!color) {
        ack?.({ ok: false, error: 'Invalid token' })
        return
      }
      if (room.status !== 'playing') {
        ack?.({ ok: false, error: 'Game is not active' })
        return
      }
      if (room.chess.turn() !== color) {
        ack?.({ ok: false, error: 'Not your turn' })
        return
      }
      let move
      try {
        move = room.chess.move({
          from: data.from ?? '',
          to: data.to ?? '',
          promotion: data.promotion || undefined,
        })
      } catch {
        ack?.({ ok: false, error: 'Illegal move' })
        return
      }
      const st = statusOf(room)
      if (st.over) room.status = 'finished'
      // `by` lets the sender skip its own optimistic move (already applied
      // locally); the other client applies it as the authoritative update.
      io.to(code).emit('game:move', {
        by: socket.id,
        move: { from: move.from, to: move.to, promotion: move.promotion },
        fen: room.chess.fen(),
        san: move.san,
        checkSquare: st.checkSquare,
        over: st.over,
        result: st.result,
      })
      if (st.over && st.result) {
        io.to(code).emit('game:over', { result: st.result })
      }
      ack?.({ ok: true })
      console.log(`Room ${code}: ${color} played ${move.san}`)
    },
  )

  socket.on('game:resign', (data: { code?: string; token?: string }) => {
    const code = (data.code ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return
    const color = seatByToken(room, data.token ?? '')
    if (!color || room.status === 'finished') return
    room.status = 'finished'
    const result = { winner: color === 'w' ? 'b' : 'w', reason: 'resign' }
    io.to(code).emit('game:over', { result })
    console.log(`Room ${code}: ${color} resigned`)
  })

  socket.on('rematch:request', (data: { code?: string; token?: string }) => {
    const code = (data.code ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return
    const color = seatByToken(room, data.token ?? '')
    if (!color) return
    room.rematch[color] = true
    io.to(code).emit('rematch:update', { w: room.rematch.w, b: room.rematch.b })
    if (room.rematch.w && room.rematch.b) resetForRematch(room)
  })

  socket.on('room:leave', (data: { code?: string }) => {
    const code = (data.code ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return
    if (room.white.socketId === socket.id) room.white.online = false
    if (room.black && room.black.socketId === socket.id) room.black.online = false
    socket.leave(code)
    socket.to(code).emit('opponent:left', {})
    console.log(`Room ${code}: player left`)
  })

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`)
    for (const room of rooms.values()) {
      let offlineColor: SeatColor | null = null
      if (room.white.socketId === socket.id) {
        room.white.online = false
        offlineColor = 'w'
      }
      if (room.black && room.black.socketId === socket.id) {
        room.black.online = false
        offlineColor = 'b'
      }
      if (offlineColor) {
        socket.to(room.code).emit('opponent:left', {})
        scheduleRoomCleanup(room, offlineColor)
      }
    }
  })

  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error)
  })
})

httpServer.listen(PORT, () => {
  console.log(`Chess server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
