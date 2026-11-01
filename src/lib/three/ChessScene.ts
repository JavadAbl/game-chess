import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildBoard, squareToWorld, TINTS, type BoardBuild } from './board'
import { createPieceGeometry, createPieceMesh, type PieceColor } from './pieces'
import { loadEquirect, pickRandomEnv } from './environments'
import {
  addTween,
  createBurstSystem,
  easeInOutCubic,
  easeOutBack,
  updateTweens,
  type BurstSystem,
  type Tween,
} from './effects'
import type { BoardCell, MoveDetail, PieceType, SquareColor } from '@/lib/chess/types'

/**
 * The full 3D chess scene: WebGPU renderer (automatic WebGL2 fallback),
 * board + pieces, lighting, orbit camera, pointer interaction, move
 * animations and capture effects.
 */

const WHITE_BURST = 0xece1cc
const BLACK_BURST = 0x3a352f

/** Reported while an environment downloads / applies. */
export interface EnvStatus {
  status: 'loading' | 'ready' | 'failed'
  label: string
  /** 0–100 during download; null = indeterminate */
  pct: number | null
  fromCache: boolean
}

export class ChessScene {
  backend: 'webgpu' | 'webgl2' = 'webgl2'
  onSquareClick: ((square: string) => void) | null = null
  /** Fired when the player right-clicks the selected piece or presses Escape. */
  onDeselect: (() => void) | null = null
  /** Progress sink for the pre-match download overlay (set by ChessCanvas). */
  onEnvProgress: ((status: EnvStatus) => void) | null = null

  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGPURenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private board: BoardBuild
  private pieceGroup = new THREE.Group()
  private pieces = new Map<string, THREE.Mesh>()
  private tweens: Tween[] = []
  private bursts: BurstSystem
  private raycaster = new THREE.Raycaster()
  private clock = new THREE.Clock()
  private resizeObserver: ResizeObserver | null = null
  private envTexture: THREE.Texture | null = null
  /** PMREM targets power IBL lighting; equirects power the visible background. */
  private envTargets = new Map<string, THREE.RenderTarget>()
  private envEquirects = new Map<string, THREE.Texture>()
  private envId: string | null = null
  private envLoadToken = 0
  private menuBackground = new THREE.Color('#0d0b09')

