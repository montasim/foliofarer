import polygonClipping, { type MultiPolygon } from "polygon-clipping"

import {
  FAR_LANDSCAPE_GEOMETRY_ID_V3,
  FAR_LANDSCAPE_MATERIAL_ID_V3,
  type AuthoredWorldV3,
  type AuthoredWaterBodyV3,
  type GeometryDefinitionV3,
  type MaterialDefinitionV3,
  type RoadManifestV3,
  type Vec2,
  type Vec3,
} from "../contracts/world.ts"
import {
  compileWaterEnvelopeV3,
  type CompiledWaterShapeV3,
} from "./hydrology.ts"
import type { TerrainFieldV3 } from "./terrain.ts"
import { round } from "./geometry.ts"
import { triangulateMultiPolygonV3 } from "./geometry-v3.ts"
import { compileWaterfrontSceneryV3 } from "./waterfront-scenery.ts"

export {
  FAR_LANDSCAPE_GEOMETRY_ID_V3,
  FAR_LANDSCAPE_MATERIAL_ID_V3,
}

export const FAR_LANDSCAPE_APRON_V3 = 150
export const FAR_LANDSCAPE_MAX_TRIANGLES_V3 = 3_000
export const FAR_LANDSCAPE_WATER_DEPTH_OFFSET_V3 = 0.08

const TERRAIN_SAMPLE_SPACING = 20
const TERRAIN_DEPTH_OFFSET = 0.34
const ROAD_DEPTH_OFFSET = 0.1
const MARKING_DEPTH_OFFSET = 0.07
const ROAD_MITER_LIMIT = 1.65
const WATER_BOUNDARY_EPSILON = 0.05
const RIVER_CONTINUATION_SEGMENTS = 7
const { difference, union } = polygonClipping

const COLORS = {
  road: "#a8b0b0",
  marking: "#f5ecd8",
  river: "#5ea9e1",
  pond: "#62a6c7",
  ocean: "#4f9fd7",
} as const

export const FAR_LANDSCAPE_MATERIAL_V3: MaterialDefinitionV3 = {
  id: FAR_LANDSCAPE_MATERIAL_ID_V3,
  kind: "toon",
  color: "#76ab88",
  roughness: 1,
  vertexColors: true,
}

interface MeshBuilder {
  positions: number[]
  indices: number[]
  colors: number[]
}

function hexToLinearRgb(value: string) {
  const normalized = value.replace("#", "")
  const toLinear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return [
    toLinear(Number.parseInt(normalized.slice(0, 2), 16) / 255),
    toLinear(Number.parseInt(normalized.slice(2, 4), 16) / 255),
    toLinear(Number.parseInt(normalized.slice(4, 6), 16) / 255),
  ] as const
}

function addVertex(
  target: MeshBuilder,
  position: Vec3,
  color: readonly [number, number, number]
) {
  const index = target.positions.length / 3
  target.positions.push(
    round(position[0]),
    round(position[1]),
    round(position[2])
  )
  target.colors.push(
    round(color[0], 5),
    round(color[1], 5),
    round(color[2], 5)
  )
  return index
}

function addUpwardTriangle(
  target: MeshBuilder,
  a: number,
  b: number,
  c: number
) {
  const ax = target.positions[a * 3]
  const az = target.positions[a * 3 + 2]
  const bx = target.positions[b * 3]
  const bz = target.positions[b * 3 + 2]
  const cx = target.positions[c * 3]
  const cz = target.positions[c * 3 + 2]
  const normalY = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
  if (Math.abs(normalY) <= 1e-8) return
  target.indices.push(a, normalY > 0 ? b : c, normalY > 0 ? c : b)
}

function appendGeometry(
  target: MeshBuilder,
  geometry: GeometryDefinitionV3,
  color: readonly [number, number, number]
) {
  const vertexOffset = target.positions.length / 3
  const serializedColor = [
    round(color[0], 5),
    round(color[1], 5),
    round(color[2], 5),
  ] as const
  target.positions.push(...geometry.positions)
  for (
    let index = 0;
    index < geometry.positions.length / 3;
    index += 1
  ) {
    target.colors.push(...serializedColor)
  }
  for (const index of geometry.indices) {
    target.indices.push(vertexOffset + index)
  }
}

