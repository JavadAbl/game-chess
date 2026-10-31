import * as THREE from 'three/webgpu'

/** Minimal tween engine driven by the scene render loop. */

export interface Tween {
  dur: number
  t: number
  ease: (k: number) => number
  onUpdate: (k: number) => void
  onDone?: () => void
}

export function addTween(list: Tween[], t: Omit<Tween, 't'> & { delay?: number }): void {
  list.push({ ...t, t: -((t.delay ?? 0) / t.dur) })
}

export function updateTweens(list: Tween[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const tw = list[i]
    tw.t += dt / tw.dur
    if (tw.t < 0) continue
    const k = Math.min(1, tw.t)
    tw.onUpdate(tw.ease(k))
    if (tw.t >= 1) {
      list.splice(i, 1)
      tw.onDone?.()
    }
  }
}

export const easeInOutCubic = (k: number): number =>
  k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2

export const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3)

export const easeOutBack = (k: number): number => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2)
}

// ── capture particle bursts ─────────────────────────────────

interface Particle {
  mesh: THREE.Mesh
  vel: THREE.Vector3
  life: number
  ttl: number
}

export interface BurstSystem {
  group: THREE.Group
  particles: Particle[]
  spawn: (pos: THREE.Vector3, colorHex: number) => void
  update: (dt: number) => void
  dispose: () => void
}

const PARTICLE_GEO = new THREE.SphereGeometry(0.032, 8, 8)

export function createBurstSystem(parent: THREE.Object3D): BurstSystem {
  const group = new THREE.Group()
  parent.add(group)
  const particles: Particle[] = []

  return {
    group,
    particles,
    spawn(pos: THREE.Vector3, colorHex: number) {
      for (let i = 0; i < 14; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: colorHex,
          transparent: true,
          opacity: 1,
        })
        const mesh = new THREE.Mesh(PARTICLE_GEO, mat)
        mesh.position.copy(pos)
        mesh.position.y += 0.25
        const scale = 0.6 + Math.random() * 0.9
        mesh.scale.setScalar(scale)
        const angle = Math.random() * Math.PI * 2
        const speed = 0.8 + Math.random() * 1.6
        const p: Particle = {
          mesh,
          vel: new THREE.Vector3(
            Math.cos(angle) * speed,
            1.4 + Math.random() * 1.4,
            Math.sin(angle) * speed,
          ),
          life: 0,
          ttl: 0.5 + Math.random() * 0.25,
        }
        group.add(mesh)
        particles.push(p)
      }
    },
    update(dt: number) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life += dt
        if (p.life >= p.ttl) {
          group.remove(p.mesh)
          ;(p.mesh.material as THREE.Material).dispose()
          particles.splice(i, 1)
          continue
        }
        p.vel.y -= 6.5 * dt
        p.mesh.position.addScaledVector(p.vel, dt)
        const mat = p.mesh.material as THREE.MeshBasicMaterial
        mat.opacity = Math.max(0, 1 - p.life / p.ttl)
      }
    },
    dispose() {
      for (const p of particles) (p.mesh.material as THREE.Material).dispose()
      particles.length = 0
      group.clear()
    },
  }
}
