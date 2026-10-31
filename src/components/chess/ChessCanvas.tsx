'use client'

import { useEffect, useRef, useState } from 'react'
import { ChessScene, type EnvStatus } from '@/lib/three/ChessScene'
import { boardSnapshot, movableSquares } from '@/lib/chess/engine'
import { useChessStore } from '@/lib/chess/store'
import type { SquareColor } from '@/lib/chess/types'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Mounts the WebGPU chess scene and keeps it in sync with the game store:
 * - position changes flow through a monotonic `moveSeq` counter
 *   (animated diff when a move detail exists, full resync otherwise)
 * - selection / highlights / orientation are idempotent setters
 * - environments load per match (never in the menu) with a download
 *   progress overlay; files are served from Cache Storage once seen
 */
export default function ChessCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ChessScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [env, setEnv] = useState<EnvStatus | null>(null)

  const moveSeq = useChessStore((s) => s.moveSeq)
  const selected = useChessStore((s) => s.selected)
  const legalTargets = useChessStore((s) => s.legalTargets)
  const checkSquare = useChessStore((s) => s.checkSquare)
  const lastMove = useChessStore((s) => s.lastMove)
  const orientation = useChessStore((s) => s.orientation)
  const gameNonce = useChessStore((s) => s.gameNonce)
  const phase = useChessStore((s) => s.phase)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const scene = new ChessScene(canvas)
    sceneRef.current = scene
    scene.onSquareClick = (sq) => useChessStore.getState().onSquareClick(sq)
    scene.onDeselect = () => useChessStore.getState().deselect()
    scene.onEnvProgress = (status) => {
      // The overlay hides itself once the environment is applied (or fell back).
      setEnv(status.status === 'loading' ? status : null)
      if (status.status === 'failed') {
        toast.error(`Could not load the "${status.label}" arena — using the default backdrop`)
      }
    }
    scene
      .init()
      .then(() => {
        if (disposed) return
        useChessStore.getState().setBackend(scene.backend)
        setReady(true)
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // Position sync — fires on mount (initial position) and after every move.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !ready) return
    const detail = useChessStore.getState().lastMoveDetail
    if (detail && detail.flags !== undefined) scene.applyMove(detail)
    else scene.syncFromBoard(boardSnapshot())
  }, [moveSeq, ready])

  useEffect(() => {
    if (ready) sceneRef.current?.setSelection(selected, legalTargets)
  }, [selected, legalTargets, ready])

  useEffect(() => {
    if (ready) sceneRef.current?.setLastMove(lastMove)
  }, [lastMove, ready])

  useEffect(() => {
    if (ready) sceneRef.current?.setCheckSquare(checkSquare)
  }, [checkSquare, ready])

  // Beginner hints — a soft glow under every piece the local player can
  // legally move (for their side only: the side to move in local duels,
  // White in AI games, myColor online). A plain store subscription keeps
  // this in lockstep with every state change (moves, undos, AI replies,
  // toggles) without effect-dependency churn.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !ready) return
    const sync = () => {
      const st = useChessStore.getState()
      if (!st.beginnerMode || st.phase !== 'playing') {
        scene.setMovableHints([])
        return
      }
      let mine: SquareColor | null = null
      if (st.mode === 'local') mine = st.turn
      else if (st.mode === 'ai') mine = st.turn === 'w' && !st.aiThinking ? 'w' : null
      else if (st.myColor && st.turn === st.myColor) mine = st.myColor
      scene.setMovableHints(mine ? movableSquares(mine) : [])
    }
    sync()
    return useChessStore.subscribe(sync)
  }, [ready])

  useEffect(() => {
    if (ready) sceneRef.current?.setOrientation(orientation)
  }, [orientation, ready])

  // Environments are a match-time concern: every game start (mode start,
  // New game, rematch, rejoin) rolls a fresh one; the menu drops the backdrop
  // again. Cached environments apply instantly on later starts.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !ready) return
    if (phase === 'menu') scene.clearEnvironment()
    else if (gameNonce > 0) scene.randomizeEnvironment()
  }, [phase, gameNonce, ready])

  return (
    <div className="relative h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" aria-label="3D chess board" />
      {!ready && !failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0b09]">
          <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
          <p className="text-sm text-amber-200/70">Initializing GPU renderer…</p>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0d0b09] px-6 text-center">
          <p className="text-lg font-medium text-amber-200">Could not start the 3D renderer</p>
          <p className="text-sm text-amber-100/60">
            Your browser may not support WebGPU or WebGL2. Try the latest Chrome, Edge, or Firefox.
          </p>
        </div>
      )}
      {ready && env?.status === 'loading' && phase !== 'menu' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0b09]">
          <p className="text-sm text-amber-100">
            Preparing arena — <span className="text-amber-300">{env.label}</span>
          </p>
          <div
            className="h-1.5 w-60 overflow-hidden rounded-full bg-amber-950"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={env.pct ?? undefined}
            aria-label={`Downloading ${env.label} environment`}
          >
            {env.pct == null ? (
              <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-amber-500 to-amber-300" />
            ) : (
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-150"
                style={{ width: `${env.pct}%` }}
              />
            )}
          </div>
          <p className="text-xs tabular-nums text-amber-200/50">
            {env.pct == null ? 'loading…' : `${env.pct}%`}
            {env.fromCache && env.pct === 100 ? ' · cache' : ''}
          </p>
        </div>
      )}
    </div>
  )
}
