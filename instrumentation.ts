/**
 * Next.js instrumentation — runs once when the server process boots.
 *
 * Dev/preview convenience: automatically boot the online chess mini-service
 * (Socket.IO, port 3003) as a child of this server so `next dev` gives you a
 * fully working multiplayer setup with zero extra terminals. In production
 * (NODE_ENV=production) this is a no-op — run the service under your own
 * supervisor and front both with your gateway/proxy (see README.md).
 *
 * Opt out with NEXT_SPAWN_SERVICES=0 (e.g. when the service is already
 * running elsewhere).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NODE_ENV === 'production') return
  if (process.env.NEXT_SPAWN_SERVICES === '0') return

  const fs = await import('node:fs')
  const path = await import('node:path')
  const servicePath = path.join(process.cwd(), 'mini-services', 'chess-server', 'index.ts')
  if (!fs.existsSync(servicePath)) return

  const { spawn } = await import('node:child_process')
  const runner = fs.existsSync(path.join(process.cwd(), 'bun.lock')) ? 'bun' : 'tsx'
  // detached + unref: the service outlives this hook; crashes are logged by
  // the platform. If port 3003 is taken the child exits silently — the
  // already-running instance keeps serving, which is exactly what we want.
  const child = spawn(runner, [servicePath], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  })
  child.unref()
  console.log(`[instrumentation] booted chess mini-service via ${runner} (pid ${child.pid})`)
}
