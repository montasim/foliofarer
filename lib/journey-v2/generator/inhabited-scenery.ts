import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import type {
  AuthoredWorldV3,
  BridgeManifestV3,
  CellManifestV3,
  ColliderManifest,
  GeometryDefinitionV3,
  InstanceBatchV3,
  InstanceTransform,
  MaterialDefinitionV3,
  PortfolioCheckpointManifestV3,
  Vec2,
  Vec3,
  WaterBodyManifestV3,
} from "../contracts/world.ts"
import type { CompiledEnvironmentalBuildingV3 } from "./building-kit.ts"
import {
  distance,
  multiPolygonArea,
  orientedRectangle,
  pointInMultiPolygon,
  round,
} from "./geometry.ts"
import { polygonFromPoints } from "./geometry-v3.ts"
import { hashString, createSeededRandom } from "./random.ts"
import { createRoadSurfaces, roadFrameAt, type SampledRoad } from "./roads.ts"
import { cellIdAtV3, type TerrainFieldV3 } from "./terrain.ts"
import { ROAD_VERGE_WIDTH_V3 } from "./bridges.ts"

const { intersection } = polygonClipping

const STATIC_MATERIAL_ID = "environment.inhabited-static"

export const DESTINATION_COMPOUND_TARGET_SETBACKS_V3 = {
  side: 10,
  front: 8.5,
  back: 8.5,
} as const

const DESTINATION_COMPOUND_GATE_WIDTH_V3 = 6.4
const FENCE_SAFETY_WIDTH_V3 = 0.22
const FENCE_SAFETY_CHUNK_LENGTH_V3 = 0.8
const FENCE_RENDER_HALF_THICKNESS_V3 = 0.06
export const AMBIENT_COMPOUND_TARGET_SETBACKS_V3 = {
  side: 4.2,
  front: 5.2,
  back: 3.6,
} as const
export const AMBIENT_COMPOUND_GATE_WIDTH_V3 = 4.2

export const INHABITED_SCENERY_MATERIALS_V3: MaterialDefinitionV3[] = [
  {
    id: STATIC_MATERIAL_ID,
    kind: "toon",
    color: "#ffffff",
    roughness: 0.98,
    vertexColors: true,
  },
]

const COLORS = {
  contact: "#466d5c",
  wetEarth: "#79644f",
  dryEarth: "#c7ab7d",
  plaster: "#cdbf9f",
  plasterCool: "#aebbb2",
  brick: "#a75f45",
  timber: "#72533a",
  darkTimber: "#4f3c31",
  compoundTimber: "#76573d",
  compoundDarkTimber: "#513c31",
  ambientFenceTimber: "#806247",
  ambientFencePost: "#59463a",
  bicycleRubber: "#203b3e",
  bicycleFrame: "#b55f43",
  cottageTrim: "#e1d2b1",
  shopAwning: "#6d8587",
  shedTin: "#879b98",
  tin: "#778c8e",
  tinLight: "#9aacab",
  ink: "#163f47",
  cream: "#e8d9b8",
  terracotta: "#c76343",
  plantPot: "#a85f42",
  wire: "#293b3d",
  stone: "#827d70",
  hay: "#c5a465",
} as const

type LinearColor = readonly [number, number, number]

interface MeshBuffer {
  positions: number[]
  indices: number[]
  colors: number[]
}

interface Frame2 {
  origin: Vec2
  u: Vec2
  v: Vec2
}

interface CompoundFenceSetbacks {
  side: number
  front: number
  back: number
}

interface PlannedFenceSegment {
  edge: "front-left" | "front-right" | "back" | "left" | "right"
  start: Vec2
  end: Vec2
  polygon: Polygon
}

interface PlannedCompoundFence extends CompoundFenceSetbacks {
  buildingId: string
  gateWidth: number
  envelope: Polygon
  segments: PlannedFenceSegment[]
  omittedEdges: string[]
}

interface BatchEntry {
  kind: InstanceBatchV3["kind"]
  speciesId: InstanceBatchV3["speciesId"]
  lod: InstanceBatchV3["lod"]
  geometryId: string
  materialId: string
  cellId: string
  transform: InstanceTransform
  densityRank: number
  color: string
}

interface AmbientSite {
  id: string
  kind: "cottage" | "shop" | "shed"
  center: Vec2
  tangent: Vec2
  outward: Vec2
  footprint: Polygon
  envelope: Polygon
  width: number
  depth: number
  baseHeight: number
  cellId: string
}

export interface InhabitedSceneryResultV3 {
  materials: MaterialDefinitionV3[]
  geometries: GeometryDefinitionV3[]
  instanceBatches: InstanceBatchV3[]
  colliders: ColliderManifest[]
  /**
   * Spatial-only masks for vegetation compilers. They contain no portfolio
   * fields and allow trees and grass to respect the inhabited plots.
   */
  vegetationExclusionPolygons: Vec2[][]
  validation: {
    valid: true
    counts: {
      ambientStructures: number
      buildingFrontages: number
      compoundFences: number
      utilityPoles: number
      wireSpans: number
      drainageSegments: number
      plantInstances: number
      waterEdgeClusters: number
      rareCycles: number
      cellMeshes: number
      colliders: number
    }
    warnings: string[]
  }
}

function color(hex: string): LinearColor {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ]
}

function addVertex(buffer: MeshBuffer, point: Vec3, tint: string) {
  const index = buffer.positions.length / 3
  buffer.positions.push(round(point[0]), round(point[1]), round(point[2]))
  const [red, green, blue] = color(tint)
  buffer.colors.push(red, green, blue)
  return index
}

function addQuad(
  buffer: MeshBuffer,
  points: readonly [Vec3, Vec3, Vec3, Vec3],
  tint: string
) {
  const vertices = points.map((point) => addVertex(buffer, point, tint))
  buffer.indices.push(
    vertices[0],
    vertices[1],
    vertices[2],
    vertices[0],
    vertices[2],
    vertices[3]
  )
}

function worldPoint(
  frame: Frame2,
  localX: number,
  y: number,
  localZ: number
): Vec3 {
  return [
    frame.origin[0] + frame.u[0] * localX + frame.v[0] * localZ,
    y,
    frame.origin[1] + frame.u[1] * localX + frame.v[1] * localZ,
  ]
}

function worldPoint2(frame: Frame2, point: Vec2): Vec2 {
  return [
    frame.origin[0] + frame.u[0] * point[0] + frame.v[0] * point[1],
    frame.origin[1] + frame.u[1] * point[0] + frame.v[1] * point[1],
  ]
}

function correctReflectedFrameWinding(
  buffer: MeshBuffer,
  frame: Frame2,
  firstIndex: number
) {
  const determinant = frame.u[0] * frame.v[1] - frame.u[1] * frame.v[0]
  if (determinant >= 0) return
  for (let index = firstIndex; index < buffer.indices.length; index += 3) {
    const second = buffer.indices[index + 1]
    buffer.indices[index + 1] = buffer.indices[index + 2]
    buffer.indices[index + 2] = second
  }
}

function addBox(
  buffer: MeshBuffer,
  frame: Frame2,
  center: readonly [x: number, y: number, z: number],
  size: readonly [width: number, height: number, depth: number],
  tint: string
) {
  const [centerX, centerY, centerZ] = center
  const [width, height, depth] = size
  const left = centerX - width / 2
  const right = centerX + width / 2
  const bottom = centerY - height / 2
  const top = centerY + height / 2
  const front = centerZ - depth / 2
  const back = centerZ + depth / 2
  const point = (x: number, y: number, z: number) => worldPoint(frame, x, y, z)
  const firstIndex = buffer.indices.length
  addQuad(
    buffer,
    [
      point(left, bottom, front),
      point(left, top, front),
      point(right, top, front),
      point(right, bottom, front),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(left, bottom, back),
      point(right, bottom, back),
      point(right, top, back),
      point(left, top, back),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(left, bottom, front),
      point(left, bottom, back),
      point(left, top, back),
      point(left, top, front),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(right, bottom, front),
      point(right, top, front),
      point(right, top, back),
      point(right, bottom, back),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(left, bottom, front),
      point(right, bottom, front),
      point(right, bottom, back),
      point(left, bottom, back),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(left, top, front),
      point(left, top, back),
      point(right, top, back),
      point(right, top, front),
    ],
    tint
  )
  correctReflectedFrameWinding(buffer, frame, firstIndex)
}