function appendColoredMesh(
  target: MeshBuilder,
  geometry: {
    positions: readonly number[]
    indices: readonly number[]
    colors: readonly number[]
  }
) {
  const vertexOffset = target.positions.length / 3
  target.positions.push(...geometry.positions)
  target.colors.push(...geometry.colors)
  for (const index of geometry.indices) {
    target.indices.push(vertexOffset + index)
  }
}

function appendTerrainGeometry(
  target: MeshBuilder,
  geometry: GeometryDefinitionV3,
  field: TerrainFieldV3
) {
  const vertexOffset = target.positions.length / 3
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const point: Vec2 = [
      geometry.positions[index],
      geometry.positions[index + 2],
    ]
    addVertex(
      target,
      [
        point[0],
        field.heightAt(point) - TERRAIN_DEPTH_OFFSET,
        point[1],
      ],
      field.colorAt(point)
    )
  }
  for (const index of geometry.indices) {
    target.indices.push(vertexOffset + index)
  }
}

function normalize([x, z]: Vec2): Vec2 {
  const length = Math.hypot(x, z)
  return length > 1e-8 ? [x / length, z / length] : [0, -1]
}

function seededUnit(seed: number, key: string) {
  let hash = seed >>> 0
  for (let index = 0; index < key.length; index += 1) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619) >>> 0
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 2_246_822_519) >>> 0
  hash ^= hash >>> 13
  return (hash >>> 0) / 4_294_967_295
}

function continuationLength(
  endpoint: Vec2,
  tangent: Vec2,
  world: AuthoredWorldV3,
  capRadius: number
) {
  const [minimumX, minimumZ, maximumX, maximumZ] = world.bounds
  const farMinimumX = minimumX - FAR_LANDSCAPE_APRON_V3 + capRadius
  const farMinimumZ = minimumZ - FAR_LANDSCAPE_APRON_V3 + capRadius
  const farMaximumX = maximumX + FAR_LANDSCAPE_APRON_V3 - capRadius
  const farMaximumZ = maximumZ + FAR_LANDSCAPE_APRON_V3 - capRadius
  const candidates: number[] = []

  if (
    Math.abs(endpoint[0] - minimumX) <= WATER_BOUNDARY_EPSILON &&
    tangent[0] < -0.05
  ) {
    candidates.push((farMinimumX - endpoint[0]) / tangent[0])
  }
  if (
    Math.abs(endpoint[0] - maximumX) <= WATER_BOUNDARY_EPSILON &&
    tangent[0] > 0.05
  ) {
    candidates.push((farMaximumX - endpoint[0]) / tangent[0])
  }
  if (
    Math.abs(endpoint[1] - minimumZ) <= WATER_BOUNDARY_EPSILON &&
    tangent[1] < -0.05
  ) {
    candidates.push((farMinimumZ - endpoint[1]) / tangent[1])
  }
  if (
    Math.abs(endpoint[1] - maximumZ) <= WATER_BOUNDARY_EPSILON &&
    tangent[1] > 0.05
  ) {
    candidates.push((farMaximumZ - endpoint[1]) / tangent[1])
  }

  return Math.min(
    ...candidates.filter((candidate) => Number.isFinite(candidate) && candidate > 0)
  )
}

