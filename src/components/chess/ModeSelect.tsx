'use client'

import { useState } from 'react'
import { Bot, Globe, Users, Copy, Loader2, Crown, Dices, GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useChessStore } from '@/lib/chess/store'
import type { AILevel } from '@/lib/chess/types'
import { sfx } from '@/lib/audio/sfx'
import { toast } from 'sonner'

const LEVELS: { level: AILevel; label: string; hint: string }[] = [
  { level: 1, label: 'Easy', hint: 'Sees one move ahead' },
  { level: 2, label: 'Medium', hint: 'Punishes loose pieces' },
  { level: 3, label: 'Hard', hint: 'Tactical, looks for combos' },
  { level: 4, label: 'Expert', hint: 'Deep search — bring your best' },
]

export default function ModeSelect() {
  const startAI = useChessStore((s) => s.startAI)
  const startLocal = useChessStore((s) => s.startLocal)
  const createOnlineRoom = useChessStore((s) => s.createOnlineRoom)
  const joinOnlineRoom = useChessStore((s) => s.joinOnlineRoom)
  const aiLevel = useChessStore((s) => s.aiLevel)
  const roomCode = useChessStore((s) => s.roomCode)
  const onlineStatus = useChessStore((s) => s.onlineStatus)
  const gpuSupported = useChessStore((s) => s.gpuSupported)
  const beginnerMode = useChessStore((s) => s.beginnerMode)

  const [joinCode, setJoinCode] = useState('')

  const copyCode = async () => {
    if (!roomCode) return
    try {
      await navigator.clipboard.writeText(roomCode)
      toast.success('Room code copied')
      sfx.click()
    } catch {
      toast.error('Could not copy the code')
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center overflow-y-auto bg-[#0d0b09]/70 p-4 backdrop-blur-sm sm:items-center">
      <Card className="w-full max-w-md border-amber-900/60 bg-[#17120d]/95 shadow-2xl shadow-black/60">
        <CardHeader className="pb-3 text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-2xl font-bold tracking-wide text-amber-100">
            <Crown className="h-6 w-6 text-amber-400" aria-hidden />
            GM-3D CHESS
          </CardTitle>
          <CardDescription className="text-amber-200/60">
            3D chess in your browser — AI · Local · Online
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="ai">
            <TabsList className="mb-4 grid w-full grid-cols-3 bg-black/40">
              <TabsTrigger value="ai" className="gap-1.5 data-[state=active]:bg-amber-500/20">
                <Bot className="h-4 w-4" aria-hidden /> AI
              </TabsTrigger>
              <TabsTrigger value="local" className="gap-1.5 data-[state=active]:bg-amber-500/20">
                <Users className="h-4 w-4" aria-hidden /> Local
              </TabsTrigger>
              <TabsTrigger value="online" className="gap-1.5 data-[state=active]:bg-amber-500/20">
                <Globe className="h-4 w-4" aria-hidden /> Online
              </TabsTrigger>
            </TabsList>

            <TabsContent value="ai" className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {LEVELS.map(({ level, label, hint }) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => {
                      useChessStore.getState().setAiLevel(level)
                      sfx.click()
                    }}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      aiLevel === level
                        ? 'border-amber-400 bg-amber-500/15'
                        : 'border-amber-900/50 bg-black/20 hover:border-amber-700'
                    }`}
                  >
                    <div className="text-sm font-semibold text-amber-100">{label}</div>
                    <div className="mt-0.5 text-xs text-amber-200/50">{hint}</div>
                  </button>
                ))}
              </div>
              <Button
                className="w-full bg-amber-500 text-black hover:bg-amber-400"
                onClick={() => {
                  sfx.click()
                  startAI(aiLevel)
                }}
              >
                <Bot className="mr-1.5 h-4 w-4" aria-hidden /> Play as White vs AI
              </Button>
            </TabsContent>

            <TabsContent value="local" className="space-y-4">
              <p className="text-sm text-amber-200/70">
                Two players, one screen. White moves first — pass the device after each move, or
                spin the camera freely.
              </p>
              <Button
                className="w-full bg-amber-500 text-black hover:bg-amber-400"
                onClick={() => {
                  sfx.click()
                  startLocal()
                }}
              >
                <Users className="mr-1.5 h-4 w-4" aria-hidden /> Start local duel
              </Button>
            </TabsContent>

            <TabsContent value="online" className="space-y-4">
              {onlineStatus === 'waiting' && roomCode ? (
                <div className="space-y-3 text-center">
                  <p className="text-sm text-amber-200/70">Share this room code with your friend:</p>
                  <div className="flex items-center justify-center gap-2">
                    <span className="font-mono text-3xl font-bold tracking-[0.3em] text-amber-300">
                      {roomCode}
                    </span>
                    <Button variant="ghost" size="icon" onClick={copyCode} aria-label="Copy room code">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-center gap-2 text-sm text-amber-200/60">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Waiting for an opponent to join…
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    className="w-full bg-amber-500 text-black hover:bg-amber-400"
                    onClick={() => {
                      sfx.click()
                      createOnlineRoom()
                    }}
                  >
                    <Dices className="mr-1.5 h-4 w-4" aria-hidden /> Create a game
                  </Button>
                  <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-amber-900/50" />
                    <span className="text-xs uppercase tracking-wider text-amber-200/40">or join</span>
                    <div className="h-px flex-1 bg-amber-900/50" />
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 5))}
                      placeholder="ROOM CODE"
                      className="border-amber-900/60 bg-black/30 font-mono tracking-[0.2em] text-amber-100 placeholder:text-amber-200/30"
                      aria-label="Room code"
                    />
                    <Button
                      variant="outline"
                      className="border-amber-700 text-amber-200 hover:bg-amber-900/40"
                      onClick={() => {
                        if (joinCode.trim().length < 4) {
                          toast.error('Enter the 5-character room code')
                          return
                        }
                        sfx.click()
                        joinOnlineRoom(joinCode)
                      }}
                    >
                      Join
                    </Button>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          {/* Beginner hints pre-game toggle — same flag as the in-match HUD button */}
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-amber-900/50 bg-black/20 px-3 py-2">
            <span className="text-left">
              <span className="flex items-center gap-1.5 text-sm font-medium text-amber-100">
                <GraduationCap className="h-4 w-4 text-amber-400" aria-hidden />
                Beginner hints
              </span>
              <span className="text-xs text-amber-200/50">
                Glow every piece you can move; dots and rings show destinations
              </span>
            </span>
            <Switch
              checked={beginnerMode}
              onCheckedChange={() => useChessStore.getState().toggleBeginner()}
              aria-label="Toggle beginner hints"
            />
          </label>

          <p className="mt-4 text-center text-xs text-amber-200/40">
            {gpuSupported === null
              ? 'Checking GPU support…'
              : gpuSupported
                ? 'WebGPU available — hardware-accelerated rendering'
                : 'WebGPU unavailable — falling back to WebGL2'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
