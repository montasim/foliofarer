import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import type {
  Bounds2,
  GeometryDefinition,
  InstanceBatch,
  InstanceTransform,
  MaterialDefinition,
  Vec2,
} from "../contracts/world.ts"
import {
  circlePolygon,
  distance,
  multiPolygonArea,
  pointInMultiPolygon,
  round,
} from "./geometry.ts"
import type { CompiledBuilding } from "./placement.ts"
import { createSeededRandom, hashString } from "./random.ts"
import type { SampledRoad } from "./roads.ts"
import { roadFrameAt } from "./roads.ts"
import { cellIdAt } from "./spatial.ts"

const { intersection, union } = polygonClipping

export interface CompiledCrosswalk {
  id: string
  roadId: string
  polygon: Polygon
  center: Vec2
  tangent: Vec2
  normal: Vec2
  rotationY: number
  width: number
}

interface FootprintPlacement {
  center: Vec2
  radius: number
}

function unitPlane(
  id: string,
  materialId: string,
  vertical = false
): GeometryDefinition {
  return {
    id,
    kind: "primitive",
    materialId,
    y: 0,
    positions: vertical
      ? [-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]
      : [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
    indices: vertical ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2],
  }
}

function unitBox(id: string, materialId: string): GeometryDefinition {
  return {
    id,
    kind: "primitive",
    materialId,
    y: 0,
    positions: [
      -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 1, -0.5,
      0.5, 1, -0.5, 0.5, 1, 0.5, -0.5, 1, 0.5,
    ],
    indices: [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2,
      3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
    ],
  }
}

function canopyGeometry(id: string, materialId: string): GeometryDefinition {
  return {
    id,
    kind: "primitive",
    materialId,
    y: 0,
    positions: [0, 1, 0, 0, -1, 0, -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1],
    indices: [
      0, 2, 3, 0, 3, 4, 0, 4, 5, 0, 5, 2, 1, 3, 2, 1, 4, 3, 1, 5, 4, 1, 2, 5,
    ],
  }
}

export function sceneryMaterials(): MaterialDefinition[] {
  return [
    {
      id: "environment.tree-trunk",
      kind: "standard",
      color: "#70533f",
      roughness: 0.92,
    },
    {
      id: "environment.tree-canopy",
      kind: "standard",
      color: "#4f7658",
      roughness: 0.9,
    },
    {
      id: "environment.grass",
      kind: "standard",
      color: "#6f8d66",
      roughness: 1,
    },
    {
      id: "environment.lamp",
      kind: "standard",
      color: "#173a38",
      roughness: 0.72,
    },
    {
      id: "marking.cream",
      kind: "unlit",
      color: "#e7e1cc",
      roughness: 0.8,
    },
  ]
}

export function sceneryGeometries(): GeometryDefinition[] {
  return [
    unitBox("primitive.tree-trunk", "environment.tree-trunk"),
    canopyGeometry("primitive.tree-canopy", "environment.tree-canopy"),
    unitPlane("primitive.grass", "environment.grass", true),
    unitBox("primitive.lamp", "environment.lamp"),
    unitPlane("primitive.lane-marker", "marking.cream"),
    unitPlane("primitive.crosswalk-stripe", "marking.cream"),
  ]
}

function overlapsProtected(footprint: Polygon, protectedSurface: MultiPolygon) {
  return multiPolygonArea(intersection([footprint], protectedSurface)) > 0.0005
}

