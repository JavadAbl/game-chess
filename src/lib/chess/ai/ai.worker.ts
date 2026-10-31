/// <reference lib="webworker" />
import { findBestMove, type SearchParams, type SearchResult } from './search'

interface WorkerRequest {
  id: number
  params: SearchParams
}

interface WorkerResponse {
  id: number
  result?: SearchResult
  error?: string
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data
  try {
    const result = findBestMove(params)
    const res: WorkerResponse = { id, result: result ?? undefined }
    ctx.postMessage(res)
  } catch (err) {
    const res: WorkerResponse = { id, error: String(err) }
    ctx.postMessage(res)
  }
}