function addGableRoof(
  buffer: MeshBuffer,
  frame: Frame2,
  baseY: number,
  width: number,
  depth: number,
  rise: number,
  tint: string
) {
  const firstIndex = buffer.indices.length
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const points = [
    worldPoint(frame, -halfWidth, baseY, -halfDepth),
    worldPoint(frame, halfWidth, baseY, -halfDepth),
    worldPoint(frame, -halfWidth, baseY, halfDepth),
    worldPoint(frame, halfWidth, baseY, halfDepth),
    worldPoint(frame, 0, baseY + rise, -halfDepth),
    worldPoint(frame, 0, baseY + rise, halfDepth),
  ] as const
  const offset = buffer.positions.length / 3
  for (const point of points) addVertex(buffer, point, tint)
  buffer.indices.push(
    offset,
    offset + 1,
    offset + 4,
    offset + 2,
    offset + 5,
    offset + 3,
    offset,
    offset + 4,
    offset + 5,
    offset,
    offset + 5,
    offset + 2,
    offset + 1,
    offset + 3,
    offset + 5,
    offset + 1,
    offset + 5,
    offset + 4
  )
  correctReflectedFrameWinding(buffer, frame, firstIndex)
}

function addHippedRoof(
  buffer: MeshBuffer,
  frame: Frame2,
  baseY: number,
  width: number,
  depth: number,
  rise: number,
  tint: string
) {
  const firstIndex = buffer.indices.length
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const halfRidge = Math.max(0.45, halfWidth * 0.42)
  const points = [
    worldPoint(frame, -halfWidth, baseY, -halfDepth),
    worldPoint(frame, halfWidth, baseY, -halfDepth),
    worldPoint(frame, -halfWidth, baseY, halfDepth),
    worldPoint(frame, halfWidth, baseY, halfDepth),
    worldPoint(frame, -halfRidge, baseY + rise, 0),
    worldPoint(frame, halfRidge, baseY + rise, 0),
  ] as const
  const offset = buffer.positions.length / 3
  for (const point of points) addVertex(buffer, point, tint)
  buffer.indices.push(
    offset,
    offset + 4,
    offset + 5,
    offset,
    offset + 5,
    offset + 1,
    offset + 2,
    offset + 3,
    offset + 5,
    offset + 2,
    offset + 5,
    offset + 4,
    offset,
    offset + 2,
    offset + 4,
    offset + 1,
    offset + 5,
    offset + 3
  )
  correctReflectedFrameWinding(buffer, frame, firstIndex)
}

function addLeanToRoof(
  buffer: MeshBuffer,
  frame: Frame2,
  frontY: number,
  width: number,
  depth: number,
  rise: number,
  thickness: number,
  tint: string
) {
  const firstIndex = buffer.indices.length
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const point = (x: number, y: number, z: number) => worldPoint(frame, x, y, z)
  const lowerFront = frontY
  const lowerBack = frontY + rise
  addQuad(
    buffer,
    [
      point(-halfWidth, lowerFront, -halfDepth),
      point(-halfWidth, lowerFront + thickness, -halfDepth),
      point(halfWidth, lowerFront + thickness, -halfDepth),
      point(halfWidth, lowerFront, -halfDepth),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(-halfWidth, lowerBack, halfDepth),
      point(halfWidth, lowerBack, halfDepth),
      point(halfWidth, lowerBack + thickness, halfDepth),
      point(-halfWidth, lowerBack + thickness, halfDepth),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(-halfWidth, lowerFront, -halfDepth),
      point(-halfWidth, lowerBack, halfDepth),
      point(-halfWidth, lowerBack + thickness, halfDepth),
      point(-halfWidth, lowerFront + thickness, -halfDepth),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(halfWidth, lowerFront, -halfDepth),
      point(halfWidth, lowerFront + thickness, -halfDepth),
      point(halfWidth, lowerBack + thickness, halfDepth),
      point(halfWidth, lowerBack, halfDepth),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(-halfWidth, lowerFront, -halfDepth),
      point(halfWidth, lowerFront, -halfDepth),
      point(halfWidth, lowerBack, halfDepth),
      point(-halfWidth, lowerBack, halfDepth),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      point(-halfWidth, lowerFront + thickness, -halfDepth),
      point(-halfWidth, lowerBack + thickness, halfDepth),
      point(halfWidth, lowerBack + thickness, halfDepth),
      point(halfWidth, lowerFront + thickness, -halfDepth),
    ],
    tint
  )
  correctReflectedFrameWinding(buffer, frame, firstIndex)
}

function addVerticalPrism(
  buffer: MeshBuffer,
  center: Vec2,
  bottom: number,
  height: number,
  radius: number,
  sides: number,
  tint: string
) {
  const vertices: Vec3[] = []
  for (const y of [bottom, bottom + height]) {
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2
      vertices.push([
        center[0] + Math.cos(angle) * radius,
        y,
        center[1] + Math.sin(angle) * radius,
      ])
    }
  }
  const offset = buffer.positions.length / 3
  for (const vertex of vertices) addVertex(buffer, vertex, tint)
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    buffer.indices.push(
      offset + index,
      offset + sides + next,
      offset + next,
      offset + index,
      offset + sides + index,
      offset + sides + next
    )
  }
}

function addRod(
  buffer: MeshBuffer,
  start: Vec3,
  end: Vec3,
  radius: number,
  tint: string,
  complete = false
) {
  const direction: Vec3 = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2],
  ]
  const length = Math.hypot(...direction)
  if (length < 1e-5) return
  const forward: Vec3 = [
    direction[0] / length,
    direction[1] / length,
    direction[2] / length,
  ]
  const reference: Vec3 = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const side: Vec3 = [
    forward[1] * reference[2] - forward[2] * reference[1],
    forward[2] * reference[0] - forward[0] * reference[2],
    forward[0] * reference[1] - forward[1] * reference[0],
  ]
  const sideLength = Math.hypot(...side)
  const u: Vec3 = [
    (side[0] / sideLength) * radius,
    (side[1] / sideLength) * radius,
    (side[2] / sideLength) * radius,
  ]
  const v: Vec3 = [
    forward[1] * u[2] - forward[2] * u[1],
    forward[2] * u[0] - forward[0] * u[2],
    forward[0] * u[1] - forward[1] * u[0],
  ]
  const corner = (point: Vec3, signU: number, signV: number): Vec3 => [
    point[0] + u[0] * signU + v[0] * signV,
    point[1] + u[1] * signU + v[1] * signV,
    point[2] + u[2] * signU + v[2] * signV,
  ]
  addQuad(
    buffer,
    [
      corner(start, -1, -1),
      corner(start, -1, 1),
      corner(end, -1, 1),
      corner(end, -1, -1),
    ],
    tint
  )
  addQuad(
    buffer,
    [
      corner(start, 1, -1),
      corner(end, 1, -1),
      corner(end, 1, 1),
      corner(start, 1, 1),
    ],
    tint
  )
  if (complete) {
    addQuad(
      buffer,
      [
        corner(start, -1, -1),
        corner(end, -1, -1),
        corner(end, 1, -1),
        corner(start, 1, -1),
      ],
      tint
    )
    addQuad(
      buffer,
      [
        corner(start, -1, 1),
        corner(start, 1, 1),
        corner(end, 1, 1),
        corner(end, -1, 1),
      ],
      tint
    )
  }
}

function addCable(
  buffer: MeshBuffer,
  start: Vec3,
  end: Vec3,
  lateral: Vec2,
  lateralOffset: number
) {
  let previous: Vec3 | null = null
  const steps = 6
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps
    const sag = Math.sin(progress * Math.PI) * 0.38
    const point: Vec3 = [
      start[0] + (end[0] - start[0]) * progress + lateral[0] * lateralOffset,
      start[1] + (end[1] - start[1]) * progress - sag,
      start[2] + (end[2] - start[2]) * progress + lateral[1] * lateralOffset,
    ]
    if (previous) addRod(buffer, previous, point, 0.025, COLORS.wire)
    previous = point
  }
}

function pointSegmentDistance(point: Vec2, start: Vec2, end: Vec2) {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const squared = dx * dx + dz * dz
  if (squared < 1e-8) return distance(point, start)
  const amount = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / squared
    )
  )
  return distance(point, [start[0] + dx * amount, start[1] + dz * amount])
}

function distanceToPolygon(point: Vec2, polygon: Polygon) {
  if (pointInMultiPolygon(point, [polygon])) return 0
  let nearest = Number.POSITIVE_INFINITY
  for (const ring of polygon) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      nearest = Math.min(
        nearest,
        pointSegmentDistance(
          point,
          [ring[index][0], ring[index][1]],
          [ring[index + 1][0], ring[index + 1][1]]
        )
      )
    }
  }
  return nearest
}

function distanceToRoad(point: Vec2, road: SampledRoad) {
  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < road.points.length - 1; index += 1) {
    nearest = Math.min(
      nearest,
      pointSegmentDistance(point, road.points[index], road.points[index + 1])
    )
  }
  return nearest
}

function waterMultiPolygon(water: WaterBodyManifestV3): MultiPolygon {
  if (water.polygon.length === 0) return []
  if (typeof water.polygon[0][0] === "number") {
    return [polygonFromPoints(water.polygon as Vec2[])]
  }
  return [(water.polygon as Vec2[][]).map((ring) => polygonFromPoints(ring)[0])]
}

function overlaps(a: Polygon, b: Polygon | MultiPolygon) {
  const right = Array.isArray(b[0]?.[0]?.[0]) ? b : [b]
  return multiPolygonArea(intersection([a], right as MultiPolygon)) > 0.001
}