function extendRiverEndpoint(
  source: AuthoredWaterBodyV3,
  world: AuthoredWorldV3,
  edge: "start" | "end"
) {
  const centerline = source.centerline
  if (!centerline || centerline.length < 2 || !source.width) return []
  const endpointIndex = edge === "start" ? 0 : centerline.length - 1
  const neighborIndex = edge === "start" ? 1 : centerline.length - 2
  const endpoint = centerline[endpointIndex]
  const neighbor = centerline[neighborIndex]
  const tangent = normalize([
    endpoint[0] - neighbor[0],
    endpoint[1] - neighbor[1],
  ])
  const length = continuationLength(endpoint, tangent, world, source.width / 2)
  if (!Number.isFinite(length)) return []

  const normal: Vec2 = [-tangent[1], tangent[0]]
  const phase = seededUnit(world.seed, `${source.id}.${edge}`) * Math.PI * 2
  const amplitude = Math.min(source.width * 0.46, 5.2)
  const points: Vec2[] = []
  for (let segment = 0; segment <= RIVER_CONTINUATION_SEGMENTS; segment += 1) {
    const progress = segment / RIVER_CONTINUATION_SEGMENTS
    // The envelope keeps the authored endpoint tangent, bends gently twice,
    // then meets the outer apron with the original bearing.
    const envelope = Math.sin(Math.PI * progress) ** 2
    const meander =
      amplitude *
      envelope *
      (0.72 * Math.sin(progress * Math.PI * 2 + phase) +
        0.28 * Math.sin(progress * Math.PI * 4 - phase))
    points.push([
      round(endpoint[0] + tangent[0] * length * progress + normal[0] * meander),
      round(endpoint[1] + tangent[1] * length * progress + normal[1] * meander),
    ])
  }
  return points
}

function extendRiver(
  source: AuthoredWaterBodyV3,
  world: AuthoredWorldV3
): CompiledWaterShapeV3 | null {
  if (!source.centerline || !source.width) return null
  const start = extendRiverEndpoint(source, world, "start")
  const end = extendRiverEndpoint(source, world, "end")
  const centerline: Vec2[] = [
    ...start.slice(1).reverse(),
    ...source.centerline,
    ...end.slice(1),
  ]
  if (centerline.length === source.centerline.length) return null
  return {
    id: source.id,
    kind: source.kind,
    waterLevel: source.waterLevel,
    flowDirection: source.flowDirection,
    flowSpeed: source.flowSpeed,
    flowStrength: source.flowStrength,
    multiPolygon: compileWaterEnvelopeV3({
      ...source,
      centerline,
    }),
  }
}

function extendOcean(
  source: AuthoredWaterBodyV3,
  world: AuthoredWorldV3,
  compiled: CompiledWaterShapeV3
): CompiledWaterShapeV3 | null {
  if (!source.polygon) return null
  const [minimumX, minimumZ, maximumX, maximumZ] = world.bounds
  let extended = false
  const polygon = source.polygon.map<Vec2>((point) => {
    let [x, z] = point
    if (Math.abs(x - minimumX) <= WATER_BOUNDARY_EPSILON) {
      x -= FAR_LANDSCAPE_APRON_V3
      extended = true
    } else if (Math.abs(x - maximumX) <= WATER_BOUNDARY_EPSILON) {
      x += FAR_LANDSCAPE_APRON_V3
      extended = true
    }
    if (Math.abs(z - minimumZ) <= WATER_BOUNDARY_EPSILON) {
      z -= FAR_LANDSCAPE_APRON_V3
      extended = true
    } else if (Math.abs(z - maximumZ) <= WATER_BOUNDARY_EPSILON) {
      z += FAR_LANDSCAPE_APRON_V3
      extended = true
    }
    return [round(x), round(z)]
  })
  if (!extended) return null
  return {
    id: source.id,
    kind: source.kind,
    waterLevel: source.waterLevel,
    flowDirection: source.flowDirection,
    flowSpeed: source.flowSpeed,
    flowStrength: source.flowStrength,
    multiPolygon: union(
      compiled.multiPolygon,
      compileWaterEnvelopeV3({
        ...source,
        polygon,
      })
    ),
  }
}

/**
 * The streamed water stays clipped to the authored world. Only the single
 * non-interactive far proxy receives continuations, preventing a visible
 * shoreline wall without expanding gameplay or collider bounds.
 */
export function extendFarLandscapeWatersV3(
  world: AuthoredWorldV3,
  waters: readonly CompiledWaterShapeV3[]
) {
  const sources = new Map(world.waterBodies.map((source) => [source.id, source]))
  return waters.map((water) => {
    const source = sources.get(water.id)
    if (!source) return water
    if (source.kind === "river") return extendRiver(source, world) ?? water
    if (source.kind === "ocean") {
      return extendOcean(source, world, water) ?? water
    }
    return water
  })
}

