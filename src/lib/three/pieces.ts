import * as THREE from 'three/webgpu'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { PieceType } from '@/lib/chess/types'

/**
 * Procedural Staunton-style piece geometry. All pieces are built once and
 * cached; the same geometry is shared by every instance of a kind.
 * Board units: 1 square = 1.0, pieces stand on y = 0.
 */

export type PieceColor = 'w' | 'b'

const SEGMENTS = 40

function latheFromPairs(pairs: [number, number][]): THREE.LatheGeometry {
  const pts = pairs.map(([r, h]) => new THREE.Vector2(Math.max(r, 0.0001), h))
  const g = new THREE.LatheGeometry(pts, SEGMENTS)
  g.computeVertexNormals()
  return g
}

function pawnProfile(): [number, number][] {
  return [
    [0.0, 0.0],
    [0.27, 0.0],
    [0.27, 0.035],
    [0.21, 0.06],
    [0.13, 0.09],
    [0.1, 0.14],
    [0.085, 0.2],
    [0.09, 0.24],
    [0.13, 0.28],
    [0.13, 0.3],
    [0.08, 0.32],
    [0.145, 0.37],
    [0.16, 0.41],
    [0.11, 0.46],
    [0.045, 0.49],
    [0.0, 0.5],
  ]
}

function rookProfile(): [number, number][] {
  return [
    [0.0, 0.0],
    [0.29, 0.0],
    [0.29, 0.04],
    [0.24, 0.07],
    [0.17, 0.1],
    [0.145, 0.14],
    [0.125, 0.28],
    [0.14, 0.38],
    [0.19, 0.42],
    [0.2, 0.475],
    [0.2, 0.55],
    [0.145, 0.55],
    [0.145, 0.5],
    [0.0, 0.5],
  ]
}

function knightBaseProfile(): [number, number][] {
  return [
    [0.0, 0.0],
    [0.29, 0.0],
    [0.29, 0.04],
    [0.23, 0.075],
    [0.16, 0.11],
    [0.135, 0.13],
    [0.12, 0.155],
    [0.11, 0.18],
    [0.17, 0.2],
    [0.17, 0.22],
    [0.0, 0.22],
  ]
}

function bishopProfile(): [number, number][] {
  return [
    [0.0, 0.0],
    [0.28, 0.0],
    [0.28, 0.04],
    [0.22, 0.07],
    [0.14, 0.1],
    [0.115, 0.16],
    [0.1, 0.3],
    [0.13, 0.34],
    [0.13, 0.365],
    [0.08, 0.39],
    [0.145, 0.45],
    [0.155, 0.52],
    [0.12, 0.58],
    [0.06, 0.615],
    [0.035, 0.635],
    [0.055, 0.655],
    [0.035, 0.675],
    [0.0, 0.68],
  ]
}

function queenProfile(): [number, number][] {
  return [
    [0.0, 0.0],
    [0.3, 0.0],
    [0.3, 0.045],
    [0.235, 0.08],
    [0.15, 0.115],
    [0.12, 0.2],
    [0.1, 0.34],
    [0.135, 0.42],
    [0.135, 0.445],
    [0.09, 0.47],
    [0.15, 0.56],
    [0.19, 0.64],
    [0.21, 0.685],
    [0.16, 0.71],
    [0.13, 0.72],
    [0.0, 0.73],
  ]
}

function kingProfile(): [number, number][] {
  return [
    [0.0, 0.0],
    [0.31, 0.0],
    [0.31, 0.045],
    [0.245, 0.08],
    [0.16, 0.12],
    [0.13, 0.22],
    [0.105, 0.38],
    [0.145, 0.46],
    [0.145, 0.49],
    [0.095, 0.515],
    [0.16, 0.62],
    [0.2, 0.7],
    [0.215, 0.735],
    [0.15, 0.755],
    [0.1, 0.74],
    [0.0, 0.725],
  ]
}

