import { io, type Socket } from 'socket.io-client'

/**
 * Singleton Socket.IO client for the chess mini-service.
 * The gateway (Caddy) forwards `/?XTransformPort=3003` to the service port —
 * never put a raw port in the URL.
 */
let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
  }
  return socket
}

export interface CreateRoomAck {
  ok: boolean
  code?: string
  token?: string
  color?: 'w' | 'b'
  error?: string
}

export interface JoinRoomAck {
  ok: boolean
  token?: string
  color?: 'w' | 'b'
  error?: string
}

export interface RejoinAck {
  ok: boolean
  color?: 'w' | 'b'
  fen?: string
  sans?: string[]
  status?: 'waiting' | 'playing' | 'finished'
  result?: { winner: 'w' | 'b' | null; reason: string } | null
  opponentOnline?: boolean
  error?: string
}

export interface MoveAck {
  ok: boolean
  error?: string
}

export interface ServerMovePayload {
  move: { from: string; to: string; promotion?: string }
  fen: string
  san: string
  checkSquare: string | null
  over: boolean
  result: { winner: 'w' | 'b' | null; reason: string } | null
}

export interface GameOverPayload {
  result: { winner: 'w' | 'b' | null; reason: string }
}

export interface RematchPayload {
  w: boolean
  b: boolean
}