function addTerrain(
  target: MeshBuilder,
  world: AuthoredWorldV3,
  field: TerrainFieldV3,
  waters: readonly CompiledWaterShapeV3[]
) {
  const minimumX = world.bounds[0] - FAR_LANDSCAPE_APRON_V3
  const minimumZ = world.bounds[1] - FAR_LANDSCAPE_APRON_V3
  const maximumX = world.bounds[2] + FAR_LANDSCAPE_APRON_V3
  const maximumZ = world.bounds[3] + FAR_LANDSCAPE_APRON_V3
  const columns =
    Math.ceil((maximumX - minimumX) / TERRAIN_SAMPLE_SPACING) + 1
  const rows =
    Math.ceil((maximumZ - minimumZ) / TERRAIN_SAMPLE_SPACING) + 1
  const stepX = (maximumX - minimumX) / (columns - 1)
  const stepZ = (maximumZ - minimumZ) / (rows - 1)
  const vertexIndices: number[] = []
  const waterMasks = waters.map((water) => {
    const points = water.multiPolygon.flat(2)
    return {
      multiPolygon: water.multiPolygon,
      bounds: [
        Math.min(...points.map((point) => point[0])),
        Math.min(...points.map((point) => point[1])),
        Math.max(...points.map((point) => point[0])),
        Math.max(...points.map((point) => point[1])),
      ] as const,
    }
  })

  for (let row = 0; row < rows; row += 1) {
    const z = minimumZ + row * stepZ
    for (let column = 0; column < columns; column += 1) {
      const x = minimumX + column * stepX
      const point: Vec2 = [x, z]
      vertexIndices.push(
        addVertex(
          target,
          [x, field.heightAt(point) - TERRAIN_DEPTH_OFFSET, z],
          field.colorAt(point)
        )
      )
    }
  }

  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < columns - 1; column += 1) {
      const cellMinimumX = minimumX + column * stepX
      const cellMinimumZ = minimumZ + row * stepZ
      const cellMaximumX = minimumX + (column + 1) * stepX
      const cellMaximumZ = minimumZ + (row + 1) * stepZ
      const intersectingWater = waterMasks.filter(
        ({ bounds }) =>
          bounds[0] < cellMaximumX &&
          bounds[2] > cellMinimumX &&
          bounds[1] < cellMaximumZ &&
          bounds[3] > cellMinimumZ
      )
      const a = vertexIndices[row * columns + column]
      const b = vertexIndices[row * columns + column + 1]
      const c = vertexIndices[(row + 1) * columns + column]
      const d = vertexIndices[(row + 1) * columns + column + 1]
      if (intersectingWater.length > 0) {
        const cell: MultiPolygon = [
          [
            [
              [cellMinimumX, cellMinimumZ],
              [cellMaximumX, cellMinimumZ],
              [cellMaximumX, cellMaximumZ],
              [cellMinimumX, cellMaximumZ],
              [cellMinimumX, cellMinimumZ],
            ],
          ],
        ]
        const dryTerrain = difference(
          cell,
          ...intersectingWater.map((water) => water.multiPolygon)
        )
        if (dryTerrain.length > 0) {
          appendTerrainGeometry(
            target,
            triangulateMultiPolygonV3({
              id: `${FAR_LANDSCAPE_GEOMETRY_ID_V3}.terrain.${column}.${row}`,
              kind: "primitive",
              materialId: FAR_LANDSCAPE_MATERIAL_ID_V3,
              y: 0,
              multiPolygon: dryTerrain,
            }),
            field
          )
        }
        continue
      }
      addUpwardTriangle(target, a, c, b)
      addUpwardTriangle(target, b, c, d)
    }
  }
}