  private elapsed = 0
  private downPos = { x: 0, y: 0 }
  private downTime = 0
  private hovered: string | null = null
  private selectedSq: string | null = null
  private targetSqs: string[] = []
  /** Beginner mode: squares holding pieces with at least one legal move. */
  private movableSqs: string[] = []
  private lastMoveSqs: { from: string; to: string } | null = null
  private checkSq: string | null = null
  private disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: true })
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120)
    // 39° depression: the e2/e7 pawns must clear the back rank both visually
    // and for raycasting — a shallower angle makes rank-2 pawns unclickable
    this.camera.position.set(0, 7.6, 9.4)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.enablePan = false
    this.controls.minDistance = 5.5
    this.controls.maxDistance = 24
    this.controls.minPolarAngle = 0.12
    this.controls.maxPolarAngle = 1.32
    this.controls.target.set(0, 0, 0)

    this.scene.background = new THREE.Color('#0d0b09')

    this.board = buildBoard()
    this.scene.add(this.board.group)
    this.scene.add(this.pieceGroup)
    this.bursts = createBurstSystem(this.scene)

    // Lighting
    const hemi = new THREE.HemisphereLight(0xf7ecd9, 0x2a1e12, 0.5)
    this.scene.add(hemi)
    const key = new THREE.DirectionalLight(0xfff1dd, 2.1)
    key.position.set(5.5, 10, 6.5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const cam = key.shadow.camera as THREE.OrthographicCamera
    cam.left = -7
    cam.right = 7
    cam.top = 7
    cam.bottom = -7
    cam.near = 1
    cam.far = 30
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xe8dcc8, 0.55)
    fill.position.set(-6, 5, -4)
    this.scene.add(fill)

    // Soft image-based lighting (guarded — purely cosmetic)
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      this.scene.environment = this.envTexture
      this.scene.environmentIntensity = 0.45
    } catch {
      /* hemisphere + directional lights are sufficient on their own */
    }

    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerleave', this.onPointerLeave)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)

    const parent = canvas.parentElement
    if (parent && typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize())
      this.resizeObserver.observe(parent)
    }
  }

  async init(): Promise<void> {
    await this.renderer.init()
    if (this.disposed) return
    const backend = (this.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend
    this.backend = backend ? 'webgpu' : 'webgl2'
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.resize()
    this.renderer.setAnimationLoop(() => this.tick())
    // Dev-only debug handle for live scene tuning
    if (process.env.NODE_ENV !== 'production') {
      ;(window as unknown as { __chessScene?: ChessScene }).__chessScene = this
    }
    // NOTE: environments intentionally do NOT load here — the main menu stays
    // backdrop-free. randomizeEnvironment() is called when a match starts.
  }

  /**
   * Picks a random environment (never the current one) and applies it as
   * both the IBL environment and the sharp background. Files are cached in
   * Cache Storage after the first download, so this is instant for any
   * previously seen environment. Falls back silently to the built-in
   * RoomEnvironment.
   */
  randomizeEnvironment(): void {
    void this.applyRandomEnvironment()
  }

  /**
   * Back to the backdrop-free state (main menu). In-flight loads are
   * cancelled; decoded textures and PMREM targets stay cached for instant
   * reuse in the next match.
   */
  clearEnvironment(): void {
    this.envLoadToken++
    this.envId = null
    this.scene.background = this.menuBackground
    this.scene.backgroundBlurriness = 0
    if (this.envTexture) this.scene.environment = this.envTexture
    delete this.canvas.dataset.env
  }

  private async applyRandomEnvironment(): Promise<void> {
    const next = pickRandomEnv(this.envId)
    const token = ++this.envLoadToken
    const report = (status: EnvStatus) => {
      if (token === this.envLoadToken && !this.disposed) this.onEnvProgress?.(status)
    }
    report({ status: 'loading', label: next.label, pct: null, fromCache: false })
    try {
      let target = this.envTargets.get(next.id)
      let equirect = this.envEquirects.get(next.id)
      if (!target || !equirect) {
        const loaded = await loadEquirect(next.id, ({ pct, fromCache }) =>
          report({ status: 'loading', label: next.label, pct, fromCache }),
        )
        if (this.disposed || token !== this.envLoadToken || !this.rendererAlive()) {
          loaded.dispose()
          return
        }
        equirect = loaded
        this.envEquirects.set(next.id, equirect)
        if (!target) {
          const pmrem = new THREE.PMREMGenerator(this.renderer)
          try {
            target = pmrem.fromEquirectangular(equirect)
          } finally {
            pmrem.dispose()
          }
          if (this.disposed || token !== this.envLoadToken) {
            target.dispose()
            return
          }
          this.envTargets.set(next.id, target)
        }
      }
      if (this.disposed || token !== this.envLoadToken) return
      this.envId = next.id
      this.envTexture = target.texture
      // environment (PMREM) drives IBL lighting; background (equirect) is the
      // visible sky. backgroundBlurriness MUST stay 0: with blur > 0 the r186
      // WebGPU renderer swaps the background node to pmremTexture(), which
      // paints the prefiltered cubeUV atlas on screen — a mush of color
      // blobs instead of the actual sky. 0 keeps the sharp equirect path.
      this.scene.environment = target.texture
      this.scene.background = equirect
      this.scene.backgroundBlurriness = 0
      // background is display-referred (LDR) but still passes through ACES —
      // push it a bit so skies keep their punch next to the lit board
      this.scene.backgroundIntensity = 1.25
      this.canvas.dataset.env = next.id
      report({ status: 'ready', label: next.label, pct: 100, fromCache: true })
    } catch (err) {
      console.warn(`[env] failed to load "${next.id}":`, err)
      report({ status: 'failed', label: next.label, pct: null, fromCache: false })
    }
  }

  /** True when the backend is still alive (guards StrictMode remount races). */
  private rendererAlive(): boolean {
    const r = this.renderer as unknown as { hasInitialized?: () => boolean }
    return r.hasInitialized ? r.hasInitialized() : true
  }

  private resize(): void {
    const parent = this.canvas.parentElement
    if (!parent) return
    const w = Math.max(1, parent.clientWidth)
    const h = Math.max(1, parent.clientHeight)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }

  private tick(): void {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.05)
    this.elapsed += dt
    this.controls.update()
    updateTweens(this.tweens, dt)
    this.bursts.update(dt)
    if (this.checkSq) {
      const pulse = 0.4 + 0.25 * Math.sin(this.elapsed * 6)
      this.board.setTintIntensity(this.checkSq, pulse)
    }
    void this.renderer.render(this.scene, this.camera)
  }

  // ── interaction ─────────────────────────────────────────────

  private pickSquare(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(ndc, this.camera)
    const targets: THREE.Object3D[] = [...this.pieceGroup.children, ...this.board.squareMeshes]
    const hits = this.raycaster.intersectObjects(targets, false)
    for (const hit of hits) {
      const sq = (hit.object.userData as { square?: string }).square
      if (sq) return sq
    }
    return null
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY }
    this.downTime = performance.now()
  }

  private onPointerUp = (e: PointerEvent): void => {
    const dx = e.clientX - this.downPos.x
    const dy = e.clientY - this.downPos.y
    if (Math.hypot(dx, dy) > 8) return
    if (performance.now() - this.downTime > 1000) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const square = this.pickSquare(e.clientX, e.clientY)
    if (square) this.onSquareClick?.(square)
  }

  // Right-click on the selected piece clears the selection. The drag guard
  // (downPos comes from the right-button pointerdown) keeps an aborted
  // right-drag orbit gesture from deselecting as a side effect. OrbitControls
  // already suppresses the browser context menu on the canvas.
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault()
    if (!this.selectedSq) return
    const dx = e.clientX - this.downPos.x
    const dy = e.clientY - this.downPos.y
    if (Math.hypot(dx, dy) > 8) return
    const square = this.pickSquare(e.clientX, e.clientY)
    if (square === this.selectedSq) this.onDeselect?.()
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.selectedSq) this.onDeselect?.()
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.targetSqs.length === 0) {
      if (this.hovered) {
        this.hovered = null
        this.refreshTints()
        this.canvas.style.cursor = 'default'
      }
      return
    }
    const sq = this.pickSquare(e.clientX, e.clientY)
    if (sq !== this.hovered) {
      this.hovered = sq
      this.refreshTints()
      this.canvas.style.cursor = sq && this.targetSqs.includes(sq) ? 'pointer' : 'default'
    }
  }

  private onPointerLeave = (): void => {
    if (this.hovered) {
      this.hovered = null
      this.refreshTints()
      this.canvas.style.cursor = 'default'
    }
  }

  // ── highlights ──────────────────────────────────────────────

  private refreshTints(): void {
    this.board.resetTints()
    for (const sq of this.movableSqs) {
      if (sq !== this.selectedSq) this.board.tint(sq, TINTS.hint.color, TINTS.hint.intensity)
    }
    if (this.lastMoveSqs) {
      this.board.tint(this.lastMoveSqs.from, TINTS.lastMove.color, TINTS.lastMove.intensity)
      this.board.tint(this.lastMoveSqs.to, TINTS.lastMove.color, TINTS.lastMove.intensity)
    }
    if (this.checkSq) {
      this.board.tint(this.checkSq, TINTS.check.color, TINTS.check.intensity)
    }
    if (this.selectedSq) {
      this.board.tint(this.selectedSq, TINTS.selected.color, TINTS.selected.intensity)
    }
    if (this.hovered && this.targetSqs.includes(this.hovered) && this.hovered !== this.selectedSq) {
      this.board.tint(this.hovered, TINTS.hover.color, TINTS.hover.intensity)
    }
  }

  setSelection(square: string | null, targets: string[]): void {
    this.selectedSq = square
    this.targetSqs = targets
    const quiet: string[] = []
    const captures: string[] = []
    for (const t of targets) {
      if (this.pieces.has(t)) captures.push(t)
      else quiet.push(t)
    }
    this.board.showMarkers(quiet, captures)
    this.refreshTints()
  }

  /**
   * Beginner mode: soft glow under every piece the local player can legally
   * move. Lowest tint layer — last-move / check / selection override it.
   */
  setMovableHints(squares: string[]): void {
    this.movableSqs = squares
    this.refreshTints()
  }

  setLastMove(move: { from: string; to: string } | null): void {
    this.lastMoveSqs = move
    this.refreshTints()
  }

  setCheckSquare(square: string | null): void {
    if (this.checkSq && this.checkSq !== square) this.board.setTintIntensity(this.checkSq, 0)
    this.checkSq = square
    this.refreshTints()
  }

  // ── camera orientation ──────────────────────────────────────

  setOrientation(color: SquareColor): void {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const sph = new THREE.Spherical().setFromVector3(offset)
    const targetTheta = color === 'w' ? 0 : Math.PI
    const twoPi = Math.PI * 2
    let diff = (targetTheta - sph.theta) % twoPi
    if (diff > Math.PI) diff -= twoPi
    if (diff < -Math.PI) diff += twoPi
    const fromTheta = sph.theta
    const toTheta = fromTheta + diff
    const radius = sph.radius
    const phi = sph.phi
    if (Math.abs(diff) < 0.01) return
    this.controls.enabled = false
    addTween(this.tweens, {
      dur: 0.7,
      ease: easeInOutCubic,
      onUpdate: (k) => {
        const theta = fromTheta + (toTheta - fromTheta) * k
        const p = new THREE.Vector3().setFromSphericalCoords(radius, phi, theta)
        this.camera.position.copy(this.controls.target).add(p)
        this.camera.lookAt(this.controls.target)
      },
      onDone: () => {
        this.controls.enabled = true
      },
    })
  }

  // ── piece lifecycle ─────────────────────────────────────────

  /** Full resync from a board snapshot (start / undo / rematch / rejoin). */
  syncFromBoard(cells: BoardCell[]): void {
    this.pieceGroup.clear()
    this.pieces.clear()
    let i = 0
    for (const cell of cells) {
      if (!cell) continue
      const mesh = createPieceMesh(cell.type as PieceType, cell.color as PieceColor)
      const world = squareToWorld(cell.square)
      mesh.position.set(world.x, 0, world.z)
      mesh.userData.square = cell.square
      mesh.scale.setScalar(0.001)
      this.pieceGroup.add(mesh)
      this.pieces.set(cell.square, mesh)
      addTween(this.tweens, {
        dur: 0.24,
        delay: i * 0.016,
        ease: easeOutBack,
        onUpdate: (k) => mesh.scale.setScalar(Math.max(0.001, k)),
        onDone: () => mesh.scale.setScalar(1),
      })
      i++
    }
  }

  /** Animated diff for one move (slide, arc, capture, castle, promotion). */
  applyMove(detail: MoveDetail): void {
    const moving = this.pieces.get(detail.from)
    if (!moving) return
    const toPos = squareToWorld(detail.to)
    const fromPos = squareToWorld(detail.from)

    // Resolve the captured piece BEFORE `to` is remapped to the attacker —
    // otherwise the lookup below would find the attacker itself (it now owns
    // the `to` entry) and the scene would kill the capturing piece instead
    // of the victim. En passant is immune: its victim sits on another square.
    let capturedSq: string | null = null
    if (detail.captured) {
      capturedSq = detail.flags.includes('e') ? detail.to[0] + detail.from[1] : detail.to
    }
    const capturedMesh = capturedSq ? (this.pieces.get(capturedSq) ?? null) : null
    if (capturedSq && capturedMesh) this.pieces.delete(capturedSq)

    this.pieces.delete(detail.from)
    this.pieces.set(detail.to, moving)
    moving.userData.square = detail.to

    const isArc = detail.piece === 'n'
    const lift = isArc ? 0.55 : 0.1
    addTween(this.tweens, {
      dur: 0.42,
      ease: easeInOutCubic,
      onUpdate: (k) => {
        moving.position.x = fromPos.x + (toPos.x - fromPos.x) * k
        moving.position.z = fromPos.z + (toPos.z - fromPos.z) * k
        moving.position.y = Math.sin(k * Math.PI) * lift
      },
      onDone: () => {
        moving.position.set(toPos.x, 0, toPos.z)
        if (detail.promotion) this.swapPiece(moving, detail.promotion, detail.color)
      },
    })

    if (capturedMesh) {
      const mesh = capturedMesh
      const capPos = squareToWorld(capturedSq)
      const burstColor = detail.color === 'w' ? BLACK_BURST : WHITE_BURST
      addTween(this.tweens, {
        dur: 0.26,
        delay: 0.16,
        ease: easeInOutCubic,
        onUpdate: (k) => {
          mesh.scale.setScalar(Math.max(0.001, 1 - k))
          mesh.position.y = -0.1 * k
        },
        onDone: () => {
          this.pieceGroup.remove(mesh)
          this.bursts.spawn(capPos, burstColor)
        },
      })
    }

    // Castling — animate the rook too
    if (detail.flags.includes('k') || detail.flags.includes('q')) {
      const rank = detail.from[1]
      const rookFrom = (detail.flags.includes('k') ? 'h' : 'a') + rank
      const rookTo = (detail.flags.includes('k') ? 'f' : 'd') + rank
      const rook = this.pieces.get(rookFrom)
      if (rook) {
        this.pieces.delete(rookFrom)
        this.pieces.set(rookTo, rook)
        rook.userData.square = rookTo
        const rf = squareToWorld(rookFrom)
        const rt = squareToWorld(rookTo)
        addTween(this.tweens, {
          dur: 0.42,
          delay: 0.08,
          ease: easeInOutCubic,
          onUpdate: (k) => {
            rook.position.x = rf.x + (rt.x - rf.x) * k
            rook.position.z = rf.z + (rt.z - rf.z) * k
            rook.position.y = Math.sin(k * Math.PI) * 0.3
          },
          onDone: () => rook.position.set(rt.x, 0, rt.z),
        })
      }
    }
  }

  private swapPiece(mesh: THREE.Mesh, promotion: PieceType, color: PieceColor): void {
    mesh.geometry = createPieceGeometry(promotion)
    mesh.userData.kind = promotion
    mesh.rotation.y = promotion === 'n' && color === 'b' ? Math.PI : 0
    addTween(this.tweens, {
      dur: 0.3,
      ease: easeInOutCubic,
      onUpdate: (k) => mesh.scale.setScalar(1 + 0.18 * Math.sin(k * Math.PI)),
      onDone: () => mesh.scale.setScalar(1),
    })
  }

  // ── disposal ────────────────────────────────────────────────

  dispose(): void {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    this.resizeObserver?.disconnect()
    this.controls.dispose()
    this.bursts.dispose()
    this.board.dispose()
    if (this.envTexture) this.envTexture.dispose()
    for (const target of this.envTargets.values()) target.dispose()
    this.envTargets.clear()
    for (const equirect of this.envEquirects.values()) equirect.dispose()
    this.envEquirects.clear()
    void this.renderer.dispose()
  }
}
