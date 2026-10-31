import * as THREE from 'three/webgpu'

/**
 * Random HDRI-style environments for the playing scene.
 *
 * Sources: Poly Haven (polyhaven.com) — CC0 (same license family as
 * ambientCG). The 2K equirectangular .hdr masters are auto-exposed,
 * tonemapped and re-encoded as lossy WebP q85 (~0.2–0.6 MB each, see
 * scripts/prep_envs.py) — far lighter than RGBE .hdr for the web while
 * twice the resolution of the previous 1K files.
 *
 * Only ONE environment is fetched per game start, lazily after the first
 * frame, and decoded textures are cached for the session, so the payload
 * stays tiny. Each texture drives BOTH the visible background and the
 * PMREM image-based lighting.
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

/**
 * Loads one environment as a sharp sRGB equirectangular texture.
 * (WebP files are already compressed — no DecompressionStream involved.)
 */
export async function loadEquirect(id: string): Promise<THREE.Texture> {
  const tex = await loader.loadAsync(`/env/${id}.webp`)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.mapping = THREE.EquirectangularReflectionMapping
  return tex
}