function roadFrame(
  centerline: readonly Vec3[],
  index: number,
  halfWidth: number
) {
  const current = centerline[index]
  const previous = centerline[Math.max(0, index - 1)]
  const next = centerline[Math.min(centerline.length - 1, index + 1)]
  const previousDirection = normalize([
    current[0] - previous[0] || next[0] - current[0],
    current[2] - previous[2] || next[2] - current[2],
  ])
  const nextDirection = normalize([
    next[0] - current[0] || current[0] - previous[0],
    next[2] - current[2] || current[2] - previous[2],
  ])
  const previousNormal: Vec2 = [
    -previousDirection[1],
    previousDirection[0],
  ]
  const nextNormal: Vec2 = [-nextDirection[1], nextDirection[0]]
  const miter = normalize([
    previousNormal[0] + nextNormal[0],
    previousNormal[1] + nextNormal[1],
  ])
  const denominator = Math.max(
    0.55,
    Math.abs(miter[0] * nextNormal[0] + miter[1] * nextNormal[1])
  )
  const offset = Math.min(
    halfWidth * ROAD_MITER_LIMIT,
    halfWidth / denominator
  )
  return {
    left: [
      current[0] + miter[0] * offset,
      current[1] - ROAD_DEPTH_OFFSET,
      current[2] + miter[1] * offset,
    ] as Vec3,
    right: [
      current[0] - miter[0] * offset,
      current[1] - ROAD_DEPTH_OFFSET,
      current[2] - miter[1] * offset,
    ] as Vec3,
  }
}

function addRoadTurnaround(
  target: MeshBuilder,
  road: RoadManifestV3,
  color: readonly [number, number, number]
) {
  const radius = road.endTurnaroundRadius
  const center = road.centerline[road.centerline.length - 1]
  if (!radius || !center) return
  const centerIndex = addVertex(
    target,
    [center[0], center[1] - ROAD_DEPTH_OFFSET, center[2]],
    color
  )
  const ring: number[] = []
  for (let segment = 0; segment < 24; segment += 1) {
    const angle = (segment / 24) * Math.PI * 2
    ring.push(
      addVertex(
        target,
        [
          center[0] + Math.cos(angle) * radius,
          center[1] - ROAD_DEPTH_OFFSET,
          center[2] + Math.sin(angle) * radius,
        ],
        color
      )
    )
  }
  for (let segment = 0; segment < ring.length; segment += 1) {
    addUpwardTriangle(
      target,
      centerIndex,
      ring[segment],
      ring[(segment + 1) % ring.length]
    )
  }
}

function addRoadMarking(
  target: MeshBuilder,
  start: Vec3,
  end: Vec3,
  color: readonly [number, number, number]
) {
  const dx = end[0] - start[0]
  const dz = end[2] - start[2]
  const length = Math.hypot(dx, dz)
  if (length <= 1e-6) return
  const tangentX = dx / length
  const tangentZ = dz / length
  const normalX = -tangentZ
  const normalZ = tangentX
  const halfLength = Math.min(0.7, length * 0.34)
  const halfWidth = 0.085
  const centerX = (start[0] + end[0]) * 0.5
  const centerY = (start[1] + end[1]) * 0.5 - MARKING_DEPTH_OFFSET
  const centerZ = (start[2] + end[2]) * 0.5
  const vertices = [
    [
      centerX - tangentX * halfLength + normalX * halfWidth,
      centerY,
      centerZ - tangentZ * halfLength + normalZ * halfWidth,
    ],
    [
      centerX + tangentX * halfLength + normalX * halfWidth,
      centerY,
      centerZ + tangentZ * halfLength + normalZ * halfWidth,
    ],
    [
      centerX - tangentX * halfLength - normalX * halfWidth,
      centerY,
      centerZ - tangentZ * halfLength - normalZ * halfWidth,
    ],
    [
      centerX + tangentX * halfLength - normalX * halfWidth,
      centerY,
      centerZ + tangentZ * halfLength - normalZ * halfWidth,
    ],
  ] as const
  const indices = vertices.map((position) =>
    addVertex(target, position, color)
  )
  addUpwardTriangle(target, indices[0], indices[1], indices[2])
  addUpwardTriangle(target, indices[1], indices[3], indices[2])
}

