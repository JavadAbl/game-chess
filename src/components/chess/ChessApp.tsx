'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { ArrowLeft, Bot, Globe, Loader2, Users, Volume2, VolumeX, Zap, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import ModeSelect from '@/components/chess/ModeSelect'
import GameHUD from '@/components/chess/GameHUD'
import PromotionDialog from '@/components/chess/PromotionDialog'
import ResultDialog from '@/components/chess/ResultDialog'
import { useChessStore } from '@/lib/chess/store'
import { bindOnlineEvents } from '@/lib/net/online'
import { unlockAudio } from '@/lib/audio/sfx'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'

const ChessCanvas = dynamic(() => import('@/components/chess/ChessCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#0d0b09]">
      <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
    </div>
  ),
})

export default function ChessApp() {
  const phase = useChessStore((s) => s.phase)
  const mode = useChessStore((s) => s.mode)
  const backend = useChessStore((s) => s.backend)
  const soundOn = useChessStore((s) => s.soundOn)
  const roomCode = useChessStore((s) => s.roomCode)

  useEffect(() => {
    bindOnlineEvents()
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    return () => window.removeEventListener('pointerdown', unlock)
  }, [])

  useEffect(() => {
    // Detect WebGPU availability for the menu badge (client only).
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      navigator.gpu
        .requestAdapter()
        .then((adapter) => useChessStore.getState().setGpuSupported(!!adapter))
        .catch(() => useChessStore.getState().setGpuSupported(false))
    } else {
      useChessStore.getState().setGpuSupported(false)
    }
  }, [])

  const copyRoom = async () => {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
      toast.success('Room code copied')
    } catch {
      toast.error('Could not copy the code')
    }
  }

  return (
    <main className="fixed inset-0 flex flex-col bg-[#0d0b09] text-amber-50">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-amber-900/40 bg-[#14100c] px-3 sm:px-4">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-amber-100 hover:bg-amber-900/40 hover:text-amber-50"
          onClick={() => useChessStore.getState().goMenu()}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Menu</span>
        </Button>
        {phase !== 'menu' && (
          <Badge variant="outline" className="gap-1.5 border-amber-900/60 text-amber-200/80">
            {mode === 'ai' ? (
              <>
                <Bot className="h-3.5 w-3.5" aria-hidden /> vs AI
              </>
            ) : mode === 'local' ? (
              <>
                <Users className="h-3.5 w-3.5" aria-hidden /> Local
              </>
            ) : (
              <>
                <Globe className="h-3.5 w-3.5" aria-hidden /> Online
              </>
            )}
          </Badge>
        )}
        {mode === 'online' && roomCode && (
          <button
            type="button"
            onClick={copyRoom}
            className="flex items-center gap-1.5 rounded-md border border-amber-900/60 px-2 py-0.5 font-mono text-sm tracking-[0.2em] text-amber-300 transition-colors hover:bg-amber-900/30"
            aria-label={`Room code ${roomCode}, click to copy`}
          >
            {roomCode}
            <Copy className="h-3.5 w-3.5 opacity-60" aria-hidden />
          </button>
        )}
        <div className="flex-1" />
        <Badge variant="outline" className="hidden gap-1 border-amber-900/60 text-amber-200/70 sm:flex">
          <Zap className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          {backend === 'webgpu' ? 'WebGPU' : backend === 'webgl2' ? 'WebGL2' : 'GPU…'}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="text-amber-100 hover:bg-amber-900/40"
          onClick={() => useChessStore.getState().toggleSound()}
          aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}
        >
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
      </header>

      {/* Board + HUD */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[44vh] flex-1">
          <ChessCanvas />
          {phase === 'menu' && <ModeSelect />}
        </div>
        {phase !== 'menu' && <GameHUD />}
      </div>

      <PromotionDialog />
      <ResultDialog />
      <Toaster position="top-center" richColors theme="dark" />
    </main>
  )
}
