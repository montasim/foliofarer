import * as THREE from "three"
import type {
  Bounds2,
  JourneyWorldColliderDefinition,
  Vec2,
} from "@/lib/journey-v2/runtime/types"

interface IndexedCollider {
  definition: JourneyWorldColliderDefinition
  bounds: Bounds2
  signedArea: number
}

function boundsForPolygon(polygon: Vec2[]): Bounds2 {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY

  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return [minX, minZ, maxX, maxZ]
}

function polygonSignedArea(polygon: Vec2[]) {
  let area = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area * 0.5
}

function pointInPolygon(x: number, z: number, polygon: Vec2[]) {
  let inside = false
  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const [currentX, currentZ] = polygon[currentIndex]
    const [previousX, previousZ] = polygon[previousIndex]
    const crosses =
      currentZ > z !== previousZ > z &&
      x <
        ((previousX - currentX) * (z - currentZ)) /
          (previousZ - currentZ || Number.EPSILON) +
          currentX
    if (crosses) inside = !inside
  }
  return inside
}

function closestPointOnSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
) {
  const edgeX = bx - ax
  const edgeZ = bz - az
  const lengthSquared = edgeX * edgeX + edgeZ * edgeZ
  const t =
    lengthSquared === 0
      ? 0
      : THREE.MathUtils.clamp(
          ((x - ax) * edgeX + (z - az) * edgeZ) / lengthSquared,
          0,
          1
        )
  return {
    x: ax + edgeX * t,
    z: az + edgeZ * t,
    edgeX,
    edgeZ,
  }
}

function cross2(ax: number, az: number, bx: number, bz: number) {
  return ax * bz - az * bx
}

function segmentIntersectionFraction(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  edgeAX: number,
  edgeAZ: number,
  edgeBX: number,
  edgeBZ: number
) {
  const rayX = toX - fromX
  const rayZ = toZ - fromZ
  const edgeX = edgeBX - edgeAX
  const edgeZ = edgeBZ - edgeAZ
  const denominator = cross2(rayX, rayZ, edgeX, edgeZ)
  if (Math.abs(denominator) < 1e-8) return null

  const originX = edgeAX - fromX
  const originZ = edgeAZ - fromZ
  const rayFraction = cross2(originX, originZ, edgeX, edgeZ) / denominator
  const edgeFraction = cross2(originX, originZ, rayX, rayZ) / denominator
  if (
    rayFraction < 0 ||
    rayFraction > 1 ||
    edgeFraction < 0 ||
    edgeFraction > 1
  ) {
    return null
  }
  return rayFraction
}

function intersectsBounds(a: Bounds2, b: Bounds2) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

/**
 * Static polygon collision optimized around a small spatial hash. It deliberately
 * keeps collision independent from the render tree so invisible cells cost no
 * scene traversal and no physics simulation is required.
 */
export class JourneyCollisionWorld {
  private readonly colliders: IndexedCollider[] = []
  private readonly grid = new Map<string, number[]>()
  private readonly queryResult = new Set<number>()
  private readonly colliderIds = new Set<string>()
  private readonly disabledCellIds = new Set<string>()
  private readonly cellSize: number

  constructor(
    definitions: JourneyWorldColliderDefinition[],
    private readonly worldBounds: Bounds2,
    cellSize: number
  ) {
    this.cellSize = Math.max(8, cellSize * 0.5)
    this.addColliders(definitions)
  }