function groupBatches(
  entries: {
    kind: InstanceBatch["kind"]
    geometryId: string
    materialId: string
    cellId: string
    transform: InstanceTransform
  }[]
) {
  const groups = new Map<string, InstanceBatch>()
  for (const entry of entries) {
    const id = `batch.${entry.kind}.${entry.cellId}`
    const batch = groups.get(id) ?? {
      id,
      kind: entry.kind,
      geometryId: entry.geometryId,
      materialId: entry.materialId,
      cellId: entry.cellId,
      transforms: [],
    }
    batch.transforms.push(entry.transform)
    groups.set(id, batch)
  }
  return [...groups.values()]
    .map((batch) => ({
      ...batch,
      transforms: batch.transforms.sort((a, b) => a[2] - b[2] || a[0] - b[0]),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function compileScenery(options: {
  seed: number
  bounds: Bounds2
  cellSize: number
  curbWidth: number
  sidewalkWidth: number
  roads: readonly SampledRoad[]
  streetOuter: MultiPolygon
  buildings: readonly CompiledBuilding[]
  crosswalks: readonly CompiledCrosswalk[]
}) {
  const { bounds, buildings, cellSize, crosswalks, roads, seed, streetOuter } =
    options
  const buildingPolygons = buildings.map(
    (building) => building.footprintPolygon
  )
  const accessPolygons = buildings.map((building) => building.accessPolygon)
  const protectedSurface =
    buildingPolygons.length + accessPolygons.length > 0
      ? union(streetOuter, ...buildingPolygons, ...accessPolygons)
      : streetOuter
  const entries: Parameters<typeof groupBatches>[0] = []
  const treeFootprints: FootprintPlacement[] = []
  const random = createSeededRandom(seed ^ hashString("vegetation"))

  const treeSpacing = 10
  for (let x = bounds[0] + treeSpacing / 2; x < bounds[2]; x += treeSpacing) {
    for (let z = bounds[1] + treeSpacing / 2; z < bounds[3]; z += treeSpacing) {
      if (random() > 0.42) continue
      const center: Vec2 = [
        x + (random() - 0.5) * treeSpacing * 0.48,
        z + (random() - 0.5) * treeSpacing * 0.48,
      ]
      const radius = 1.5 + random() * 0.8
      const footprint = circlePolygon(center, radius, 12)
      if (overlapsProtected(footprint, protectedSurface)) continue
      if (
        treeFootprints.some(
          (tree) => distance(tree.center, center) < tree.radius + radius + 1.2
        )
      ) {
        continue
      }
      treeFootprints.push({ center, radius })
      const cellId = cellIdAt(center, cellSize)
      const rotation = random() * Math.PI * 2
      const trunkHeight = 2.5 + random() * 1.1
      entries.push({
        kind: "tree-trunk",
        geometryId: "primitive.tree-trunk",
        materialId: "environment.tree-trunk",
        cellId,
        transform: [
          round(center[0]),
          0,
          round(center[1]),
          round(rotation),
          round(radius * 0.28),
          round(trunkHeight),
          round(radius * 0.28),
        ],
      })
      entries.push({
        kind: "tree-canopy",
        geometryId: "primitive.tree-canopy",
        materialId: "environment.tree-canopy",
        cellId,
        transform: [
          round(center[0]),
          round(trunkHeight + radius * 0.35),
          round(center[1]),
          round(rotation),
          round(radius),
          round(radius * 0.76),
          round(radius),
        ],
      })
    }
  }

  const grassRandom = createSeededRandom(seed ^ hashString("grass"))
  const grassSpacing = 5
  for (let x = bounds[0] + 2; x < bounds[2]; x += grassSpacing) {
    for (let z = bounds[1] + 2; z < bounds[3]; z += grassSpacing) {
      if (grassRandom() > 0.35) continue
      const center: Vec2 = [
        x + (grassRandom() - 0.5) * 2.4,
        z + (grassRandom() - 0.5) * 2.4,
      ]
      const radius = 0.45 + grassRandom() * 0.35
      if (overlapsProtected(circlePolygon(center, radius, 8), protectedSurface))
        continue
      if (
        treeFootprints.some(
          (tree) => distance(tree.center, center) < tree.radius + radius + 0.4
        )
      ) {
        continue
      }
      entries.push({
        kind: "grass",
        geometryId: "primitive.grass",
        materialId: "environment.grass",
        cellId: cellIdAt(center, cellSize),
        transform: [
          round(center[0]),
          0,
          round(center[1]),
          round(grassRandom() * Math.PI * 2),
          round(radius * 1.35),
          round(0.65 + grassRandom() * 0.4),
          round(radius * 1.35),
        ],
      })
    }
  }

  const lamps: FootprintPlacement[] = []
  for (const road of roads) {
    const interval = Math.max(
      1,
      Math.round(16 / (road.length / (road.points.length - 1)))
    )
    for (
      let index = interval;
      index < road.points.length - interval;
      index += interval
    ) {
      const progress = road.cumulativeLengths[index] / road.length
      const frame = roadFrameAt(road, progress)
      for (const side of [-1, 1] as const) {
        const offset =
          road.source.width / 2 +
          options.curbWidth +
          options.sidewalkWidth +
          0.48
        const center: Vec2 = [
          frame.center[0] + frame.normal[0] * side * offset,
          frame.center[1] + frame.normal[1] * side * offset,
        ]
        const footprint = circlePolygon(center, 0.22, 8)
        if (
          overlapsProtected(footprint, streetOuter) ||
          buildingPolygons.some(
            (polygon) =>
              multiPolygonArea(intersection([footprint], [polygon])) > 0.0005
          ) ||
          accessPolygons.some(
            (polygon) =>
              multiPolygonArea(intersection([footprint], [polygon])) > 0.0005
          ) ||
          lamps.some((lamp) => distance(lamp.center, center) < 4)
        ) {
          continue
        }
        lamps.push({ center, radius: 0.22 })
        entries.push({
          kind: "lamp",
          geometryId: "primitive.lamp",
          materialId: "environment.lamp",
          cellId: cellIdAt(center, cellSize),
          transform: [
            round(center[0]),
            0,
            round(center[1]),
            0,
            0.16,
            3.8,
            0.16,
          ],
        })
      }
    }
  }

  for (const road of roads) {
    const markerSpacing = 6
    const count = Math.floor(road.length / markerSpacing)
    for (let index = 1; index < count; index += 1) {
      const progress = index / count
      const frame = roadFrameAt(road, progress)
      if (
        crosswalks.some((crosswalk) =>
          pointInMultiPolygon(frame.center, [crosswalk.polygon])
        )
      ) {
        continue
      }
      entries.push({
        kind: "lane-marker",
        geometryId: "primitive.lane-marker",
        materialId: "marking.cream",
        cellId: cellIdAt(frame.center, cellSize),
        transform: [
          round(frame.center[0]),
          0.025,
          round(frame.center[1]),
          round(Math.atan2(frame.tangent[0], frame.tangent[1])),
          0.12,
          1,
          2.4,
        ],
      })
    }
  }

  for (const crosswalk of crosswalks) {
    const stripes = Math.max(3, Math.floor(crosswalk.width / 0.58))
    for (let index = 0; index < stripes; index += 1) {
      const offset =
        -crosswalk.width / 2 + ((index + 0.5) / stripes) * crosswalk.width
      const center: Vec2 = [
        crosswalk.center[0] + crosswalk.tangent[0] * offset,
        crosswalk.center[1] + crosswalk.tangent[1] * offset,
      ]
      const road = roads.find(
        (candidate) => candidate.source.id === crosswalk.roadId
      )
      if (!road) continue
      entries.push({
        kind: "crosswalk-stripe",
        geometryId: "primitive.crosswalk-stripe",
        materialId: "marking.cream",
        cellId: cellIdAt(center, cellSize),
        transform: [
          round(center[0]),
          0.03,
          round(center[1]),
          round(crosswalk.rotationY),
          round(road.source.width + 0.35),
          1,
          round(Math.max(0.22, crosswalk.width / stripes - 0.18)),
        ],
      })
    }
  }

  return {
    batches: groupBatches(entries),
    treeFootprints,
    protectedSurface,
  }
}
