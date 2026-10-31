import * as THREE from 'three/webgpu'

/**
 * Builds the 3D board: 64 individually tintable squares, a wooden frame with
 * coordinate labels, legal-move markers (dots / capture rings) and the floor.
 */

export const TINTS = {
  selected: { color: 0xffb84d, intensity: 0.6 },
  lastMove: { color: 0xe8a33d, intensity: 0.3 },
  hover: { color: 0xf5e6c8, intensity: 0.22 },
  check: { color: 0xe23d3d, intensity: 0.5 },
  /** Beginner mode: soft cool glow on pieces that currently have a legal move. */
  hint: { color: 0x54cfe0, intensity: 0.3 },
} as const

export interface BoardBuild {
  group: THREE.Group
  squareMeshes: THREE.Mesh[]
  tint: (square: string, color: number | null, intensity?: number) => void
  setTintIntensity: (square: string, intensity: number) => void
  resetTints: () => void
  showMarkers: (quiet: string[], captures: string[]) => void
  clearMarkers: () => void
  dispose: () => void
}

export function squareToWorld(square: string): THREE.Vector3 {
  const file = square.charCodeAt(0) - 97 // a..h → 0..7
  const rank = parseInt(square[1], 10) - 1 // 1..8 → 0..7
  return new THREE.Vector3(file - 3.5, 0, 3.5 - rank)
}

function makeLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const g = canvas.getContext('2d')
  if (g) {
    g.clearRect(0, 0, 128, 128)
    g.fillStyle = '#cdb98e'
    g.font = '600 64px ui-sans-serif, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 64, 68)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * Neutral grayscale wood grain — the square's material color provides the hue,
 * this texture only adds grain streaks and speckle so light/dark squares stay
 * clearly distinct (maple vs walnut read through their base colors).
 */
function makeWoodTexture(seed: number): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g) {
    g.fillStyle = '#ececec'
    g.fillRect(0, 0, size, size)
    // deterministic PRNG (LCG) so both clients render identical grain
    let s = seed >>> 0
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 0xffffffff
    }
    g.lineWidth = 1
    for (let i = 0; i < 46; i++) {
      const y0 = rnd() * size
      const amp = 2 + rnd() * 5
      const freq = 0.01 + rnd() * 0.02
      const phase = rnd() * Math.PI * 2
      const shade = 205 + Math.floor(rnd() * 35)
      g.strokeStyle = `rgba(${shade},${shade},${shade},${(0.16 + rnd() * 0.2).toFixed(2)})`
      g.beginPath()
      for (let x = 0; x <= size; x += 8) {
        const y = y0 + Math.sin(x * freq + phase) * amp
        if (x === 0) g.moveTo(x, y)
        else g.lineTo(x, y)
      }
      g.stroke()
    }
    for (let i = 0; i < 900; i++) {
      const v = 225 + Math.floor(rnd() * 30)
      g.fillStyle = `rgba(${v},${v},${v},0.12)`
      g.fillRect(rnd() * size, rnd() * size, 1.5, 1.5)
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

export function buildBoard(): BoardBuild {
  const group = new THREE.Group()
  const squareMeshes: THREE.Mesh[] = []
  const squareMats: THREE.MeshStandardMaterial[] = []
  const tintState = new Map<string, { color: number | null; intensity: number }>()

  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xc9b083,
    roughness: 0.5,
    metalness: 0.03,
    emissive: 0x000000,
    emissiveIntensity: 0,
  })
  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x6e4a2e,
    roughness: 0.52,
    metalness: 0.03,
    emissive: 0x000000,
    emissiveIntensity: 0,
  })

  // Two grain variants per color so adjacent squares don't repeat visibly
  const woodTex = {
    light: [makeWoodTexture(11), makeWoodTexture(29)],
    dark: [makeWoodTexture(71), makeWoodTexture(97)],
  }

  const squareGeo = new THREE.BoxGeometry(1, 0.16, 1)
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const isLight = (rank + file) % 2 === 1
      const mat = (isLight ? lightMat : darkMat).clone()
      mat.map = (isLight ? woodTex.light : woodTex.dark)[(rank * 5 + file * 3) % 2]
      const mesh = new THREE.Mesh(squareGeo, mat)
      const square = String.fromCharCode(97 + file) + String(rank + 1)
      const world = squareToWorld(square)
      mesh.position.set(world.x, -0.08, world.z)
      mesh.receiveShadow = true
      mesh.userData.square = square
      squareMeshes.push(mesh)
      squareMats.push(mat)
      group.add(mesh)
    }
  }

  // Frame
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a281c, roughness: 0.44, metalness: 0.05 })
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.26, 9.5), frameMat)
  frame.position.y = -0.14
  frame.receiveShadow = true
  frame.castShadow = true
  group.add(frame)

  // Golden-brown inlay border around the play area. Built as 4 thin strips whose
  // top face sits 1 mm BELOW the square tops — a full plate here would z-cover
  // the entire board and hide the checker pattern (and every square tint).
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x86602f, roughness: 0.35, metalness: 0.1 })
  const accentGeoH = new THREE.BoxGeometry(8.36, 0.02, 0.18)
  const accentGeoV = new THREE.BoxGeometry(0.18, 0.02, 8.36)
  const accentStrips: THREE.Mesh[] = []
  const half = 4.09
  const stripDefs: [number, number, THREE.BoxGeometry][] = [
    [0, half, accentGeoH],
    [0, -half, accentGeoH],
    [half, 0, accentGeoV],
    [-half, 0, accentGeoV],
  ]
  for (const [x, z, geo] of stripDefs) {
    const strip = new THREE.Mesh(geo, accentMat)
    strip.position.set(x, -0.011, z)
    strip.receiveShadow = true
    accentStrips.push(strip)
    group.add(strip)
  }

  // Coordinate labels on the frame
  const labelPlanes: THREE.Mesh[] = []
  const labelTextures: THREE.CanvasTexture[] = []
  const addLabel = (text: string, x: number, z: number, flip: boolean) => {
    const tex = makeLabelTexture(text)
    labelTextures.push(tex)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), mat)
    plane.rotation.x = -Math.PI / 2
    if (flip) plane.rotation.z = Math.PI
    plane.position.set(x, 0.006, z)
    labelPlanes.push(plane)
    group.add(plane)
  }
  for (let f = 0; f < 8; f++) {
    const letter = String.fromCharCode(97 + f)
    const x = f - 3.5
    addLabel(letter, x, 4.3, false)
    addLabel(letter, x, -4.3, true)
  }
  for (let r = 0; r < 8; r++) {
    const num = String(r + 1)
    const z = 3.5 - r
    addLabel(num, -4.3, z, false)
    addLabel(num, 4.3, z, true)
  }

  // Shadow-catcher only — invisible floor so the HDRI environment shows around
  // the board while pieces still cast a soft grounding shadow.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.38 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.275
  floor.receiveShadow = true
  group.add(floor)

  // Markers (legal-move dots and capture rings)
  const markerGroup = new THREE.Group()
  group.add(markerGroup)
  const dotGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.02, 24)
  const ringGeo = new THREE.TorusGeometry(0.36, 0.04, 10, 44)
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x241a10, transparent: true, opacity: 0.6 })
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xc0553a, transparent: true, opacity: 0.85 })

  function clearMarkers(): void {
    markerGroup.clear()
  }

  function showMarkers(quiet: string[], captures: string[]): void {
    clearMarkers()
    for (const sq of quiet) {
      const m = new THREE.Mesh(dotGeo, dotMat)
      const p = squareToWorld(sq)
      m.position.set(p.x, 0.015, p.z)
      markerGroup.add(m)
    }
    for (const sq of captures) {
      const m = new THREE.Mesh(ringGeo, ringMat)
      const p = squareToWorld(sq)
      m.rotation.x = Math.PI / 2
      m.position.set(p.x, 0.02, p.z)
      markerGroup.add(m)
    }
  }

  function tint(square: string, color: number | null, intensity = 0): void {
    const idx = squareMeshes.findIndex((m) => m.userData.square === square)
    if (idx === -1) return
    const mat = squareMats[idx]
    if (color === null) {
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
      tintState.delete(square)
    } else {
      mat.emissive.setHex(color)
      mat.emissiveIntensity = intensity
      tintState.set(square, { color, intensity })
    }
  }

  function setTintIntensity(square: string, intensity: number): void {
    const idx = squareMeshes.findIndex((m) => m.userData.square === square)
    if (idx === -1) return
    squareMats[idx].emissiveIntensity = intensity
    const st = tintState.get(square)
    if (st) st.intensity = intensity
  }

  function resetTints(): void {
    for (const mat of squareMats) {
      mat.emissive.setHex(0x000000)
      mat.emissiveIntensity = 0
    }
    tintState.clear()
  }

  function dispose(): void {
    squareGeo.dispose()
    frame.geometry.dispose()
    frameMat.dispose()
    accentMat.dispose()
    accentGeoH.dispose()
    accentGeoV.dispose()
    for (const tex of [...woodTex.light, ...woodTex.dark]) tex.dispose()
    lightMat.dispose()
    darkMat.dispose()
    dotGeo.dispose()
    ringGeo.dispose()
    dotMat.dispose()
    ringMat.dispose()
    for (const tex of labelTextures) tex.dispose()
    for (const p of labelPlanes) {
      p.geometry.dispose()
      ;(p.material as THREE.Material).dispose()
    }
    for (const m of squareMats) m.dispose()
    ;(floor.material as THREE.Material).dispose()
    floor.geometry.dispose()
  }

  return {
    group,
    squareMeshes,
    tint,
    setTintIntensity,
    resetTints,
    showMarkers,
    clearMarkers,
    dispose,
  }
}
