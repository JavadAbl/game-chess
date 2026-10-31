'use client'

import { useEffect, useRef, useState } from 'react'
import { ChessScene } from '@/lib/three/ChessScene'
import { boardSnapshot } from '@/lib/chess/engine'
import { useChessStore } from '@/lib/chess/store'
import { Loader2 } from 'lucide-react'

/**
 * Mounts the WebGPU chess scene and keeps it in sync with the game store:
 * - position changes flow through a monotonic `moveSeq` counter
 *   (animated diff when a move detail exists, full resync otherwise)
 * - selection / highlights / orientation are idempotent setters
 */
export default function ChessCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<ChessScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  const moveSeq = useChessStore((s) => s.moveSeq)
  const selected = useChessStore((s) => s.selected)
  const legalTargets = useChessStore((s) => s.legalTargets)
  const checkSquare = useChessStore((s) => s.checkSquare)
  const lastMove = useChessStore((s) => s.lastMove)
  const orientation = useChessStore((s) => s.orientation)
  const gameNonce = useChessStore((s) => s.gameNonce)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    const scene = new ChessScene(canvas)
    sceneRef.current = scene
    scene.onSquareClick = (sq) => useChessStore.getState().onSquareClick(sq)
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

  useEffect(() => {
    if (ready) sceneRef.current?.setOrientation(orientation)
  }, [orientation, ready])

  // Every game start (mode start, New game, rematch, rejoin) rolls a fresh environment
  useEffect(() => {
    if (ready && gameNonce > 0) sceneRef.current?.randomizeEnvironment()
  }, [gameNonce, ready])

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
    </div>
  )
}
