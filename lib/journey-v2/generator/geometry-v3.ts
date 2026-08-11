import earcut from "earcut"
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping"

import type {
  GeometryDefinitionV3,
  MaterialDefinitionV3,
  Vec2,
} from "../contracts/world.ts"
import { polygonArea, round } from "./geometry.ts"

const EPSILON = 1e-6

export function triangulateMultiPolygonV3(options: {
  id: string
  kind: GeometryDefinitionV3["kind"]
  materialId: string
  y: number
  multiPolygon: MultiPolygon
}): GeometryDefinitionV3 {
  const positions: number[] = []
  const indices: number[] = []
  for (const polygon of options.multiPolygon) {
    const vertices: number[] = []
    const holes: number[] = []
    for (const [ringIndex, ring] of polygon.entries()) {
      const closed =
        ring.length > 1 &&
        Math.abs(ring[0][0] - ring[ring.length - 1][0]) < EPSILON &&
        Math.abs(ring[0][1] - ring[ring.length - 1][1]) < EPSILON
      const useful = closed ? ring.slice(0, -1) : ring
      if (ringIndex > 0) holes.push(vertices.length / 2)
      for (const [x, z] of useful) vertices.push(x, z)
    }
    const offset = positions.length / 3
    for (let index = 0; index < vertices.length; index += 2) {
      positions.push(
        round(vertices[index]),
        round(options.y),
        round(vertices[index + 1])
      )
    }
    const triangles = earcut(vertices, holes, 2)
    for (let index = 0; index < triangles.length; index += 3) {
      const a = triangles[index]
      const b = triangles[index + 1]
      const c = triangles[index + 2]
      const ax = round(vertices[a * 2])
      const az = round(vertices[a * 2 + 1])
      const bx = round(vertices[b * 2])
      const bz = round(vertices[b * 2 + 1])
      const cx = round(vertices[c * 2])
      const cz = round(vertices[c * 2 + 1])
      const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      if (Math.abs(normalY) < 1e-8) continue
      indices.push(
        offset + a,
        offset + (normalY > 0 ? b : c),
        offset + (normalY > 0 ? c : b)
      )
    }
  }
  return {
    id: options.id,
    kind: options.kind,
    materialId: options.materialId,
    y: options.y,
    positions,
    indices,
  }
}

export function extrudeFootprintV3(options: {
  id: string
  materialId: string
  footprint: Polygon
  baseHeight: number
  height: number
}): GeometryDefinitionV3 {
  const ring = options.footprint[0].slice(0, -1)
  const positions: number[] = []
  const indices: number[] = []
  const top = options.baseHeight + options.height
  for (const [x, z] of ring)
    positions.push(round(x), round(options.baseHeight), round(z))
  for (const [x, z] of ring) positions.push(round(x), round(top), round(z))
  const count = ring.length
  const counterClockwise = polygonArea(ring) > 0
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count
    if (counterClockwise) {
      indices.push(
        index,
        count + next,
        next,
        index,
        count + index,
        count + next
      )
    } else {
      indices.push(
        index,
        next,
        count + next,
        index,
        count + next,
        count + index
      )
    }
  }
  for (let index = 1; index < count - 1; index += 1) {
    indices.push(
      count,
      counterClockwise ? count + index + 1 : count + index,
      counterClockwise ? count + index : count + index + 1
    )
  }
  return {
    id: options.id,
    kind: "building",
    materialId: options.materialId,
    y: 0,
    positions,
    indices,
  }
}

export function polygonFromPoints(points: readonly Vec2[]): Polygon {
  const ring: Ring = points.map(([x, z]) => [round(x, 5), round(z, 5)])
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
  return [ring]
}

export const V3_MATERIALS: MaterialDefinitionV3[] = [
  {
    id: "terrain.monsoon",
    kind: "toon",
    color: "#76ab88",
    roughness: 1,
    vertexColors: true,
  },
  {
    id: "surface.road-summer",
    kind: "unlit",
    color: "#a8b0b0",
    roughness: 0.96,
    vertexColors: false,
  },
  {
    id: "surface.road-marking",
    kind: "unlit",
    color: "#f5ecd8",
    roughness: 0.92,
    vertexColors: false,
  },
  {
    id: "surface.access-sand",
    kind: "standard",
    color: "#e3cea2",
    roughness: 0.98,
    vertexColors: false,
  },
  {
    id: "surface.road-verge",
    kind: "toon",
    color: "#ffffff",
    roughness: 1,
    vertexColors: true,
  },
  {
    id: "surface.forecourt-detail",
    kind: "toon",
    color: "#ffffff",
    roughness: 0.98,
    vertexColors: true,
  },
  {
    id: "surface.bridge-deck",
    kind: "standard",
    color: "#8b765d",
    roughness: 0.9,
    vertexColors: false,
  },
  {
    id: "surface.bridge-rail",
    kind: "toon",
    color: "#e0cda2",
    roughness: 0.92,
    vertexColors: false,
  },
  {
    id: "surface.bridge-support",
    kind: "toon",
    color: "#6f6253",
    roughness: 0.98,
    vertexColors: false,
  },
  {
    id: "building.plaster-warm",
    kind: "toon",
    color: "#d7c6a4",
    roughness: 0.92,
    vertexColors: false,
  },
  {
    id: "building.architecture",
    kind: "toon",
    color: "#ffffff",
    roughness: 0.92,
    vertexColors: true,
  },
  {
    id: "building.plaster-sage",
    kind: "toon",
    color: "#a9b9a5",
    roughness: 0.94,
    vertexColors: false,
  },
  {
    id: "building.plaster-cool",
    kind: "toon",
    color: "#b8c3bd",
    roughness: 0.92,
    vertexColors: false,
  },
  {
    id: "building.brick-sun",
    kind: "toon",
    color: "#b96f4f",
    roughness: 0.96,
    vertexColors: false,
  },
  {
    id: "building.roof-coral",
    kind: "toon",
    color: "#94646b",
    roughness: 0.9,
    vertexColors: false,
  },
  {
    id: "building.roof-slate",
    kind: "toon",
    color: "#5e728a",
    roughness: 0.86,
    vertexColors: false,
  },
  {
    id: "building.roof-tin",
    kind: "toon",
    color: "#778c8e",
    roughness: 0.88,
    vertexColors: false,
  },
  {
    id: "building.trim-cream",
    kind: "toon",
    color: "#eadfc8",
    roughness: 0.9,
    vertexColors: false,
  },
  {
    id: "building.trim-ink",
    kind: "toon",
    color: "#214a52",
    roughness: 0.86,
    vertexColors: false,
  },
  {
    id: "environment.trunk",
    kind: "toon",
    color: "#76543b",
    roughness: 1,
    vertexColors: false,
  },
  {
    id: "environment.foliage",
    kind: "toon",
    color: "#2c8365",
    roughness: 1,
    vertexColors: false,
  },
  {
    id: "environment.grass",
    kind: "toon",
    color: "#76ab88",
    roughness: 1,
    vertexColors: false,
  },
  {
    id: "environment.rock",
    kind: "toon",
    color: "#857e6d",
    roughness: 1,
    vertexColors: false,
  },
]