function pointInBounds(point: Vec2, world: AuthoredWorldV3, margin = 3) {
  return (
    point[0] >= world.bounds[0] + margin &&
    point[0] <= world.bounds[2] - margin &&
    point[1] >= world.bounds[1] + margin &&
    point[1] <= world.bounds[3] - margin
  )
}

function isPointClear(options: {
  point: Vec2
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  waters: readonly MultiPolygon[]
  bridges: readonly BridgeManifestV3[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  additionalExclusions: readonly Polygon[]
  roadClearance: number
}) {
  if (!pointInBounds(options.point, options.world, 2.2)) return false
  if (
    options.waters.some((water) => pointInMultiPolygon(options.point, water))
  ) {
    return false
  }
  if (
    options.roads.some(
      (road) =>
        distanceToRoad(options.point, road) <
        road.source.width / 2 + options.roadClearance
    )
  ) {
    return false
  }
  if (
    options.buildings.some(
      (building) =>
        distanceToPolygon(options.point, building.footprint) < 2.1 ||
        distanceToPolygon(options.point, building.accessPolygon) < 1.4
    )
  ) {
    return false
  }
  if (
    options.bridges.some(
      (bridge) =>
        distanceToPolygon(
          options.point,
          polygonFromPoints(bridge.deckPolygon)
        ) < 2.2
    )
  ) {
    return false
  }
  if (
    options.checkpoints.some(
      (checkpoint) =>
        distance(options.point, [
          checkpoint.position[0],
          checkpoint.position[2],
        ]) <
        checkpoint.interactionRadius + 2.1
    )
  ) {
    return false
  }
  return options.additionalExclusions.every(
    (polygon) => distanceToPolygon(options.point, polygon) >= 0.8
  )
}

function siteIsClear(options: {
  footprint: Polygon
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  waters: readonly MultiPolygon[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  existing: readonly Polygon[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
}) {
  const ring = options.footprint[0].slice(0, -1)
  if (
    ring.some((point) => !pointInBounds([point[0], point[1]], options.world, 4))
  ) {
    return false
  }
  if (options.waters.some((water) => overlaps(options.footprint, water))) {
    return false
  }
  if (
    options.buildings.some(
      (building) =>
        overlaps(options.footprint, building.footprint) ||
        overlaps(options.footprint, building.accessPolygon)
    )
  ) {
    return false
  }
  if (
    options.existing.some((footprint) => overlaps(options.footprint, footprint))
  ) {
    return false
  }
  const center: Vec2 = [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ]
  if (
    options.roads.some(
      (road) => distanceToRoad(center, road) < road.source.width / 2 + 5.2
    )
  ) {
    return false
  }
  return options.checkpoints.every(
    (checkpoint) =>
      distance(center, [checkpoint.position[0], checkpoint.position[2]]) >
      checkpoint.interactionRadius + 7
  )
}

function isDestinationCompoundBuilding(
  building: CompiledEnvironmentalBuildingV3
) {
  return (
    building.source.archetype === "schoolhouse" ||
    building.source.archetype === "academic-hall" ||
    building.source.archetype === "engineering-campus" ||
    building.source.archetype === "community-hall"
  )
}

function compoundEnvelope(
  building: CompiledEnvironmentalBuildingV3,
  setbacks: CompoundFenceSetbacks
) {
  const depth =
    building.source.footprint[1] +
    setbacks.front +
    setbacks.back +
    FENCE_RENDER_HALF_THICKNESS_V3 * 2
  const centerShift = (setbacks.back - setbacks.front) / 2
  const center: Vec2 = [
    building.center[0] + building.outward[0] * centerShift,
    building.center[1] + building.outward[1] * centerShift,
  ]
  return orientedRectangle(
    center,
    building.tangent,
    building.source.footprint[0] +
      (setbacks.side + FENCE_RENDER_HALF_THICKNESS_V3) * 2,
    depth
  )
}

function segmentPolygon(start: Vec2, end: Vec2) {
  return orientedRectangle(
    [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    [end[0] - start[0], end[1] - start[1]],
    distance(start, end) + FENCE_SAFETY_WIDTH_V3,
    FENCE_SAFETY_WIDTH_V3
  )
}

function splitFenceEdge(start: Vec2, end: Vec2) {
  const length = distance(start, end)
  const count = Math.max(1, Math.ceil(length / FENCE_SAFETY_CHUNK_LENGTH_V3))
  return Array.from({ length: count }, (_, index) => {
    const from = index / count
    const to = (index + 1) / count
    return {
      start: [
        start[0] + (end[0] - start[0]) * from,
        start[1] + (end[1] - start[1]) * from,
      ] as Vec2,
      end: [
        start[0] + (end[0] - start[0]) * to,
        start[1] + (end[1] - start[1]) * to,
      ] as Vec2,
    }
  })
}

function checkpointCorridor(
  building: CompiledEnvironmentalBuildingV3,
  checkpoint: PortfolioCheckpointManifestV3
) {
  const roadCenter: Vec2 = [
    (checkpoint.sharedRoadBoundary[0][0] +
      checkpoint.sharedRoadBoundary[1][0]) /
      2,
    (checkpoint.sharedRoadBoundary[0][2] +
      checkpoint.sharedRoadBoundary[1][2]) /
      2,
  ]
  const entrance: Vec2 = [building.entrance[0], building.entrance[2]]
  return orientedRectangle(
    [(roadCenter[0] + entrance[0]) / 2, (roadCenter[1] + entrance[1]) / 2],
    [entrance[0] - roadCenter[0], entrance[1] - roadCenter[1]],
    distance(roadCenter, entrance),
    6
  )
}

function planDestinationCompoundFences(options: {
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  waters: readonly MultiPolygon[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
}) {
  const target = DESTINATION_COMPOUND_TARGET_SETBACKS_V3
  const roadAndVerge = createRoadSurfaces(
    options.roads,
    0,
    ROAD_VERGE_WIDTH_V3
  ).outer
  const checkpointCorridors = options.checkpoints.flatMap((checkpoint) => {
    const building = options.buildings.find(
      (candidate) => candidate.source.id === checkpoint.arrivalBuildingId
    )
    return building
      ? [
          {
            buildingId: building.source.id,
            polygon: checkpointCorridor(building, checkpoint),
          },
        ]
      : []
  })
  const occupiedFenceSegments: Polygon[] = []
  const plans: PlannedCompoundFence[] = []

  const segmentIsSafe = (
    polygon: Polygon,
    worldStart: Vec2,
    worldEnd: Vec2,
    building: CompiledEnvironmentalBuildingV3
  ) => {
    if (
      polygon[0]
        .slice(0, -1)
        .some((point) => !pointInBounds([point[0], point[1]], options.world, 0))
    ) {
      return false
    }
    if (multiPolygonArea(intersection([polygon], roadAndVerge)) > 0.001) {
      return false
    }
    if (options.waters.some((water) => overlaps(polygon, water))) return false
    if (
      options.buildings.some(
        (candidate) =>
          candidate.source.id !== building.source.id &&
          (overlaps(polygon, candidate.footprint) ||
            overlaps(polygon, candidate.accessPolygon))
      )
    ) {
      return false
    }
    if (
      checkpointCorridors.some((corridor) =>
        overlaps(polygon, corridor.polygon)
      )
    ) {
      return false
    }
    if (
      options.checkpoints.some(
        (checkpoint) =>
          pointSegmentDistance(
            [checkpoint.position[0], checkpoint.position[2]],
            worldStart,
            worldEnd
          ) <
          checkpoint.interactionRadius + FENCE_SAFETY_WIDTH_V3 / 2
      )
    ) {
      return false
    }
    return occupiedFenceSegments.every(
      (occupied) => !overlaps(polygon, occupied)
    )
  }

  for (const building of options.buildings
    .filter(isDestinationCompoundBuilding)
    .sort((a, b) => a.source.id.localeCompare(b.source.id))) {
    const frame: Frame2 = {
      origin: building.center,
      u: building.tangent,
      v: building.outward,
    }
    const segments: PlannedFenceSegment[] = []
    const omittedEdges: string[] = []
    for (const edge of compoundFenceLocalEdges(
      building.source.footprint[0],
      building.source.footprint[1],
      target,
      DESTINATION_COMPOUND_GATE_WIDTH_V3
    )) {
      const chunks = splitFenceEdge(edge.start, edge.end)
      const safe = chunks.map((chunk) => {
        const worldStart = worldPoint2(frame, chunk.start)
        const worldEnd = worldPoint2(frame, chunk.end)
        const polygon = segmentPolygon(worldStart, worldEnd)
        return {
          ...chunk,
          polygon,
          safe: segmentIsSafe(polygon, worldStart, worldEnd, building),
        }
      })
      let safeChunkCount = 0
      let runStart = -1
      for (let index = 0; index <= safe.length; index += 1) {
        const chunk = safe[index]
        if (chunk?.safe) {
          safeChunkCount += 1
          if (runStart < 0) runStart = index
          continue
        }
        if (runStart < 0) continue
        const runEnd = index - 1
        const start = safe[runStart].start
        const end = safe[runEnd].end
        if (distance(start, end) >= 1.6) {
          const worldStart = worldPoint2(frame, start)
          const worldEnd = worldPoint2(frame, end)
          const polygon = segmentPolygon(worldStart, worldEnd)
          segments.push({ edge: edge.edge, start, end, polygon })
        }
        runStart = -1
      }
      if (safeChunkCount < safe.length) {
        omittedEdges.push(
          safeChunkCount === 0 ? edge.edge : `${edge.edge}:partial`
        )
      }
    }
    plans.push({
      buildingId: building.source.id,
      ...target,
      gateWidth: DESTINATION_COMPOUND_GATE_WIDTH_V3,
      envelope: compoundEnvelope(building, target),
      segments,
      omittedEdges,
    })
    occupiedFenceSegments.push(...segments.map((segment) => segment.polygon))
  }

  return plans
}

function cellBuffer(
  buffers: Map<string, MeshBuffer>,
  cellId: string
): MeshBuffer {
  const existing = buffers.get(cellId)
  if (existing) return existing
  const created = { positions: [], indices: [], colors: [] }
  buffers.set(cellId, created)
  return created
}

function addGrounding(
  buffer: MeshBuffer,
  frame: Frame2,
  baseHeight: number,
  width: number,
  depth: number
) {
  addBox(
    buffer,
    frame,
    [0, baseHeight + 0.014, 0],
    [width + 0.48, 0.028, depth + 0.48],
    COLORS.contact
  )
}

function addFenceLine(
  buffer: MeshBuffer,
  frame: Frame2,
  start: Vec2,
  end: Vec2,
  baseHeight: number,
  tints: {
    posts: string
    rails: string
  } = {
    posts: COLORS.darkTimber,
    rails: COLORS.timber,
  }
) {
  const length = distance(start, end)
  const steps = Math.max(1, Math.ceil(length / 2.5))
  for (let index = 0; index <= steps; index += 1) {
    const progress = index / steps
    const x = start[0] + (end[0] - start[0]) * progress
    const z = start[1] + (end[1] - start[1]) * progress
    addBox(
      buffer,
      frame,
      [x, baseHeight + 0.62, z],
      [0.12, 1.24, 0.12],
      tints.posts
    )
  }
  const centerX = (start[0] + end[0]) / 2
  const centerZ = (start[1] + end[1]) / 2
  const horizontal = Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1])
  for (const y of [0.42, 0.9]) {
    addBox(
      buffer,
      frame,
      [centerX, baseHeight + y, centerZ],
      horizontal ? [length, 0.09, 0.09] : [0.09, 0.09, length],
      tints.rails
    )
  }
}

function compoundFenceLocalEdges(
  width: number,
  depth: number,
  setbacks: CompoundFenceSetbacks,
  gateWidth: number
) {
  // Setbacks are clear gaps from the footprint to the nearest rendered
  // surface. Move the rail centerline outward by the widest post half-width.
  const halfWidth = width / 2 + setbacks.side + FENCE_RENDER_HALF_THICKNESS_V3
  const front = -depth / 2 - setbacks.front - FENCE_RENDER_HALF_THICKNESS_V3
  const back = depth / 2 + setbacks.back + FENCE_RENDER_HALF_THICKNESS_V3
  const halfGate = Math.min(halfWidth - 0.6, gateWidth / 2)
  return [
    {
      edge: "back" as const,
      start: [-halfWidth, back] as Vec2,
      end: [halfWidth, back] as Vec2,
    },
    {
      edge: "front-left" as const,
      start: [-halfWidth, front] as Vec2,
      end: [-halfGate, front] as Vec2,
    },
    {
      edge: "front-right" as const,
      start: [halfGate, front] as Vec2,
      end: [halfWidth, front] as Vec2,
    },
    {
      edge: "left" as const,
      start: [-halfWidth, front] as Vec2,
      end: [-halfWidth, back] as Vec2,
    },
    {
      edge: "right" as const,
      start: [halfWidth, front] as Vec2,
      end: [halfWidth, back] as Vec2,
    },
  ]
}

function addCompoundFence(
  buffer: MeshBuffer,
  frame: Frame2,
  baseHeight: number,
  plan: PlannedCompoundFence
) {
  for (const segment of plan.segments) {
    addFenceLine(buffer, frame, segment.start, segment.end, baseHeight, {
      posts: COLORS.compoundDarkTimber,
      rails: COLORS.compoundTimber,
    })
  }
}

function addAmbientCompoundFence(
  buffer: MeshBuffer,
  frame: Frame2,
  baseHeight: number,
  width: number,
  depth: number
) {
  for (const edge of compoundFenceLocalEdges(
    width,
    depth,
    AMBIENT_COMPOUND_TARGET_SETBACKS_V3,
    AMBIENT_COMPOUND_GATE_WIDTH_V3
  )) {
    addFenceLine(buffer, frame, edge.start, edge.end, baseHeight, {
      posts: COLORS.ambientFencePost,
      rails: COLORS.ambientFenceTimber,
    })
  }
}

function addPlanter(
  buffer: MeshBuffer,
  frame: Frame2,
  x: number,
  z: number,
  baseHeight: number
) {
  addBox(
    buffer,
    frame,
    [x, baseHeight + 0.22, z],
    [0.7, 0.44, 0.7],
    COLORS.plantPot
  )
}

function addFrontageDetails(
  buffer: MeshBuffer,
  building: CompiledEnvironmentalBuildingV3,
  buildingIndex: number,
  compoundFence?: PlannedCompoundFence
) {
  // Town Square owns its open civic-park ground language in building-kit.
  // Applying the generic building frontage here would draw a second slab,
  // facade posts, and parked cycle through the public lawn and arrival path.
  if (building.source.archetype === "town-pavilion") return

  const width = building.source.footprint[0]
  const depth = building.source.footprint[1]
  const frame: Frame2 = {
    origin: building.center,
    u: building.tangent,
    v: building.outward,
  }
  addGrounding(buffer, frame, building.baseHeight, width, depth)
  for (const side of [-1, 1]) {
    addBox(
      buffer,
      frame,
      [
        side * (width / 2 - 0.24),
        building.baseHeight + building.wallHeight * 0.43,
        -depth / 2 - 0.05,
      ],
      [0.1, building.wallHeight * 0.84, 0.1],
      COLORS.tin
    )
  }
  const archetype = building.source.archetype
  if (compoundFence) {
    addCompoundFence(buffer, frame, building.baseHeight, compoundFence)
  }
  if (
    archetype === "tech-office" ||
    archetype === "service-centre" ||
    archetype === "software-studio" ||
    archetype === "health-clinic" ||
    archetype === "garden-pavilion"
  ) {
    // Keep the complete road-to-door forecourt clear. Front-centred planters
    // clipped the checkpoint clearing even when they missed the narrower
    // authored access strip, so they now sit beside the facade.
    addPlanter(
      buffer,
      frame,
      -width / 2 - 0.62,
      -depth / 2 + 0.72,
      building.baseHeight
    )
    addPlanter(
      buffer,
      frame,
      width / 2 + 0.62,
      -depth / 2 + 0.72,
      building.baseHeight
    )
  }
  if (archetype === "maker-workshop") {
    for (let index = 0; index < 3; index += 1) {
      addBox(
        buffer,
        frame,
        [
          width / 2 + 0.55,
          building.baseHeight + 0.28 + index * 0.05,
          -depth * 0.18 + index * 0.48,
        ],
        [0.72, 0.56, 0.72],
        index % 2 === 0 ? COLORS.timber : COLORS.darkTimber
      )
    }
  }
  if (archetype === "service-centre" || archetype === "health-clinic") {
    const tankCenter: Vec2 = [
      building.center[0] +
        building.tangent[0] * (width * 0.28) +
        building.outward[0] * (depth * 0.16),
      building.center[1] +
        building.tangent[1] * (width * 0.28) +
        building.outward[1] * (depth * 0.16),
    ]
    addVerticalPrism(
      buffer,
      tankCenter,
      building.baseHeight + building.wallHeight + building.roofHeight + 0.08,
      0.9,
      0.55,
      8,
      COLORS.ink
    )
  }
  if (buildingIndex === 1 || buildingIndex === 8) {
    addCycle(
      buffer,
      frame,
      building.baseHeight + 0.02,
      width / 2 + 1.15,
      -depth / 2 - 0.72
    )
  }
}

function addCycle(
  buffer: MeshBuffer,
  frame: Frame2,
  groundY: number,
  localX: number,
  localZ: number
) {
  const center = (x: number, y: number): Vec3 =>
    worldPoint(frame, localX + x, groundY + y, localZ)
  const wheelRadius = 0.42
  const rearX = -0.64
  const frontX = 0.64
  for (const wheelX of [rearX, frontX]) {
    let previous: Vec3 | null = null
    const segments = 14
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2
      const point = center(
        wheelX + Math.cos(angle) * wheelRadius,
        wheelRadius + Math.sin(angle) * wheelRadius
      )
      if (previous) {
        addRod(buffer, previous, point, 0.026, COLORS.bicycleRubber, true)
      }
      previous = point
    }
  }
  const joints = {
    rear: center(rearX, wheelRadius),
    front: center(frontX, wheelRadius),
    crank: center(-0.08, 0.43),
    seat: center(-0.24, 0.9),
    handle: center(0.43, 0.98),
    handleTop: center(0.49, 1.12),
  }
  for (const [a, b] of [
    [joints.rear, joints.crank],
    [joints.crank, joints.front],
    [joints.crank, joints.seat],
    [joints.seat, joints.rear],
    [joints.seat, joints.handle],
    [joints.handle, joints.front],
    [joints.handle, joints.handleTop],
  ] as const) {
    addRod(buffer, a, b, 0.03, COLORS.bicycleFrame, true)
  }
  addBox(
    buffer,
    frame,
    [localX - 0.26, groundY + 0.94, localZ],
    [0.34, 0.07, 0.16],
    COLORS.darkTimber
  )
  addRod(
    buffer,
    worldPoint(frame, localX + 0.49, groundY + 1.12, localZ - 0.17),
    worldPoint(frame, localX + 0.49, groundY + 1.12, localZ + 0.17),
    0.025,
    COLORS.darkTimber,
    true
  )
  addRod(
    buffer,
    worldPoint(frame, localX - 0.08, groundY + 0.43, localZ - 0.13),
    worldPoint(frame, localX - 0.08, groundY + 0.43, localZ + 0.13),
    0.022,
    COLORS.cream,
    true
  )
}

function addAmbientStructure(
  buffer: MeshBuffer,
  site: AmbientSite,
  siteIndex: number
) {
  const frame: Frame2 = {
    origin: site.center,
    u: site.tangent,
    v: site.outward,
  }
  addGrounding(buffer, frame, site.baseHeight, site.width, site.depth)
  const accessLength = ambientAccessLength(site.kind)
  addBox(
    buffer,
    frame,
    [0, site.baseHeight + 0.035, -site.depth / 2 - accessLength / 2 + 0.08],
    [2.5, 0.07, accessLength],
    COLORS.dryEarth
  )

  if (site.kind === "cottage") {
    const wallBase = site.baseHeight + 0.2
    const wallHeight = 2.62
    const front = -site.depth / 2 - 0.055
    addBox(
      buffer,
      frame,
      [0, site.baseHeight + 0.14, 0],
      [site.width, 0.28, site.depth],
      COLORS.stone
    )
    addBox(
      buffer,
      frame,
      [0, wallBase + wallHeight / 2, 0],
      [site.width - 0.18, wallHeight, site.depth - 0.18],
      siteIndex % 2 === 0 ? COLORS.plaster : COLORS.plasterCool
    )
    addHippedRoof(
      buffer,
      frame,
      wallBase + wallHeight - 0.03,
      site.width + 0.82,
      site.depth + 0.86,
      0.9,
      siteIndex % 3 === 0 ? COLORS.terracotta : COLORS.tin
    )
    addBox(
      buffer,
      frame,
      [0, wallBase + 1.04, front],
      [0.86, 2.08, 0.1],
      COLORS.ink
    )
    for (const x of [-site.width * 0.28, site.width * 0.28]) {
      addBox(
        buffer,
        frame,
        [x, wallBase + 1.48, front - 0.012],
        [0.72, 0.78, 0.07],
        COLORS.cottageTrim
      )
    }
    addBox(
      buffer,
      frame,
      [0, site.baseHeight + 0.2, front - 0.68],
      [3.4, 0.16, 1.35],
      COLORS.dryEarth
    )
    addBox(
      buffer,
      frame,
      [0, site.baseHeight + 2.38, front - 0.7],
      [3.9, 0.14, 1.45],
      COLORS.cottageTrim
    )
    for (const side of [-1.72, 1.72]) {
      addBox(
        buffer,
        frame,
        [side, site.baseHeight + 1.28, front - 1.23],
        [0.1, 2.25, 0.1],
        COLORS.timber
      )
    }
    addAmbientCompoundFence(
      buffer,
      frame,
      site.baseHeight,
      site.width,
      site.depth
    )
    return
  }

  if (site.kind === "shop") {
    const wallBase = site.baseHeight + 0.16
    const wallHeight = 2.48
    const front = -site.depth / 2 - 0.055
    addBox(
      buffer,
      frame,
      [0, site.baseHeight + 0.11, 0],
      [site.width, 0.22, site.depth],
      COLORS.stone
    )
    addBox(
      buffer,
      frame,
      [0, wallBase + wallHeight / 2, 0],
      [site.width - 0.14, wallHeight, site.depth - 0.14],
      siteIndex % 2 === 0 ? COLORS.plasterCool : COLORS.plaster
    )
    addGableRoof(
      buffer,
      frame,
      wallBase + wallHeight - 0.02,
      site.width + 0.72,
      site.depth + 0.8,
      0.72,
      siteIndex % 3 === 0 ? COLORS.terracotta : COLORS.tin
    )
    addBox(
      buffer,
      frame,
      [0, wallBase + 1.12, front],
      [3.65, 1.82, 0.1],
      COLORS.ink
    )
    addBox(
      buffer,
      frame,
      [0, wallBase + 0.62, front - 0.18],
      [3.85, 0.72, 0.34],
      COLORS.timber
    )
    addBox(
      buffer,
      frame,
      [0, site.baseHeight + 2.42, front - 0.86],
      [site.width * 0.86, 0.16, 1.78],
      COLORS.shopAwning
    )
    for (const x of [-site.width * 0.36, site.width * 0.36]) {
      addBox(
        buffer,
        frame,
        [x, site.baseHeight + 1.25, front - 1.62],
        [0.1, 2.3, 0.1],
        COLORS.darkTimber
      )
    }
    for (const side of [-1, 1]) {
      addBox(
        buffer,
        frame,
        [side * (site.width / 2 + 0.38), site.baseHeight + 0.34, front - 0.36],
        [0.62, 0.68, 0.62],
        side === -1 ? COLORS.dryEarth : COLORS.timber
      )
    }
    return
  }

  const wallBase = site.baseHeight + 0.15
  const wallHeight = 2.18
  const front = -site.depth / 2 - 0.055
  addBox(
    buffer,
    frame,
    [0, site.baseHeight + 0.1, 0],
    [site.width, 0.2, site.depth],
    COLORS.wetEarth
  )
  addBox(
    buffer,
    frame,
    [0, wallBase + wallHeight / 2, 0],
    [site.width - 0.12, wallHeight, site.depth - 0.12],
    COLORS.shedTin
  )
  addLeanToRoof(
    buffer,
    frame,
    wallBase + wallHeight - 0.02,
    site.width + 0.76,
    site.depth + 0.84,
    0.58,
    0.15,
    COLORS.tin
  )
  for (const x of [-0.58, 0.58]) {
    addBox(
      buffer,
      frame,
      [x, wallBase + 0.98, front],
      [1.02, 1.86, 0.1],
      x < 0 ? COLORS.ink : COLORS.darkTimber
    )
  }
  for (const x of [-1.35, 0, 1.35]) {
    addBox(
      buffer,
      frame,
      [x, wallBase + 1.82, front - 0.012],
      [0.62, 0.12, 0.07],
      COLORS.cream
    )
  }
  for (const x of [-site.width / 2 + 0.18, site.width / 2 - 0.18]) {
    addBox(
      buffer,
      frame,
      [x, site.baseHeight + 1.14, front - 0.04],
      [0.12, 2.18, 0.12],
      COLORS.darkTimber
    )
  }
  if (siteIndex % 2 === 1) {
    addHaystack(
      buffer,
      worldPoint(
        frame,
        site.width / 2 + 1.15,
        site.baseHeight,
        site.depth * 0.15
      )
    )
  }
}

function addHaystack(buffer: MeshBuffer, center: Vec3) {
  const sides = 10
  const offset = buffer.positions.length / 3
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2
    addVertex(
      buffer,
      [
        center[0] + Math.cos(angle) * 0.82,
        center[1],
        center[2] + Math.sin(angle) * 0.82,
      ],
      COLORS.hay
    )
  }
  addVertex(buffer, [center[0], center[1] + 1.55, center[2]], COLORS.hay)
  for (let index = 0; index < sides; index += 1) {
    buffer.indices.push(
      offset + index,
      offset + ((index + 1) % sides),
      offset + sides
    )
  }
}

function addPlantCluster(
  buffer: MeshBuffer,
  point: Vec2,
  baseHeight: number,
  type: "bamboo" | "banana" | "crop" | "reed",
  rotation: number,
  scale: number,
  tint: string
) {
  const frame: Frame2 = {
    origin: point,
    u: [Math.cos(rotation), Math.sin(rotation)],
    v: [-Math.sin(rotation), Math.cos(rotation)],
  }
  const local = (x: number, y: number, z: number) =>
    worldPoint(frame, x * scale, baseHeight + y * scale, z * scale)

  if (type === "bamboo") {
    for (const [x, z, height] of [
      [-0.28, 0.08, 2.9],
      [0.02, -0.12, 3.35],
      [0.32, 0.12, 2.65],
    ] as const) {
      const center: Vec2 = [
        point[0] + frame.u[0] * x * scale + frame.v[0] * z * scale,
        point[1] + frame.u[1] * x * scale + frame.v[1] * z * scale,
      ]
      addVerticalPrism(
        buffer,
        center,
        baseHeight,
        height * scale,
        0.055 * scale,
        5,
        COLORS.timber
      )
      const crown = local(x, height * 0.78, z)
      for (let leaf = 0; leaf < 4; leaf += 1) {
        const angle = rotation + (leaf / 4) * Math.PI * 2
        const direction: Vec2 = [Math.cos(angle), Math.sin(angle)]
        const side: Vec2 = [-direction[1], direction[0]]
        addQuad(
          buffer,
          [
            [
              crown[0] - side[0] * 0.08 * scale,
              crown[1],
              crown[2] - side[1] * 0.08 * scale,
            ],
            [
              crown[0] + direction[0] * 0.72 * scale,
              crown[1] + 0.16 * scale,
              crown[2] + direction[1] * 0.72 * scale,
            ],
            [
              crown[0] + direction[0] * 0.86 * scale,
              crown[1] + 0.02 * scale,
              crown[2] + direction[1] * 0.86 * scale,
            ],
            [
              crown[0] + side[0] * 0.08 * scale,
              crown[1],
              crown[2] + side[1] * 0.08 * scale,
            ],
          ],
          tint
        )
      }
    }
    return
  }

  if (type === "banana") {
    addVerticalPrism(
      buffer,
      point,
      baseHeight,
      1.35 * scale,
      0.12 * scale,
      6,
      "#5f815a"
    )
    const crown = local(0, 1.18, 0)
    for (let leaf = 0; leaf < 6; leaf += 1) {
      const angle = rotation + (leaf / 6) * Math.PI * 2
      const direction: Vec2 = [Math.cos(angle), Math.sin(angle)]
      const side: Vec2 = [-direction[1], direction[0]]
      addQuad(
        buffer,
        [
          [
            crown[0] - side[0] * 0.1 * scale,
            crown[1],
            crown[2] - side[1] * 0.1 * scale,
          ],
          [
            crown[0] + direction[0] * 0.72 * scale,
            crown[1] + 0.16 * scale,
            crown[2] + direction[1] * 0.72 * scale,
          ],
          [
            crown[0] + direction[0] * 1.08 * scale,
            crown[1] - 0.12 * scale,
            crown[2] + direction[1] * 1.08 * scale,
          ],
          [
            crown[0] + side[0] * 0.1 * scale,
            crown[1],
            crown[2] + side[1] * 0.1 * scale,
          ],
        ],
        tint
      )
    }
    return
  }

  const bladeCount = type === "reed" ? 8 : 7
  const height = type === "reed" ? 1.65 : 0.82
  for (let blade = 0; blade < bladeCount; blade += 1) {
    const angle = rotation + (blade / bladeCount) * Math.PI * 2
    const radius = (0.08 + (blade % 3) * 0.07) * scale
    const base: Vec3 = [
      point[0] + Math.cos(angle) * radius,
      baseHeight,
      point[1] + Math.sin(angle) * radius,
    ]
    const top: Vec3 = [
      base[0] + Math.cos(angle) * 0.1 * scale,
      baseHeight + height * (0.82 + (blade % 3) * 0.08) * scale,
      base[2] + Math.sin(angle) * 0.1 * scale,
    ]
    addRod(buffer, base, top, 0.018 * scale, tint)
    if (type === "reed" && blade % 2 === 0) {
      addVerticalPrism(
        buffer,
        [top[0], top[2]],
        top[1] - 0.02 * scale,
        0.18 * scale,
        0.035 * scale,
        5,
        COLORS.hay
      )
    }
  }
}

function primitivePole(id: string, sides: number): GeometryDefinitionV3 {
  const positions: number[] = []
  const indices: number[] = []
  for (const y of [0, 1]) {
    const radius = y === 0 ? 0.5 : 0.38
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2
      positions.push(
        round(Math.cos(angle) * radius, 5),
        y,
        round(Math.sin(angle) * radius, 5)
      )
    }
  }
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    indices.push(index, sides + next, next, index, sides + index, sides + next)
  }
  return {
    id,
    kind: "primitive",
    materialId: "environment.trunk",
    y: 0,
    positions,
    indices,
    walkable: false,
  }
}

