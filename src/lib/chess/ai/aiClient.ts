import type { SearchParams, SearchResult } from './search'

/**
 * Spawns the AI worker once and routes search requests to it. If worker
 * construction fails (e.g. exotic embedding), falls back to running the
 * search on the main thread after a paint-friendly delay.
 */

interface PendingEntry {
  resolve: (result: SearchResult | null) => void
}

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, PendingEntry>()

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null
  try {
    const w = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; result?: SearchResult }>) => {
      const entry = pending.get(e.data.id)
      if (entry) {
        pending.delete(e.data.id)
        entry.resolve(e.data.result ?? null)
      }
    }
    w.onerror = () => {
      // Worker failed hard — reject everything so callers can degrade.
      const entries = [...pending.values()]
      pending.clear()
      entries.forEach((en) => en.resolve(null))
    }
    worker = w
    return w
  } catch {
    return null
  }
}

export function requestAIMove(
  params: SearchParams,
  resolve: (result: SearchResult | null) => void,
): void {
  const w = ensureWorker()
  if (w) {
    const id = ++seq
    pending.set(id, { resolve })
    w.postMessage({ id, params })
    return
  }
  // Main-thread fallback.
  void import('./search').then(({ findBestMove }) => {
    setTimeout(() => {
      try {
        resolve(findBestMove(params))
      } catch {
        resolve(null)
      }
    }, 60)
  })
}

/** Resolve every outstanding request with null (used when leaving a game). */
export function cancelPendingAIMoves(): void {
  const entries = [...pending.values()]
  pending.clear()
  entries.forEach((en) => en.resolve(null))
}
