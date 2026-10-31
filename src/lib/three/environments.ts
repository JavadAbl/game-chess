import * as THREE from 'three/webgpu'

/**
 * Random HDRI-style environments for the playing scene.
 *
 * Sources: Poly Haven (polyhaven.com) — CC0 (same license family as
 * ambientCG). The 2K equirectangular .hdr masters are auto-exposed,
 * tonemapped and re-encoded as lossy WebP q85 (~0.2–0.6 MB each, see
 * scripts/prep_envs.py).
 *
 * Delivery model (web-budget friendly):
 * - Environments are NOT loaded in the main menu — only when a match starts.
 * - Each file is downloaded at most once per browser: after the first fetch
 *   it lives in Cache Storage (`gm3d-env-v1`) and later games load it
 *   instantly from disk. Decoded textures are additionally cached per scene
 *   instance, so re-entering a match skips both network and decode.
 * - `loadEquirect` streams the response and reports 0–100 progress for the
 *   pre-match download bar.
 */

export interface EnvOption {
  id: string
  label: string
}

export const ENVIRONMENTS: EnvOption[] = [
  { id: 'kloofendal_48d_partly_cloudy', label: 'Partly Cloudy Day' },
  { id: 'venice_sunset', label: 'Venice Sunset' },
  { id: 'spruit_sunrise', label: 'Misty Sunrise' },
  { id: 'kloppenheim_02', label: 'Blue Hour Dusk' },
  { id: 'brown_photostudio_02', label: 'Photo Studio' },
  { id: 'chinese_garden', label: 'Garden Day' },
]

export function pickRandomEnv(exclude?: string | null): EnvOption {
  const pool = ENVIRONMENTS.filter((e) => e.id !== exclude)
  return pool[Math.floor(Math.random() * pool.length)]
}

const loader = new THREE.TextureLoader()
const CACHE_NAME = 'gm3d-env-v1'

export interface EnvLoadProgress {
  /** 0–100 while downloading; null when the size is unknown (indeterminate) */
  pct: number | null
  /** true when served from Cache Storage instead of the network */
  fromCache: boolean
}

/** Fetches one env file: Cache Storage first, then network with progress. */
async function fetchEnvBlob(
  url: string,
  onProgress?: (p: EnvLoadProgress) => void,
): Promise<Blob> {
  const cacheStore = typeof caches !== 'undefined' ? await caches.open(CACHE_NAME).catch(() => null) : null

  // 1) Cached from a previous session/game — zero network.
  const hit = cacheStore ? await cacheStore.match(url).catch(() => null) : null
  if (hit) {
    onProgress?.({ pct: 100, fromCache: true })
    return await hit.blob()
  }

  // 2) Network download with streaming progress.
  const res = await fetch(url)
  if (!res.ok) throw new Error(`env ${url}: HTTP ${res.status}`)
  const header = res.headers.get('content-length')
  const total = header ? Number.parseInt(header, 10) : NaN

  let blob: Blob
  if (res.body && Number.isFinite(total) && total > 0) {
    const reader = res.body.getReader()
    const parts: BlobPart[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        parts.push(value.slice())
        received += value.byteLength
        onProgress?.({ pct: Math.min(99, Math.round((received / total) * 100)), fromCache: false })
      }
    }
    blob = new Blob(parts, { type: 'image/webp' })
  } else {
    blob = await res.blob()
    onProgress?.({ pct: 100, fromCache: false })
  }

  // 3) Persist so no future session ever re-downloads this file.
  if (cacheStore) {
    await cacheStore
      .put(url, new Response(blob, { headers: { 'Content-Type': 'image/webp' } }))
      .catch(() => {})
  }
  return blob
}

/**
 * Loads one environment as a sharp sRGB equirectangular texture.
 * `onProgress` fires during the (at most once per browser) download and
 * once more with pct 100 when served from cache.
 */
export async function loadEquirect(
  id: string,
  onProgress?: (p: EnvLoadProgress) => void,
): Promise<THREE.Texture> {
  const blob = await fetchEnvBlob(`/env/${id}.webp`, onProgress)
  const objUrl = URL.createObjectURL(blob)
  try {
    const tex = await loader.loadAsync(objUrl)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.mapping = THREE.EquirectangularReflectionMapping
    return tex
  } finally {
    URL.revokeObjectURL(objUrl)
  }
}
