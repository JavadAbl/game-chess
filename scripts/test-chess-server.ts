/**
 * Integration test for the chess-server mini-service:
 * two clients create/join a room, play a short game (Fool's mate),
 * test resign + rematch flows. Run: bun scripts/test-chess-server.ts
 */
import { io, type Socket } from 'socket.io-client'

const URL = 'http://localhost:3003'
const results: string[] = []
function check(name: string, cond: boolean) {
  results.push(`${cond ? 'PASS' : 'FAIL'} — ${name}`)
  if (!cond) process.exitCode = 1
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, timeout: 5000 })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
    setTimeout(() => reject(new Error('timeout')), 6000)
  })
}

function emitAck<T>(s: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000)
    s.emit(event, payload, (ack: T) => {
      clearTimeout(timer)
      resolve(ack)
    })
  })
}

// Global watchdog — never hang the CI shell
setTimeout(() => {
  console.error('WATCHDOG: test exceeded 20s')
  console.log(results.join('\n'))
  process.exit(1)
}, 20000)

interface MovePayload {
  move: { from: string; to: string }
  fen: string
  san: string
}

async function main() {
  const [alice, bob] = await Promise.all([connect(), connect()])
  check('two clients connected', alice.connected && bob.connected)

  let lastMove: MovePayload | null = null
  bob.on('game:move', (p: MovePayload) => (lastMove = p))

  const createAck = await emitAck<{ ok: boolean; code?: string; token?: string }>(alice, 'room:create', {})
  check('room created', createAck.ok && !!createAck.code && !!createAck.token)
  const code = createAck.code!

  const joinAck = await emitAck<{ ok: boolean; token?: string; color?: string }>(bob, 'room:join', { code })
  check('bob joined as black', joinAck.ok && joinAck.color === 'b')

  // wait for game:start broadcast to alice
  await new Promise((r) => setTimeout(r, 300))

  // Illegal move attempt: g1→e5 is not a legal knight move from the start position
  const illegal = await emitAck<{ ok: boolean; error?: string }>(alice, 'game:move', {
    code, token: createAck.token, from: 'g1', to: 'e5',
  })
  check('illegal move rejected', !illegal.ok)

  // Play Fool's mate: f3 e5 g4 Qh4#
  const moves: [Socket, string, string][] = [
    [alice, 'f2', 'f3'],
    [bob, 'e7', 'e5'],
    [alice, 'g2', 'g4'],
    [bob, 'd8', 'h4'],
  ]
  let over = false
  alice.on('game:over', () => (over = true))
  for (const [s, from, to] of moves) {
    const ack = await emitAck<{ ok: boolean; error?: string }>(s, 'game:move', {
      code, token: s === alice ? createAck.token : joinAck.token, from, to,
    })
    if (!ack.ok) console.log('move error:', ack.error)
    await new Promise((r) => setTimeout(r, 120))
  }
  await new Promise((r) => setTimeout(r, 300))
  check('checkmate broadcast with game:over', over === true)
  check('bob received last move (Qh4#)', lastMove !== null && lastMove.san === 'Qh4#')

  // Rematch: both request → game:start
  let rematchStarted = false
  alice.on('game:start', () => (rematchStarted = true))
  alice.emit('rematch:request', { code, token: createAck.token })
  await new Promise((r) => setTimeout(r, 150))
  bob.emit('rematch:request', { code, token: joinAck.token })
  await new Promise((r) => setTimeout(r, 300))
  check('rematch starts when both agree', rematchStarted)

  // Resign flow after rematch
  let resignOver: { result?: { winner?: string; reason?: string } } | null = null
  bob.on('game:over', (p: { result?: { winner?: string; reason?: string } }) => (resignOver = p))
  alice.emit('game:resign', { code, token: createAck.token })
  await new Promise((r) => setTimeout(r, 300))
  check('resign notifies opponent (black wins)', resignOver?.result?.winner === 'b' && resignOver?.result?.reason === 'resign')

  // Rejoin: bob re-requests with his token
  const rejoinAck = await emitAck<{ ok: boolean; color?: string; sans?: string[] }>(bob, 'room:rejoin', {
    code, token: joinAck.token,
  })
  check('rejoin with token works', rejoinAck.ok && rejoinAck.color === 'b')

  alice.disconnect()
  bob.disconnect()
  console.log(results.join('\n'))
  process.exit(process.exitCode ?? 0)
}

main().catch((e) => {
  console.error('Test crashed:', e)
  process.exit(1)
})
