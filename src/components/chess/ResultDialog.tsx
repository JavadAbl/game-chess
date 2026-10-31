'use client'

import { Copy, Handshake, Home, Loader2, RotateCcw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useChessStore } from '@/lib/chess/store'
import { resultText } from '@/lib/chess/types'
import { sfx } from '@/lib/audio/sfx'
import { toast } from 'sonner'

export default function ResultDialog() {
  const phase = useChessStore((s) => s.phase)
  const result = useChessStore((s) => s.result)
  const mode = useChessStore((s) => s.mode)
  const myColor = useChessStore((s) => s.myColor)
  const rematchMe = useChessStore((s) => s.rematchMe)
  const rematchOpponent = useChessStore((s) => s.rematchOpponent)
  const opponentOnline = useChessStore((s) => s.opponentOnline)
  const newGameSameMode = useChessStore((s) => s.newGameSameMode)
  const goMenu = useChessStore((s) => s.goMenu)

  const open = phase === 'over' && !!result
  const won =
    result?.winner != null &&
    (mode === 'local' || (mode !== 'online' && result.winner === 'w') || (mode === 'online' && result.winner === myColor))

  const copyPgn = async () => {
    const pgn = useChessStore.getState().pgnText
    try {
      await navigator.clipboard.writeText(pgn)
      toast.success('PGN copied to clipboard')
      sfx.click()
    } catch {
      toast.error('Could not copy PGN')
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm border-amber-900/60 bg-[#17120d] text-amber-50 [&>button]:hidden">
        <DialogHeader className="items-center text-center">
          <div
            className={`flex h-14 w-14 items-center justify-center rounded-full ${
              won ? 'bg-amber-500/20' : 'bg-stone-700/30'
            }`}
          >
            <Trophy className={`h-7 w-7 ${won ? 'text-amber-400' : 'text-stone-300'}`} aria-hidden />
          </div>
          <DialogTitle className="text-xl">{result ? resultText(result) : ''}</DialogTitle>
          <DialogDescription className="text-amber-200/60">
            {mode === 'online'
              ? opponentOnline
                ? 'The game has ended.'
                : 'The game has ended. Your opponent left the room.'
              : 'Thanks for playing.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {mode === 'online' ? (
            <Button
              className="w-full bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => useChessStore.getState().requestRematch()}
              disabled={rematchMe}
            >
              {rematchMe && !rematchOpponent ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> Waiting for opponent…
                </>
              ) : rematchOpponent ? (
                <>
                  <Handshake className="mr-1.5 h-4 w-4" aria-hidden /> Accept rematch
                </>
              ) : (
                <>
                  <Handshake className="mr-1.5 h-4 w-4" aria-hidden /> Offer rematch
                </>
              )}
            </Button>
          ) : (
            <Button
              className="w-full bg-amber-500 text-black hover:bg-amber-400"
              onClick={() => {
                sfx.click()
                newGameSameMode()
              }}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden /> Play again
            </Button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
              onClick={copyPgn}
            >
              <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Copy PGN
            </Button>
            <Button
              variant="outline"
              className="border-amber-900/60 text-amber-100 hover:bg-amber-900/40"
              onClick={() => {
                sfx.click()
                goMenu()
              }}
            >
              <Home className="mr-1.5 h-4 w-4" aria-hidden /> Menu
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
