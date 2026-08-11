import type {
  Bounds2,
  CellManifest,
  InstanceTransform,
  Vec2,
} from "../contracts/world.ts"
import { boundsIntersect, round } from "./geometry.ts"
import type { SampledRoad } from "./roads.ts"

export function cellIdAt(position: Vec2, cellSize: number) {
  const x = Math.floor(position[0] / cellSize)
  const z = Math.floor(position[1] / cellSize)
  return `cell.${x}.${z}`
}

export function cellBounds(cellId: string, cellSize: number): Bounds2 {
  const match = /^cell\.(-?\d+)\.(-?\d+)$/.exec(cellId)
  if (!match) throw new Error(`Invalid Journey cell id ${cellId}`)
  const x = Number(match[1])
  const z = Number(match[2])
  return [
    round(x * cellSize),
    round(z * cellSize),
    round((x + 1) * cellSize),
    round((z + 1) * cellSize),
  ]
}

export function cellsCoveringBounds(bounds: Bounds2, cellSize: number) {
  const ids: string[] = []
  const minX = Math.floor(bounds[0] / cellSize)
  const maxX = Math.floor((bounds[2] - 1e-6) / cellSize)
  const minZ = Math.floor(bounds[1] / cellSize)
  const maxZ = Math.floor((bounds[3] - 1e-6) / cellSize)
  for (let x = minX; x <= maxX; x += 1) {
    for (let z = minZ; z <= maxZ; z += 1) ids.push(`cell.${x}.${z}`)
  }
  return ids.sort()
}

export function nearestRoadDistrict(
  point: Vec2,
  roads: readonly SampledRoad[]
) {
  let districtId = roads[0]?.source.districtId ?? "town"
  let nearest = Number.POSITIVE_INFINITY
  for (const road of roads) {
    for (const candidate of road.points) {
      const squared =
        (candidate[0] - point[0]) ** 2 + (candidate[1] - point[1]) ** 2
      if (squared < nearest) {
        nearest = squared
        districtId = road.source.districtId
      }
    }
  }
  return districtId
}

export function createCellSkeletons(
  bounds: Bounds2,
  cellSize: number,
  roads: readonly SampledRoad[]
) {
  return cellsCoveringBounds(bounds, cellSize).map<CellManifest>((id) => {
    const cell = cellBounds(id, cellSize)
    const center: Vec2 = [(cell[0] + cell[2]) / 2, (cell[1] + cell[3]) / 2]
    return {
      id,
      districtId: nearestRoadDistrict(center, roads),
      bounds: cell,
      geometryIds: [],
      batchIds: [],
      colliderIds: [],
    }
  })
}

export function cellsIntersectingBounds(
  cells: readonly CellManifest[],
  bounds: Bounds2
) {
  return cells.filter((cell) => boundsIntersect(cell.bounds, bounds))
}

export function transformPosition(transform: InstanceTransform): Vec2 {
  return [transform[0], transform[2]]
}
