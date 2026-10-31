'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useChessStore } from '@/lib/chess/store'
import type { PieceType } from '@/lib/chess/types'

const CHOICES: { piece: PieceType; white: string; black: string; label: string }[] = [
  { piece: 'q', white: '♕', black: '♛', label: 'Queen' },
  { piece: 'r', white: '♖', black: '♜', label: 'Rook' },
  { piece: 'b', white: '♗', black: '♝', label: 'Bishop' },
  { piece: 'n', white: '♘', black: '♞', label: 'Knight' },
]

export default function PromotionDialog() {
  const pending = useChessStore((s) => s.pendingPromotion)
  const turn = useChessStore((s) => s.turn)
  const choosePromotion = useChessStore((s) => s.choosePromotion)
  const cancelPromotion = useChessStore((s) => s.cancelPromotion)

  return (
    <Dialog open={!!pending} onOpenChange={(open) => !open && cancelPromotion()}>
      <DialogContent className="max-w-sm border-amber-900/60 bg-[#17120d] text-amber-50 [&>button]:text-amber-200/60">
        <DialogHeader>
          <DialogTitle>Promote your pawn</DialogTitle>
          <DialogDescription className="text-amber-200/60">Choose the new piece.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2">
          {CHOICES.map(({ piece, white, black, label }) => (
            <button
              key={piece}
              type="button"
              aria-label={`Promote to ${label}`}
              onClick={() => choosePromotion(piece)}
              className="flex aspect-square flex-col items-center justify-center rounded-lg border border-amber-900/50 bg-black/30 text-4xl transition-colors hover:border-amber-400 hover:bg-amber-500/15"
            >
              <span className={turn === 'w' ? 'text-amber-100' : 'text-stone-300'}>
                {turn === 'w' ? white : black}
              </span>
              <span className="mt-1 text-[10px] uppercase tracking-wider text-amber-200/50">{label}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