function sceneryPrimitiveGeometries() {
  return [
    primitivePole("primitive.inhabited.utility-pole.near", 7),
    primitivePole("primitive.inhabited.utility-pole.mid", 5),
  ]
}

function groupBatchEntries(entries: BatchEntry[]) {
  const grouped = new Map<string, BatchEntry[]>()
  for (const entry of entries) {
    const key = [
      entry.cellId,
      entry.kind,
      entry.speciesId,
      entry.lod,
      entry.geometryId,
      entry.materialId,
    ].join(".")
    const group = grouped.get(key) ?? []
    group.push(entry)
    grouped.set(key, group)
  }
  return [...grouped.entries()]
    .map<InstanceBatchV3>(([key, group]) => {
      const ordered = group.sort(
        (a, b) =>
          a.densityRank - b.densityRank ||
          a.transform[2] - b.transform[2] ||
          a.transform[0] - b.transform[0]
      )
      const first = ordered[0]
      return {
        id: `batch.inhabited.${key}`,
        kind: first.kind,
        speciesId: first.speciesId,
        lod: first.lod,
        geometryId: first.geometryId,
        materialId: first.materialId,
        cellId: first.cellId,
        transforms: ordered.map((entry) => entry.transform),
        densityRanks: ordered.map((entry) => entry.densityRank),
        colors: ordered.map((entry) => entry.color),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

function outerWaterRing(water: WaterBodyManifestV3): Vec2[] {
  return (
    typeof water.polygon[0]?.[0] === "number"
      ? (water.polygon as Vec2[])
      : ((water.polygon as Vec2[][])[0] ?? [])
  ).slice(0, -1)
}

function dryBankPoint(
  ring: readonly Vec2[],
  index: number,
  water: MultiPolygon
): Vec2 | null {
  const current = ring[index]
  const previous = ring[(index - 1 + ring.length) % ring.length]
  const next = ring[(index + 1) % ring.length]
  const tangentLength = Math.hypot(next[0] - previous[0], next[1] - previous[1])
  if (tangentLength < 1e-6) return null
  const tangent: Vec2 = [
    (next[0] - previous[0]) / tangentLength,
    (next[1] - previous[1]) / tangentLength,
  ]
  const normal: Vec2 = [-tangent[1], tangent[0]]
  for (const side of [1, -1]) {
    const point: Vec2 = [
      current[0] + normal[0] * side * 1.35,
      current[1] + normal[1] * side * 1.35,
    ]
    if (!pointInMultiPolygon(point, water)) return point
  }
  return null
}

function ambientAccessLength(kind: AmbientSite["kind"]) {
  if (kind === "cottage") {
    return AMBIENT_COMPOUND_TARGET_SETBACKS_V3.front + 0.9
  }
  return kind === "shop" ? 4.6 : 3.8
}

function ambientAccessPolygon(site: AmbientSite) {
  const accessLength = ambientAccessLength(site.kind)
  const center: Vec2 = [
    site.center[0] +
      site.outward[0] * (-site.depth / 2 - accessLength / 2 + 0.08),
    site.center[1] +
      site.outward[1] * (-site.depth / 2 - accessLength / 2 + 0.08),
  ]
  return orientedRectangle(center, site.outward, accessLength, 2.8)
}

function ambientFencePolygons(site: AmbientSite) {
  if (site.kind !== "cottage") return [] as Polygon[]
  const frame: Frame2 = {
    origin: site.center,
    u: site.tangent,
    v: site.outward,
  }
  return compoundFenceLocalEdges(
    site.width,
    site.depth,
    AMBIENT_COMPOUND_TARGET_SETBACKS_V3,
    AMBIENT_COMPOUND_GATE_WIDTH_V3
  ).map((edge) =>
    segmentPolygon(worldPoint2(frame, edge.start), worldPoint2(frame, edge.end))
  )
}

function ambientSiteEnvelope(options: {
  center: Vec2
  tangent: Vec2
  outward: Vec2
  width: number
  depth: number
  kind: AmbientSite["kind"]
}) {
  // Reserve the complete visible yard, not merely the wall footprint. Rural
  // cottages receive a generous compound; shops retain an open customer
  // forecourt; sheds keep working clearance around doors and hay storage.
  const sideExtension =
    options.kind === "cottage" ? 4.7 : options.kind === "shop" ? 3.4 : 3.6
  const frontExtension =
    options.kind === "cottage" ? 6.7 : options.kind === "shop" ? 5.4 : 4.6
  const backExtension =
    options.kind === "cottage" ? 4.1 : options.kind === "shop" ? 3 : 3.8
  const depth = options.depth + frontExtension + backExtension
  const centerShift = (backExtension - frontExtension) / 2
  const center: Vec2 = [
    options.center[0] + options.outward[0] * centerShift,
    options.center[1] + options.outward[1] * centerShift,
  ]
  return orientedRectangle(
    center,
    options.tangent,
    options.width + sideExtension * 2,
    depth
  )
}

function planAmbientSites(options: {
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  waters: readonly MultiPolygon[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  field: TerrainFieldV3
  reserved?: readonly Polygon[]
}) {
  const road = options.roads.find((candidate) => candidate.source.journeyLine)
  if (!road) return [] as AmbientSite[]
  const plans = [
    [0.07, -1, 19, "cottage"],
    [0.17, 1, 24, "shed"],
    [0.29, -1, 22, "shop"],
    [0.42, 1, 26, "cottage"],
    [0.57, -1, 24, "shed"],
    [0.7, 1, 22, "cottage"],
    [0.83, -1, 25, "shop"],
    [0.93, 1, 20, "cottage"],
  ] as const
  const sites: AmbientSite[] = []
  const occupied: Polygon[] = [...(options.reserved ?? [])]
  for (const [progress, side, setback, kind] of plans) {
    const width = kind === "shop" ? 6.2 : kind === "shed" ? 5.2 : 5.8
    const depth = kind === "shop" ? 4.5 : kind === "shed" ? 4.2 : 4.8
    let selected: AmbientSite | null = null
    for (const progressOffset of [0, 0.025, -0.025, 0.05, -0.05]) {
      const frame = roadFrameAt(
        road,
        Math.max(0.03, Math.min(0.97, progress + progressOffset))
      )
      const outward: Vec2 = [frame.normal[0] * side, frame.normal[1] * side]
      for (const extraSetback of [0, 5, 9]) {
        const center: Vec2 = [
          frame.center[0] +
            outward[0] * (road.source.width / 2 + setback + extraSetback),
          frame.center[1] +
            outward[1] * (road.source.width / 2 + setback + extraSetback),
        ]
        const footprint = orientedRectangle(center, frame.tangent, width, depth)
        const envelope = ambientSiteEnvelope({
          center,
          tangent: frame.tangent,
          outward,
          width,
          depth,
          kind,
        })
        if (
          !siteIsClear({
            footprint: envelope,
            world: options.world,
            roads: options.roads,
            waters: options.waters,
            buildings: options.buildings,
            existing: occupied,
            checkpoints: options.checkpoints,
          })
        ) {
          continue
        }
        selected = {
          id: `environment.ambient.${String(sites.length + 1).padStart(2, "0")}`,
          kind,
          center,
          tangent: frame.tangent,
          outward,
          footprint,
          envelope,
          width,
          depth,
          baseHeight: options.field.heightAt(center),
          cellId: cellIdAtV3(center, options.world),
        }
        break
      }
      if (selected) break
    }
    if (!selected) continue
    sites.push(selected)
    occupied.push(selected.envelope)
  }
  return sites
}

export function compileInhabitedSceneryV3(options: {
  world: AuthoredWorldV3
  cells: CellManifestV3[]
  roads: readonly SampledRoad[]
  waters: readonly WaterBodyManifestV3[]
  bridges: readonly BridgeManifestV3[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  field: TerrainFieldV3
}): InhabitedSceneryResultV3 {
  const buffers = new Map<string, MeshBuffer>()
  const colliders: ColliderManifest[] = []
  const entries: BatchEntry[] = []
  const exclusions: Polygon[] = []
  const vegetationOnlyExclusions: Polygon[] = []
  const waterPolygons = options.waters.map(waterMultiPolygon)
  const random = createSeededRandom(
    options.world.seed ^ hashString("journey-v3-inhabited-scenery")
  )
  const counts = {
    ambientStructures: 0,
    buildingFrontages: 0,
    compoundFences: 0,
    utilityPoles: 0,
    wireSpans: 0,
    drainageSegments: 0,
    plantInstances: 0,
    waterEdgeClusters: 0,
    rareCycles: 0,
    cellMeshes: 0,
    colliders: 0,
  }
  const compoundFences = planDestinationCompoundFences({
    world: options.world,
    roads: options.roads,
    waters: waterPolygons,
    buildings: options.buildings,
    checkpoints: options.checkpoints,
  })
  const compoundFenceMap = new Map(
    compoundFences.map((plan) => [plan.buildingId, plan])
  )

  for (const [index, building] of options.buildings.entries()) {
    const cellId = cellIdAtV3(building.center, options.world)
    const compoundFence = compoundFenceMap.get(building.source.id)
    const ownsFrontage = building.source.archetype !== "town-pavilion"
    if (ownsFrontage) {
      addFrontageDetails(
        cellBuffer(buffers, cellId),
        building,
        index,
        compoundFence
      )
      counts.buildingFrontages += 1
    }
    if (compoundFence) {
      counts.compoundFences += 1
      exclusions.push(
        ...compoundFence.segments.map((segment) => segment.polygon)
      )
    }
    if (index === 1 || index === 8) counts.rareCycles += 1
    exclusions.push(
      orientedRectangle(
        building.center,
        building.tangent,
        building.source.footprint[0] + 4.4,
        building.source.footprint[1] + 3.9
      )
    )
  }

  const ambientSites = planAmbientSites({
    world: options.world,
    roads: options.roads,
    waters: waterPolygons,
    buildings: options.buildings,
    checkpoints: options.checkpoints,
    field: options.field,
    reserved: compoundFences.map((plan) => plan.envelope),
  })
  for (const [index, site] of ambientSites.entries()) {
    addAmbientStructure(cellBuffer(buffers, site.cellId), site, index)
    const collider: ColliderManifest = {
      id: `collider.${site.id}`,
      kind: "polygon",
      cellId: site.cellId,
      polygon: site.footprint[0]
        .slice(0, -1)
        .map(([x, z]) => [round(x), round(z)] as Vec2),
      minY: round(site.baseHeight),
      maxY: round(site.baseHeight + (site.kind === "shed" ? 3.2 : 3.8)),
    }
    colliders.push(collider)
    options.cells
      .find((cell) => cell.id === site.cellId)
      ?.colliderIds.push(collider.id)
    // Vegetation may inhabit the generous compound, but never its structure,
    // access path, or cottage fence. Reserving only these functional surfaces
    // avoids both bare rectangular yards and grass growing through the gate.
    exclusions.push(
      orientedRectangle(
        site.center,
        site.tangent,
        site.width + 1.3,
        site.depth + 1.3
      ),
      ambientAccessPolygon(site),
      ...ambientFencePolygons(site)
    )
    counts.ambientStructures += 1
    if (site.kind === "cottage") counts.compoundFences += 1
  }

  const journeyRoad =
    options.roads.find((road) => road.source.journeyLine) ?? options.roads[0]
  const polePoints: {
    point: Vec2
    top: Vec3
    tangent: Vec2
    cellId: string
    densityRank: number
  }[] = []
  if (journeyRoad) {
    for (let index = 0; index < 11; index += 1) {
      const progress = 0.04 + index * 0.09
      const frame = roadFrameAt(journeyRoad, progress)
      const side = index < 6 ? -1 : 1
      const point: Vec2 = [
        frame.center[0] +
          frame.normal[0] * side * (journeyRoad.source.width / 2 + 4.7),
        frame.center[1] +
          frame.normal[1] * side * (journeyRoad.source.width / 2 + 4.7),
      ]
      if (
        !isPointClear({
          point,
          world: options.world,
          roads: options.roads,
          waters: waterPolygons,
          bridges: options.bridges,
          buildings: options.buildings,
          checkpoints: options.checkpoints,
          additionalExclusions: exclusions,
          roadClearance: 2.35,
        })
      ) {
        continue
      }
      const y = options.field.heightAt(point)
      const cellId = cellIdAtV3(point, options.world)
      const densityRank = round(0.05 + index * 0.025, 5)
      for (const lod of ["near", "mid"] as const) {
        const height = lod === "near" ? 6.4 : 5.75
        entries.push({
          kind: "lamp",
          speciesId: "infrastructure",
          lod,
          geometryId: `primitive.inhabited.utility-pole.${lod}`,
          materialId: "environment.trunk",
          cellId,
          transform: [
            point[0],
            y,
            point[1],
            round(Math.atan2(frame.tangent[0], frame.tangent[1])),
            0.28,
            height,
            0.28,
          ],
          densityRank,
          color: index % 3 === 0 ? "#604a3d" : "#72533a",
        })
      }
      polePoints.push({
        point,
        top: [point[0], y + 6.15, point[1]],
        tangent: frame.tangent,
        cellId,
        densityRank,
      })
      vegetationOnlyExclusions.push(orientedRectangle(point, [1, 0], 0.9, 0.9))
      counts.utilityPoles += 1
    }
    for (let index = 0; index < polePoints.length - 1; index += 1) {
      const start = polePoints[index]
      const end = polePoints[index + 1]
      if (distance(start.point, end.point) > 48) continue
      const midpoint: Vec2 = [
        (start.point[0] + end.point[0]) / 2,
        (start.point[1] + end.point[1]) / 2,
      ]
      const directionLength = distance(start.point, end.point)
      const lateral: Vec2 =
        directionLength > 1e-6
          ? [
              -(end.point[1] - start.point[1]) / directionLength,
              (end.point[0] - start.point[0]) / directionLength,
            ]
          : [1, 0]
      const buffer = cellBuffer(buffers, cellIdAtV3(midpoint, options.world))
      addCable(buffer, start.top, end.top, lateral, -0.15)
      addCable(buffer, start.top, end.top, lateral, 0.15)
      vegetationOnlyExclusions.push(
        orientedRectangle(
          midpoint,
          [end.point[0] - start.point[0], end.point[1] - start.point[1]],
          directionLength + 0.6,
          3.2
        )
      )
      counts.wireSpans += 1
    }
  }

  for (const site of ambientSites) {
    const communityTypes =
      site.kind === "shed"
        ? (["bamboo", "crop", "crop"] as const)
        : site.kind === "shop"
          ? (["banana", "bamboo"] as const)
          : (["banana", "bamboo", "crop"] as const)
    for (const [plantIndex, type] of communityTypes.entries()) {
      const side = plantIndex % 2 === 0 ? 1 : -1
      const along = side * (site.width / 2 + 1.4 + random() * 1.4)
      const behind = site.depth / 2 + 1.1 + Math.floor(plantIndex / 2) * 1.1
      const point: Vec2 = [
        site.center[0] + site.tangent[0] * along + site.outward[0] * behind,
        site.center[1] + site.tangent[1] * along + site.outward[1] * behind,
      ]
      if (
        !isPointClear({
          point,
          world: options.world,
          roads: options.roads,
          waters: waterPolygons,
          bridges: options.bridges,
          buildings: options.buildings,
          checkpoints: options.checkpoints,
          additionalExclusions: [],
          roadClearance: 2.2,
        })
      ) {
        continue
      }
      addPlantCluster(
        cellBuffer(buffers, cellIdAtV3(point, options.world)),
        point,
        options.field.heightAt(point),
        type,
        random() * Math.PI * 2,
        type === "bamboo" ? 1.2 : type === "banana" ? 1.05 : 0.8,
        type === "bamboo"
          ? "#387b5e"
          : type === "banana"
            ? "#3f8b66"
            : "#73935b"
      )
      counts.plantInstances += 1
    }
  }

  for (const [waterIndex, water] of options.waters.entries()) {
    if (water.kind === "ocean") continue
    const ring = outerWaterRing(water)
    const multiPolygon = waterPolygons[waterIndex]
    if (ring.length < 3) continue
    const targetClusters = water.kind === "river" ? 7 : 4
    for (
      let clusterIndex = 0;
      clusterIndex < targetClusters;
      clusterIndex += 1
    ) {
      const ringIndex = Math.floor(
        ((clusterIndex + 0.5) / targetClusters) * ring.length
      )
      const point = dryBankPoint(ring, ringIndex % ring.length, multiPolygon)
      if (
        !point ||
        !isPointClear({
          point,
          world: options.world,
          roads: options.roads,
          waters: waterPolygons,
          bridges: options.bridges,
          buildings: options.buildings,
          checkpoints: options.checkpoints,
          additionalExclusions: exclusions,
          roadClearance: 2.2,
        })
      ) {
        continue
      }
      addPlantCluster(
        cellBuffer(buffers, cellIdAtV3(point, options.world)),
        point,
        options.field.heightAt(point),
        "reed",
        random() * Math.PI * 2,
        0.62 + random() * 0.35,
        clusterIndex % 2 === 0 ? "#4f8467" : "#668f70"
      )
      counts.plantInstances += 1
      counts.waterEdgeClusters += 1
    }
  }

  const northernRiver = options.world.waterBodies.find(
    (water) => water.id === "water.northern-river"
  )
  if (northernRiver?.centerline && northernRiver.width) {
    const progress = 0.78
    const segment = Math.min(
      northernRiver.centerline.length - 2,
      Math.floor(progress * (northernRiver.centerline.length - 1))
    )
    const amount = progress * (northernRiver.centerline.length - 1) - segment
    const a = northernRiver.centerline[segment]
    const b = northernRiver.centerline[segment + 1]
    const center: Vec2 = [
      a[0] + (b[0] - a[0]) * amount,
      a[1] + (b[1] - a[1]) * amount,
    ]
    const tangentLength = distance(a, b)
    const tangent: Vec2 = [
      (b[0] - a[0]) / tangentLength,
      (b[1] - a[1]) / tangentLength,
    ]
    const normal: Vec2 = [-tangent[1], tangent[0]]
    const bank: Vec2 = [
      center[0] + normal[0] * (northernRiver.width / 2 + 0.85),
      center[1] + normal[1] * (northernRiver.width / 2 + 0.85),
    ]
    if (pointInBounds(bank, options.world, 2)) {
      const cellId = cellIdAtV3(bank, options.world)
      const buffer = cellBuffer(buffers, cellId)
      const bankY = options.field.heightAt(bank)
      for (const across of [-0.7, 0.7]) {
        const point: Vec2 = [
          bank[0] + tangent[0] * across,
          bank[1] + tangent[1] * across,
        ]
        addVerticalPrism(
          buffer,
          point,
          bankY - 0.22,
          1.45,
          0.09,
          5,
          COLORS.darkTimber
        )
      }
      const rackLeft: Vec3 = [
        bank[0] - tangent[0] * 1.15 + normal[0] * 1.25,
        bankY + 0.12,
        bank[1] - tangent[1] * 1.15 + normal[1] * 1.25,
      ]
      const rackRight: Vec3 = [
        bank[0] + tangent[0] * 1.15 + normal[0] * 1.25,
        bankY + 0.12,
        bank[1] + tangent[1] * 1.15 + normal[1] * 1.25,
      ]
      addRod(
        buffer,
        rackLeft,
        [rackLeft[0], rackLeft[1] + 1.55, rackLeft[2]],
        0.045,
        COLORS.timber
      )
      addRod(
        buffer,
        rackRight,
        [rackRight[0], rackRight[1] + 1.55, rackRight[2]],
        0.045,
        COLORS.timber
      )
      addRod(
        buffer,
        [rackLeft[0], rackLeft[1] + 1.42, rackLeft[2]],
        [rackRight[0], rackRight[1] + 1.42, rackRight[2]],
        0.035,
        COLORS.timber
      )
    }
  }

  const geometries: GeometryDefinitionV3[] = [...sceneryPrimitiveGeometries()]
  for (const [cellId, buffer] of [...buffers.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    if (buffer.positions.length === 0) continue
    const geometry: GeometryDefinitionV3 = {
      id: `geometry.inhabited.${cellId}`,
      kind: "building",
      materialId: STATIC_MATERIAL_ID,
      y: 0,
      positions: buffer.positions,
      indices: buffer.indices,
      colors: buffer.colors,
      walkable: false,
    }
    geometries.push(geometry)
    options.cells
      .find((cell) => cell.id === cellId)
      ?.geometryIds.push(geometry.id)
    counts.cellMeshes += 1
  }

  const instanceBatches = groupBatchEntries(entries)
  for (const batch of instanceBatches) {
    options.cells
      .find((cell) => cell.id === batch.cellId)
      ?.batchIds.push(batch.id)
  }
  counts.colliders = colliders.length

  return {
    materials: INHABITED_SCENERY_MATERIALS_V3,
    geometries,
    instanceBatches,
    colliders,
    vegetationExclusionPolygons: [
      ...exclusions,
      ...vegetationOnlyExclusions,
    ].map((polygon) =>
      polygon[0].slice(0, -1).map(([x, z]) => [round(x), round(z)] as Vec2)
    ),
    validation: {
      valid: true,
      counts,
      warnings: [
        ...(ambientSites.length < 5
          ? [
              "Fewer than five ambient plots cleared road, water, and arrival setbacks.",
            ]
          : []),
        ...compoundFences
          .filter((plan) => plan.omittedEdges.length > 0)
          .map(
            (plan) =>
              `${plan.buildingId} keeps the full 5x compound setbacks ` +
              `(side ${plan.side.toFixed(1)}m, front/back ${plan.front.toFixed(1)}m); ` +
              `unsafe fence edges omitted: ${plan.omittedEdges.join(", ")}.`
          ),
      ],
    },
  }
}