function addRoads(target: MeshBuilder, roads: readonly RoadManifestV3[]) {
  const roadColor = hexToLinearRgb(COLORS.road)
  const markingColor = hexToLinearRgb(COLORS.marking)
  for (const road of roads) {
    if (road.centerline.length < 2) continue
    const strip = road.centerline.map((_, index) =>
      roadFrame(road.centerline, index, road.width / 2)
    )
    const leftIndices = strip.map((frame) =>
      addVertex(target, frame.left, roadColor)
    )
    const rightIndices = strip.map((frame) =>
      addVertex(target, frame.right, roadColor)
    )
    for (let index = 0; index < strip.length - 1; index += 1) {
      addUpwardTriangle(
        target,
        leftIndices[index],
        leftIndices[index + 1],
        rightIndices[index]
      )
      addUpwardTriangle(
        target,
        leftIndices[index + 1],
        rightIndices[index + 1],
        rightIndices[index]
      )
      if (index % 2 === 0) {
        const midpointX =
          (road.centerline[index][0] + road.centerline[index + 1][0]) * 0.5
        const midpointZ =
          (road.centerline[index][2] + road.centerline[index + 1][2]) * 0.5
        const endpoint = road.centerline[road.centerline.length - 1]
        const insideTurnaround =
          road.endTurnaroundRadius !== undefined &&
          Math.hypot(midpointX - endpoint[0], midpointZ - endpoint[2]) <=
            road.endTurnaroundRadius + 0.1
        if (!insideTurnaround) {
          addRoadMarking(
            target,
            road.centerline[index],
            road.centerline[index + 1],
            markingColor
          )
        }
      }
    }
    addRoadTurnaround(target, road, roadColor)
  }
}

function waterColor(kind: CompiledWaterShapeV3["kind"]) {
  return hexToLinearRgb(COLORS[kind])
}

function addWaters(
  target: MeshBuilder,
  waters: readonly CompiledWaterShapeV3[]
) {
  for (const water of waters) {
    const geometry = triangulateMultiPolygonV3({
      id: `${FAR_LANDSCAPE_GEOMETRY_ID_V3}.${water.id}`,
      kind: "primitive",
      materialId: FAR_LANDSCAPE_MATERIAL_ID_V3,
      y: water.waterLevel - FAR_LANDSCAPE_WATER_DEPTH_OFFSET_V3,
      multiPolygon: water.multiPolygon as MultiPolygon,
    })
    appendGeometry(target, geometry, waterColor(water.kind))
  }
}

export function compileFarLandscapeV3(options: {
  world: AuthoredWorldV3
  field: TerrainFieldV3
  roads: readonly RoadManifestV3[]
  waters: readonly CompiledWaterShapeV3[]
}): GeometryDefinitionV3 {
  const target: MeshBuilder = {
    positions: [],
    indices: [],
    colors: [],
  }
  const farWaters = extendFarLandscapeWatersV3(
    options.world,
    options.waters
  )
  addTerrain(target, options.world, options.field, farWaters)
  addWaters(target, farWaters)
  addRoads(target, options.roads)
  appendColoredMesh(
    target,
    compileWaterfrontSceneryV3({
      world: options.world,
      field: options.field,
    })
  )

  const triangles = target.indices.length / 3
  if (triangles > FAR_LANDSCAPE_MAX_TRIANGLES_V3) {
    throw new Error(
      `${FAR_LANDSCAPE_GEOMETRY_ID_V3} contains ${triangles} triangles; ` +
        `budget is ${FAR_LANDSCAPE_MAX_TRIANGLES_V3}`
    )
  }

  return {
    id: FAR_LANDSCAPE_GEOMETRY_ID_V3,
    kind: "primitive",
    materialId: FAR_LANDSCAPE_MATERIAL_ID_V3,
    y: 0,
    positions: target.positions,
    indices: target.indices,
    colors: target.colors,
    walkable: false,
  }
}

export function isSharedJourneyGeometryV3(
  geometry: GeometryDefinitionV3
) {
  return (
    geometry.kind === "primitive" ||
    geometry.id === FAR_LANDSCAPE_GEOMETRY_ID_V3
  )
}