  addColliders(definitions: JourneyWorldColliderDefinition[]) {
    for (const definition of definitions) {
      this.disabledCellIds.delete(definition.cellId)
      if (
        definition.kind !== "polygon" ||
        definition.polygon.length < 3 ||
        this.colliderIds.has(definition.id)
      ) {
        continue
      }
      const collider: IndexedCollider = {
        definition,
        bounds: boundsForPolygon(definition.polygon),
        signedArea: polygonSignedArea(definition.polygon),
      }
      const index = this.colliders.length
      this.colliders.push(collider)
      this.colliderIds.add(definition.id)
      const minGridX = Math.floor(collider.bounds[0] / this.cellSize)
      const minGridZ = Math.floor(collider.bounds[1] / this.cellSize)
      const maxGridX = Math.floor(collider.bounds[2] / this.cellSize)
      const maxGridZ = Math.floor(collider.bounds[3] / this.cellSize)
      for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
        for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ += 1) {
          const key = `${gridX}:${gridZ}`
          const entries = this.grid.get(key)
          if (entries) entries.push(index)
          else this.grid.set(key, [index])
        }
      }
    }
  }

  /**
   * Streaming eviction disables a cell without rebuilding the spatial hash.
   * Reloading any collider from that cell enables its existing indexed entries.
   */
  removeCell(cellId: string) {
    this.disabledCellIds.add(cellId)
  }

  private query(bounds: Bounds2) {
    this.queryResult.clear()
    const minGridX = Math.floor(bounds[0] / this.cellSize)
    const minGridZ = Math.floor(bounds[1] / this.cellSize)
    const maxGridX = Math.floor(bounds[2] / this.cellSize)
    const maxGridZ = Math.floor(bounds[3] / this.cellSize)

    for (let gridX = minGridX; gridX <= maxGridX; gridX += 1) {
      for (let gridZ = minGridZ; gridZ <= maxGridZ; gridZ += 1) {
        const entries = this.grid.get(`${gridX}:${gridZ}`)
        if (!entries) continue
        for (const entry of entries) this.queryResult.add(entry)
      }
    }

    return this.queryResult
  }

  moveCircle(
    current: THREE.Vector2,
    movement: THREE.Vector2,
    radius: number,
    target = new THREE.Vector2()
  ) {
    target.copy(current).add(movement)
    target.x = THREE.MathUtils.clamp(
      target.x,
      this.worldBounds[0] + radius,
      this.worldBounds[2] - radius
    )
    target.y = THREE.MathUtils.clamp(
      target.y,
      this.worldBounds[1] + radius,
      this.worldBounds[3] - radius
    )

    for (let iteration = 0; iteration < 4; iteration += 1) {
      let corrected = false
      const queryBounds: Bounds2 = [
        target.x - radius,
        target.y - radius,
        target.x + radius,
        target.y + radius,
      ]

      for (const index of this.query(queryBounds)) {
        const collider = this.colliders[index]
        if (this.disabledCellIds.has(collider.definition.cellId)) continue
        if (!intersectsBounds(queryBounds, collider.bounds)) continue

        const polygon = collider.definition.polygon
        const inside = pointInPolygon(target.x, target.y, polygon)
        let closestDistanceSquared = Number.POSITIVE_INFINITY
        let closestX = target.x
        let closestZ = target.y
        let closestEdgeX = 1
        let closestEdgeZ = 0

        for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
          const [ax, az] = polygon[edgeIndex]
          const [bx, bz] = polygon[(edgeIndex + 1) % polygon.length]
          const closest = closestPointOnSegment(
            target.x,
            target.y,
            ax,
            az,
            bx,
            bz
          )
          const distanceX = target.x - closest.x
          const distanceZ = target.y - closest.z
          const distanceSquared = distanceX * distanceX + distanceZ * distanceZ
          if (distanceSquared < closestDistanceSquared) {
            closestDistanceSquared = distanceSquared
            closestX = closest.x
            closestZ = closest.z
            closestEdgeX = closest.edgeX
            closestEdgeZ = closest.edgeZ
          }
        }

        if (!inside && closestDistanceSquared >= radius * radius) continue

        if (inside) {
          const edgeLength =
            Math.hypot(closestEdgeX, closestEdgeZ) || Number.EPSILON
          const winding = collider.signedArea >= 0 ? 1 : -1
          const outwardX = (closestEdgeZ / edgeLength) * winding
          const outwardZ = (-closestEdgeX / edgeLength) * winding
          target.set(
            closestX + outwardX * (radius + 0.002),
            closestZ + outwardZ * (radius + 0.002)
          )
        } else {
          const distance = Math.sqrt(closestDistanceSquared)
          const normalX =
            distance > 1e-6
              ? (target.x - closestX) / distance
              : closestEdgeZ /
                (Math.hypot(closestEdgeX, closestEdgeZ) || Number.EPSILON)
          const normalZ =
            distance > 1e-6
              ? (target.y - closestZ) / distance
              : -closestEdgeX /
                (Math.hypot(closestEdgeX, closestEdgeZ) || Number.EPSILON)
          target.x += normalX * (radius - distance + 0.002)
          target.y += normalZ * (radius - distance + 0.002)
        }
        corrected = true
      }

      if (!corrected) break
    }

    return target
  }

  /**
   * Returns the unobstructed fraction of a target-to-camera segment.
   */
  cameraVisibilityFraction(from: THREE.Vector3, to: THREE.Vector3) {
    const rayBounds: Bounds2 = [
      Math.min(from.x, to.x),
      Math.min(from.z, to.z),
      Math.max(from.x, to.x),
      Math.max(from.z, to.z),
    ]
    let nearestFraction = 1

    for (const index of this.query(rayBounds)) {
      const collider = this.colliders[index]
      if (this.disabledCellIds.has(collider.definition.cellId)) continue
      if (!intersectsBounds(rayBounds, collider.bounds)) continue
      const polygon = collider.definition.polygon

      for (let edgeIndex = 0; edgeIndex < polygon.length; edgeIndex += 1) {
        const [edgeAX, edgeAZ] = polygon[edgeIndex]
        const [edgeBX, edgeBZ] = polygon[(edgeIndex + 1) % polygon.length]
        const fraction = segmentIntersectionFraction(
          from.x,
          from.z,
          to.x,
          to.z,
          edgeAX,
          edgeAZ,
          edgeBX,
          edgeBZ
        )
        if (fraction === null || fraction >= nearestFraction) continue

        const height = THREE.MathUtils.lerp(from.y, to.y, fraction)
        if (
          height >= collider.definition.minY - 0.15 &&
          height <= collider.definition.maxY + 0.35
        ) {
          nearestFraction = Math.max(0.15, fraction - 0.055)
        }
      }
    }

    return nearestFraction
  }
}