/** Horse-head silhouette (x = forward, y = up), extruded for the knight. */
function knightHeadGeometry(): THREE.ExtrudeGeometry {
  const pts: [number, number][] = [
    [-0.16, 0.0],
    [-0.22, 0.12],
    [-0.24, 0.26],
    [-0.18, 0.4],
    [-0.1, 0.5],
    [-0.08, 0.6],
    [-0.02, 0.52],
    [0.03, 0.61],
    [0.06, 0.52],
    [0.14, 0.44],
    [0.26, 0.36],
    [0.32, 0.3],
    [0.31, 0.23],
    [0.22, 0.2],
    [0.12, 0.14],
    [0.08, 0.06],
    [0.1, 0.0],
  ]
  const shape = new THREE.Shape()
  shape.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1])
  shape.closePath()
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.17,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.024,
    bevelSegments: 3,
    steps: 1,
  })
  // Center the extrusion on z, then face the head toward -z (White's facing).
  geo.translate(0, 0, -0.085)
  geo.rotateY(Math.PI / 2)
  geo.scale(0.72, 0.72, 0.72)
  geo.translate(0, 0.19, 0)
  return geo
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  if (ry !== 0) g.rotateY(ry)
  g.translate(x, y, z)
  return g
}

const geometryCache = new Map<PieceType, THREE.BufferGeometry>()

/** mergeGeometries requires all parts to be indexed or all non-indexed. */
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const normalized = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = mergeGeometries(normalized)
  if (!merged) return parts[0]
  return merged
}

export function createPieceGeometry(kind: PieceType): THREE.BufferGeometry {
  const cached = geometryCache.get(kind)
  if (cached) return cached
  let geo: THREE.BufferGeometry
  switch (kind) {
    case 'p':
      geo = latheFromPairs(pawnProfile())
      break
    case 'r': {
      const parts: THREE.BufferGeometry[] = [latheFromPairs(rookProfile())]
      // Four crenellations on the rook's crown.
      const merlon = { w: 0.085, h: 0.075, d: 0.07 }
      parts.push(box(merlon.w, merlon.h, merlon.d, 0.165, 0.575, 0))
      parts.push(box(merlon.w, merlon.h, merlon.d, -0.165, 0.575, 0))
      parts.push(box(merlon.d, merlon.h, merlon.w, 0, 0.575, 0.165))
      parts.push(box(merlon.d, merlon.h, merlon.w, 0, 0.575, -0.165))
      geo = mergeParts(parts)
      break
    }
    case 'n': {
      const parts: THREE.BufferGeometry[] = [latheFromPairs(knightBaseProfile()), knightHeadGeometry()]
      geo = mergeParts(parts)
      break
    }
    case 'b':
      geo = latheFromPairs(bishopProfile())
      break
    case 'q': {
      const parts: THREE.BufferGeometry[] = [
        latheFromPairs(queenProfile()),
        new THREE.SphereGeometry(0.05, 20, 14).translate(0, 0.765, 0),
      ]
      geo = mergeParts(parts)
      break
    }
    case 'k': {
      const parts: THREE.BufferGeometry[] = [
        latheFromPairs(kingProfile()),
        box(0.05, 0.17, 0.05, 0, 0.81, 0),
        box(0.14, 0.05, 0.05, 0, 0.835, 0),
      ]
      geo = mergeParts(parts)
      break
    }
  }
  geometryCache.set(kind, geo)
  return geo
}

const materials: Record<PieceColor, THREE.MeshPhysicalMaterial> = {
  w: new THREE.MeshPhysicalMaterial({
    color: 0xece1cc,
    roughness: 0.34,
    metalness: 0.02,
    clearcoat: 0.55,
    clearcoatRoughness: 0.35,
  }),
  b: new THREE.MeshPhysicalMaterial({
    color: 0x322d28,
    roughness: 0.4,
    metalness: 0.06,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  }),
}

export function createPieceMesh(kind: PieceType, color: PieceColor): THREE.Mesh {
  const mesh = new THREE.Mesh(createPieceGeometry(kind), materials[color])
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.kind = kind
  mesh.userData.color = color
  if (kind === 'n' && color === 'b') mesh.rotation.y = Math.PI
  return mesh
}
