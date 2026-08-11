import earcut from "earcut"
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping"

import type { Bounds2, GeometryDefinition, Vec2 } from "../contracts/world.ts"

const EPSILON = 1e-6

export function round(value: number, precision = 3) {
  const factor = 10 ** precision
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

export function distance(a: Vec2, b: Vec2) {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

export function lerp(a: Vec2, b: Vec2, amount: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount]
}

export function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector[0], vector[1])
  if (length < EPSILON) return [0, 1]
  return [vector[0] / length, vector[1] / length]
}

export function polygonArea(ring: readonly Vec2[]) {
  let area = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    area += current[0] * next[1] - next[0] * current[1]
  }
  return area / 2
}

export function multiPolygonArea(multiPolygon: MultiPolygon) {
  return multiPolygon.reduce(
    (total, polygon) =>
      total +
      polygon.reduce(
        (polygonTotal, ring, ringIndex) =>
          polygonTotal +
          Math.abs(polygonArea(ring)) * (ringIndex === 0 ? 1 : -1),
        0
      ),
    0
  )
}

export function circlePolygon(
  center: Vec2,
  radius: number,
  segments = 16
): Polygon {
  const ring: Ring = []
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2
    ring.push([
      round(center[0] + Math.cos(angle) * radius, 5),
      round(center[1] + Math.sin(angle) * radius, 5),
    ])
  }
  ring.push([...ring[0]])
  return [ring]
}

export function orientedRectangle(
  center: Vec2,
  tangent: Vec2,
  length: number,
  width: number
): Polygon {
  const direction = normalize(tangent)
  const normal: Vec2 = [-direction[1], direction[0]]
  const halfLength = length / 2
  const halfWidth = width / 2
  const corners: Ring = [
    [
      center[0] - direction[0] * halfLength - normal[0] * halfWidth,
      center[1] - direction[1] * halfLength - normal[1] * halfWidth,
    ],
    [
      center[0] + direction[0] * halfLength - normal[0] * halfWidth,
      center[1] + direction[1] * halfLength - normal[1] * halfWidth,
    ],
    [
      center[0] + direction[0] * halfLength + normal[0] * halfWidth,
      center[1] + direction[1] * halfLength + normal[1] * halfWidth,
    ],
    [
      center[0] - direction[0] * halfLength + normal[0] * halfWidth,
      center[1] - direction[1] * halfLength + normal[1] * halfWidth,
    ],
  ].map(([x, z]) => [round(x, 5), round(z, 5)] as [number, number])
  corners.push([...corners[0]])
  return [corners]
}

export function stripSegmentPolygon(start: Vec2, end: Vec2, halfWidth: number) {
  return orientedRectangle(
    lerp(start, end, 0.5),
    [end[0] - start[0], end[1] - start[1]],
    distance(start, end),
    halfWidth * 2
  )
}

export function boundsOfPoints(points: readonly Vec2[]): Bounds2 {
  let minX = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (const [x, z] of points) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return [round(minX), round(minZ), round(maxX), round(maxZ)]
}

export function expandBounds(bounds: Bounds2, padding: number): Bounds2 {
  return [
    round(bounds[0] - padding),
    round(bounds[1] - padding),
    round(bounds[2] + padding),
    round(bounds[3] + padding),
  ]
}

export function boundsIntersect(a: Bounds2, b: Bounds2) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

export function pointInRing(point: Vec2, ring: readonly Vec2[]) {
  let inside = false
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const [x, z] = ring[index]
    const [previousX, previousZ] = ring[previous]
    const intersects =
      z > point[1] !== previousZ > point[1] &&
      point[0] <
        ((previousX - x) * (point[1] - z)) / (previousZ - z || EPSILON) + x
    if (intersects) inside = !inside
  }
  return inside
}

export function pointInMultiPolygon(point: Vec2, multiPolygon: MultiPolygon) {
  return multiPolygon.some(
    (polygon) =>
      pointInRing(point, polygon[0]) &&
      !polygon.slice(1).some((hole) => pointInRing(point, hole))
  )
}

export function triangulateMultiPolygon(
  id: string,
  kind: GeometryDefinition["kind"],
  materialId: string,
  y: number,
  multiPolygon: MultiPolygon
): GeometryDefinition {
  const positions: number[] = []
  const indices: number[] = []

  for (const polygon of multiPolygon) {
    const vertices: number[] = []
    const holes: number[] = []
    for (const [ringIndex, ring] of polygon.entries()) {
      const usefulRing =
        ring.length > 1 &&
        Math.abs(ring[0][0] - ring[ring.length - 1][0]) < EPSILON &&
        Math.abs(ring[0][1] - ring[ring.length - 1][1]) < EPSILON
          ? ring.slice(0, -1)
          : ring
      if (ringIndex > 0) holes.push(vertices.length / 2)
      for (const [x, z] of usefulRing) vertices.push(x, z)
    }

    const vertexOffset = positions.length / 3
    for (let index = 0; index < vertices.length; index += 2) {
      positions.push(
        round(vertices[index]),
        round(y),
        round(vertices[index + 1])
      )
    }
    const triangles = earcut(vertices, holes, 2)
    for (let index = 0; index < triangles.length; index += 3) {
      const a = triangles[index]
      const b = triangles[index + 1]
      const c = triangles[index + 2]
      // Test the quantized coordinates that are actually serialized. Polygon
      // clipping occasionally emits sub-millimetre slivers at cell borders;
      // dropping those prevents zero-area or backwards faces after rounding.
      const ax = round(vertices[a * 2])
      const az = round(vertices[a * 2 + 1])
      const bx = round(vertices[b * 2])
      const bz = round(vertices[b * 2 + 1])
      const cx = round(vertices[c * 2])
      const cz = round(vertices[c * 2 + 1])
      const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      if (Math.abs(normalY) < 1e-8) continue
      if (normalY < 0) {
        indices.push(vertexOffset + a, vertexOffset + c, vertexOffset + b)
      } else {
        indices.push(vertexOffset + a, vertexOffset + b, vertexOffset + c)
      }
    }
  }

  return { id, kind, materialId, y, positions, indices }
}

export function triangleCentroid(
  positions: readonly number[],
  a: number,
  b: number,
  c: number
): Vec2 {
  return [
    (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3,
    (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3,
  ]
}
