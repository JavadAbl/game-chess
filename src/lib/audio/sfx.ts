/**
 * Procedural WebAudio sound effects — zero asset files.
 * The AudioContext is created lazily on the first user gesture.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = false

function ensureCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 0.5
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
    return ctx
  } catch {
    return null
  }
}

export function unlockAudio(): void {
  ensureCtx()
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(m: boolean): void {
  muted = m
  if (master && ctx) {
    master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.01)
  }
}

interface ToneOpts {
  type?: OscillatorType
  dur?: number
  gain?: number
  delay?: number
  slideTo?: number
}

function tone(freq: number, opts: ToneOpts = {}): void {
  const c = ensureCtx()
  if (!c || !master || muted) return
  try {
    const { type = 'sine', dur = 0.1, gain = 0.2, delay = 0, slideTo } = opts
    const t0 = c.currentTime + delay
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(slideTo, 1), t0 + dur)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g)
    g.connect(master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  } catch {
    /* audio best-effort */
  }
}

interface NoiseOpts {
  dur?: number
  gain?: number
  freq?: number
  q?: number
  delay?: number
}

function noise(opts: NoiseOpts = {}): void {
  const c = ensureCtx()
  if (!c || !master || muted) return
  try {
    const { dur = 0.05, gain = 0.25, freq = 2000, q = 1.2, delay = 0 } = opts
    const t0 = c.currentTime + delay
    const frames = Math.max(1, Math.floor(c.sampleRate * dur))
    const buffer = c.createBuffer(1, frames, c.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1
    const src = c.createBufferSource()
    src.buffer = buffer
    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = freq
    filter.Q.value = q
    const g = c.createGain()
    g.gain.setValueAtTime(gain, t0)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter)
    filter.connect(g)
    g.connect(master)
    src.start(t0)
  } catch {
    /* audio best-effort */
  }
}

export const sfx = {
  /** Soft wood tap for a quiet move. */
  move() {
    noise({ dur: 0.045, gain: 0.28, freq: 2300 })
    tone(190, { dur: 0.07, gain: 0.3, slideTo: 120 })
  },
  /** Heavier thock for captures. */
  capture() {
    noise({ dur: 0.08, gain: 0.4, freq: 900, q: 0.8 })
    tone(130, { dur: 0.13, gain: 0.42, slideTo: 68 })
  },
  /** Two quick taps for castling. */
  castle() {
    noise({ dur: 0.04, gain: 0.25, freq: 2200 })
    tone(200, { dur: 0.06, gain: 0.26, slideTo: 130 })
    noise({ dur: 0.045, gain: 0.28, freq: 2000, delay: 0.11 })
    tone(175, { dur: 0.07, gain: 0.3, slideTo: 115, delay: 0.11 })
  },
  /** Alert when a king lands in check. */
  check() {
    tone(880, { type: 'square', dur: 0.09, gain: 0.1 })
    tone(660, { type: 'square', dur: 0.11, gain: 0.1, delay: 0.12 })
  },
  /** Bright arpeggio for promotion. */
  promote() {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone(f, { type: 'triangle', dur: 0.12, gain: 0.13, delay: i * 0.085 }),
    )
  },
  /** Settling chord at game end. */
  gameEnd() {
    ;[261.63, 329.63, 392.0, 523.25].forEach((f, i) =>
      tone(f, { type: 'sine', dur: 0.65, gain: 0.1, delay: i * 0.045 }),
    )
  },
  /** Low buzz for an illegal action. */
  illegal() {
    tone(110, { type: 'sawtooth', dur: 0.12, gain: 0.12 })
  },
  /** Tiny tick for UI buttons. */
  click() {
    tone(700, { type: 'triangle', dur: 0.03, gain: 0.07 })
  },
}
