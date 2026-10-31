'use client'

import { useEffect, useRef } from 'react'
import {
  RotateCcw,
  Undo2,
  SwitchCamera,
  Volume2,
  VolumeX,
  Flag,
  Copy,
  Trophy,
  Loader2,
  Handshake,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChessStore } from '@/lib/chess/store'
import { resultText } from '@/lib/chess/types'
import type { PieceType } from '@/lib/chess/types'
import { sfx } from '@/lib/audio/sfx'
import { toast } from 'sonner'

const GLYPHS_BLACK: Record<PieceType, string> = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
const GLYPHS_WHITE: Record<PieceType, string> = { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' }
const VALUE: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

function materialScore(captured: PieceType[]): number {
  return captured.reduce((sum, p) => sum + VALUE[p], 0)
}

function CapturedTray({ pieces, asWhite }: { pieces: PieceType[]; asWhite: boolean }) {
  const sorted = [...pieces].sort((a, b) => VALUE[b] - VALUE[a])
  return (
    <div className="flex min-h-5 flex-1 flex-wrap items-center text-lg leading-none" aria-label="captured pieces">
      {sorted.map((p, i) => (
        <span key={`${p}-${i}`} className={asWhite ? 'text-stone-300' : 'text-amber-200/90'}>
          {asWhite ? GLYPHS_BLACK[p] : GLYPHS_WHITE[p]}
        </span>
      ))}
    </div>
  )
}

function PlayerStrip({
  label,
  color,
  captured,
  advantage,
  active,
  thinking,
  offline,
}: {
  label: string
  color: 'w' | 'b'
  captured: PieceType[]
  advantage: number
  active: boolean
  thinking?: boolean
  offline?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
        active ? 'border-amber-400/70 bg-amber-500/10' : 'border-amber-900/40 bg-black/20'
      }`}
    >
      <span
        className={`h-3 w-3 shrink-0 rounded-full border ${
          color === 'w' ? 'border-stone-400 bg-stone-200' : 'border-stone-600 bg-stone-900'
        }`}
        aria-hidden
      />
      <span className="text-sm font-medium text-amber-100">
        {label}
        {offline && <span className="ml-1.5 text-xs text-red-400/80">offline</span>}
      </span>
      {thinking && <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" aria-label="thinking" />}
      <CapturedTray pieces={captured} asWhite={color === 'w'} />
      {advantage > 0 && <span className="text-xs font-semibold text-emerald-400">+{advantage}</span>}
      {active && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400" aria-hidden />}
    </div>
  )
}

export default function GameHUD() {
  const mode = useChessStore((s) => s.mode)
  const phase = useChessStore((s) => s.phase)
  const turn = useChessStore((s) => s.turn)
  const history = useChessStore((s) => s.history)
  const capturedByWhite = useChessStore((s) => s.capturedByWhite)
  const capturedByBlack = useChessStore((s) => s.capturedByBlack)
  const checkSquare = useChessStore((s) => s.checkSquare)
  const result = useChessStore((s) => s.result)
  const aiThinking = useChessStore((s) => s.aiThinking)
  const aiLevel = useChessStore((s) => s.aiLevel)
  const soundOn = useChessStore((s) => s.soundOn)
  const myColor = useChessStore((s) => s.myColor)
  const opponentOnline = useChessStore((s) => s.opponentOnline)
  const rematchMe = useChessStore((s) => s.rematchMe)
  const rematchOpponent = useChessStore((s) => s.rematchOpponent)

  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [history.length])

  const diff = materialScore(capturedByWhite) - materialScore(capturedByBlack)

  const whiteLabel =
    mode === 'ai' ? 'You' : mode === 'online' ? (myColor === 'w' ? 'You' : 'Opponent') : 'White'
  const blackLabel =
    mode === 'ai' ? `AI · L${aiLevel}` : mode === 'online' ? (myColor === 'b' ? 'You' : 'Opponent') : 'Black'

  const copyPgn = async () => {
    const pgnText = useChessStore.getState().pgnText || useChessStore.getState().history.map((m) => m.san).join(' ')
    if (!pgnText) {
      toast.error('No moves to export yet')
      return
    }
    try {
      await navigator.clipboard.writeText(pgnText)
      toast.success('PGN copied to clipboard')
      sfx.click()
    } catch {
      toast.error('Could not copy PGN')
    }
  }

  const moveRows: { no: number; w?: string; b?: string }[] = []
  for (let i = 0; i < history.length; i += 2) {
    moveRows.push({ no: i / 2 + 1, w: history[i]?.san, b: history[i + 1]?.san })
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-amber-900/40 bg-[#14100c] p-3 lg:w-80 lg:border-l lg:border-t-0 lg:p-4">
      {/* Players */}
      <div className="space-y-2">
        <PlayerStrip
          label={blackLabel}
          color="b"
          captured={capturedByWhite}
          advantage={diff > 0 ? diff : 0}
          active={turn === 'b' && phase !== 'over'}
          thinking={mode === 'ai' && aiThinking}
          offline={mode === 'online' && !opponentOnline && myColor === 'w'}
        />
        <PlayerStrip
          label={whiteLabel}
          color="w"
          captured={capturedByBlack}
          advantage={diff < 0 ? -diff : 0}
          active={turn === 'w' && phase !== 'over'}
          offline={mode === 'online' && !opponentOnline && myColor === 'b'}
        />
      </div>

      {/* Status */}
      <div className="rounded-lg border border-amber-900/40 bg-black/20 px-3 py-2 text-sm">
        {phase === 'over' && result ? (
          <span className="flex items-center gap-2 font-medium text-amber-200">
            <Trophy className="h-4 w-4 text-amber-400" aria-hidden />
            {resultText(result)}
          </span>
        ) : aiThinking ? (
          <span className="flex items-center gap-2 text-amber-200/80">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" aria-hidden />
            AI is thinking…
          </span>
        ) : (
          <span className="text-amber-200/80">
            {turn === 'w' ? 'White' : 'Black'} to move
            {checkSquare && <span className="ml-2 font-semibold text-red-400">Check!</span>}
          </span>
        )}
      </div>

      {/* Move list */}
      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-amber-900/40 bg-black/20">
        <div className="border-b border-amber-900/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-200/50">
          Moves
        </div>
        <div ref={listRef} className="scroll-slim max-h-40 min-h-16 flex-1 overflow-y-auto px-1 py-1 lg:max-h-none">
          {moveRows.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-amber-200/40">No moves yet</p>
          ) : (
            moveRows.map((row) => (
              <div key={row.no} className="grid grid-cols-[2.5rem_1fr_1fr] gap-1 rounded px-2 py-0.5 text-sm hover:bg-amber-500/5">
                <span className="text-amber-200/40">{row.no}.</span>
                <span className="font-medium text-amber-100">{row.w}</span>
                <span className="font-medium text-amber-100/80">{row.b ?? ''}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-2">
        {mode !== 'online' && (
          <Button
            variant="outline"
            size="sm"
            className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
            onClick={() => useChessStore.getState().undo()}
            disabled={aiThinking || history.length === 0}
          >
            <Undo2 className="mr-1 h-4 w-4" aria-hidden /> Undo
          </Button>
        )}
        {mode !== 'online' && (
          <Button
            variant="outline"
            size="sm"
            className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
            onClick={() => useChessStore.getState().newGameSameMode()}
          >
            <RotateCcw className="mr-1 h-4 w-4" aria-hidden /> New
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
          onClick={() => {
            sfx.click()
            useChessStore.getState().flipOrientation()
          }}
        >
          <SwitchCamera className="mr-1 h-4 w-4" aria-hidden /> Flip
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
          onClick={() => useChessStore.getState().toggleSound()}
          aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
        >
          {soundOn ? <Volume2 className="mr-1 h-4 w-4" aria-hidden /> : <VolumeX className="mr-1 h-4 w-4" aria-hidden />}
          {soundOn ? 'Sound' : 'Muted'}
        </Button>
        {mode === 'online' ? (
          <>
            <Button
              variant="outline"
              size="sm"
              className="border-red-900/60 text-red-300 hover:bg-red-950/40"
              onClick={() => useChessStore.getState().resignOnline()}
              disabled={phase === 'over'}
            >
              <Flag className="mr-1 h-4 w-4" aria-hidden /> Resign
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
              onClick={() => useChessStore.getState().requestRematch()}
              disabled={rematchMe || (phase !== 'over' && history.length === 0)}
            >
              <Handshake className="mr-1 h-4 w-4" aria-hidden />
              {rematchMe ? 'Requested' : rematchOpponent ? 'Accept!' : 'Rematch'}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="col-span-2 border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
            onClick={copyPgn}
          >
            <Copy className="mr-1 h-4 w-4" aria-hidden /> Copy PGN
          </Button>
        )}
      </div>
    </aside>
  )
}
