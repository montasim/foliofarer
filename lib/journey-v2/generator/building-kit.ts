import polygonClipping, {
  type MultiPolygon,
  type Polygon,
} from "polygon-clipping"

import type {
  AccessJunctionManifestV3,
  AuthoredEnvironmentalBuildingV3,
  AuthoredWorldV3,
  CellManifestV3,
  ColliderManifest,
  EnvironmentalBuildingManifestV3,
  GeometryDefinitionV3,
  RoadManifestV3,
  Vec2,
  Vec3,
} from "../contracts/world.ts"
import { multiPolygonArea, orientedRectangle, round } from "./geometry.ts"
import { polygonFromPoints, triangulateMultiPolygonV3 } from "./geometry-v3.ts"
import type { CompiledWaterShapeV3 } from "./hydrology.ts"
import type { SampledRoad } from "./roads.ts"
import { roadEdgeSegment } from "./bridges.ts"
import {
  cellIdAtV3,
  TRAVEL_CENTERLINE_CLEARANCE_V3,
  TRAVEL_SURFACE_CLEARANCE_V3,
  type TerrainFieldV3,
} from "./terrain.ts"

const { intersection } = polygonClipping

export interface CompiledEnvironmentalBuildingV3 {
  source: AuthoredEnvironmentalBuildingV3
  roadId: string
  footprint: Polygon
  accessPolygon: Polygon
  sharedBoundary2: readonly [Vec2, Vec2]
  center: Vec2
  entrance: Vec3
  tangent: Vec2
  outward: Vec2
  rotationY: number
  baseHeight: number
  wallHeight: number
  roofHeight: number
}

function overlaps(a: Polygon, b: MultiPolygon | Polygon) {
  const right = b.length > 0 && Array.isArray(b[0]?.[0]?.[0]) ? b : [b]
  return multiPolygonArea(intersection([a], right as MultiPolygon)) > 0.001
}

function buildingPlacement(
  source: AuthoredEnvironmentalBuildingV3,
  world: AuthoredWorldV3,
  road: SampledRoad,
  field: TerrainFieldV3
): CompiledEnvironmentalBuildingV3 {
  const segmentIndex = Math.max(
    0,
    Math.min(
      road.points.length - 2,
      Math.round(source.roadProgress * (road.points.length - 2))
    )
  )
  const segment = roadEdgeSegment(road, segmentIndex)
  const outward: Vec2 = [
    segment.normal[0] * source.roadSide,
    segment.normal[1] * source.roadSide,
  ]
  const edge = source.roadSide === 1 ? segment.left : segment.right
  const edgeCenter: Vec2 = [
    (edge[0][0] + edge[1][0]) / 2,
    (edge[0][1] + edge[1][1]) / 2,
  ]
  const center: Vec2 = [
    edgeCenter[0] + outward[0] * (source.setback + source.footprint[1] / 2),
    edgeCenter[1] + outward[1] * (source.setback + source.footprint[1] / 2),
  ]
  const footprint = orientedRectangle(
    center,
    segment.tangent,
    source.footprint[0],
    source.footprint[1]
  )
  const entranceCenter: Vec2 = [
    center[0] - outward[0] * (source.footprint[1] / 2),
    center[1] - outward[1] * (source.footprint[1] / 2),
  ]
  const sharedBoundary2 = [edge[0], edge[1]] as const
  const halfEntrance = Math.min(1.15, source.footprint[0] * 0.12)
  const entranceA: Vec2 = [
    entranceCenter[0] - segment.tangent[0] * halfEntrance,
    entranceCenter[1] - segment.tangent[1] * halfEntrance,
  ]
  const entranceB: Vec2 = [
    entranceCenter[0] + segment.tangent[0] * halfEntrance,
    entranceCenter[1] + segment.tangent[1] * halfEntrance,
  ]
  const accessPolygon = polygonFromPoints([
    sharedBoundary2[0],
    sharedBoundary2[1],
    entranceB,
    entranceA,
  ])
  const baseHeight = field.heightAt(center)
  const wallHeight = source.storeys === 2 ? 5.4 : 3.2
  return {
    source,
    roadId: road.source.id,
    footprint,
    accessPolygon,
    sharedBoundary2,
    center,
    entrance: [
      round(entranceCenter[0]),
      round(baseHeight + 0.08),
      round(entranceCenter[1]),
    ],
    tangent: segment.tangent,
    outward,
    rotationY: round(Math.atan2(segment.tangent[0], segment.tangent[1])),
    baseHeight,
    wallHeight,
    roofHeight: source.family === "tin-roof-cottage" ? 1.15 : 1.45,
  }
}

export function planEnvironmentalBuildings(
  world: AuthoredWorldV3,
  roads: readonly SampledRoad[],
  waters: readonly CompiledWaterShapeV3[],
  field: TerrainFieldV3
) {
  const roadMap = new Map(roads.map((road) => [road.source.id, road]))
  const buildings: CompiledEnvironmentalBuildingV3[] = []
  for (const source of world.environmentalBuildings) {
    const road = roadMap.get(source.roadId)
    if (!road)
      throw new Error(`${source.id} references missing road ${source.roadId}`)
    const building = buildingPlacement(source, world, road, field)
    if (
      waters.some((water) => overlaps(building.footprint, water.multiPolygon))
    ) {
      throw new Error(`${source.id} overlaps environmental water`)
    }
    if (
      buildings.some(
        (existing) =>
          overlaps(building.footprint, existing.footprint) ||
          overlaps(building.accessPolygon, existing.footprint) ||
          overlaps(building.footprint, existing.accessPolygon)
      )
    ) {
      throw new Error(`${source.id} overlaps another environmental building`)
    }
    buildings.push(building)
  }
  return buildings
}

const BUILDING_ARCHITECTURE_MATERIAL = "building.architecture"

const BUILDING_COLORS = {
  warm: "#d7c6a4",
  sage: "#a9b9a5",
  cool: "#b8c3bd",
  brick: "#b96f4f",
  coral: "#94646b",
  slate: "#5e728a",
  tin: "#778c8e",
  cream: "#eadfc8",
  ink: "#214a52",
  glass: "#5f8790",
  foundation: "#887867",
} as const

const BUILDING_FOUNDATION_HEIGHT = 0.32
const BUILDING_FOUNDATION_TOP = 0.12
const BUILDING_FOUNDATION_PROJECTION = 0.12
const BUILDING_GRADE_EPSILON = 0.000_1

interface MeshBuffer {
  positions: number[]
  indices: number[]
  colors: number[]
}

interface BuildingGeometryPlan {
  architecture: MeshBuffer
  openings: MeshBuffer
}

function meshBuffer(): MeshBuffer {
  return { positions: [], indices: [], colors: [] }
}

function rgb(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ]
}

function addPolyhedron(
  buffer: MeshBuffer,
  vertices: readonly (readonly [number, number, number])[],
  indices: readonly number[],
  color: string
) {
  const offset = buffer.positions.length / 3
  const [red, green, blue] = rgb(color)
  for (const [x, y, z] of vertices) {
    buffer.positions.push(x, y, z)
    buffer.colors.push(red, green, blue)
  }
  for (const index of indices) buffer.indices.push(offset + index)
}

function addQuad(
  buffer: MeshBuffer,
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
  color: string
) {
  addPolyhedron(buffer, [a, b, c, d], [0, 1, 2, 0, 2, 3], color)
}

function addBox(
  buffer: MeshBuffer,
  center: readonly [number, number, number],
  size: readonly [number, number, number],
  color: string
) {
  const [centerX, centerY, centerZ] = center
  const halfX = size[0] / 2
  const halfY = size[1] / 2
  const halfZ = size[2] / 2
  const left = centerX - halfX
  const right = centerX + halfX
  const bottom = centerY - halfY
  const top = centerY + halfY
  const front = centerZ - halfZ
  const back = centerZ + halfZ

  // Face-separated vertices keep runtime-computed normals crisp at every
  // corner. Shared cube vertices made the low-poly walls look inflated.
  addQuad(
    buffer,
    [left, bottom, front],
    [left, top, front],
    [right, top, front],
    [right, bottom, front],
    color
  )
  addQuad(
    buffer,
    [left, bottom, back],
    [right, bottom, back],
    [right, top, back],
    [left, top, back],
    color
  )
  addQuad(
    buffer,
    [left, bottom, front],
    [left, bottom, back],
    [left, top, back],
    [left, top, front],
    color
  )
  addQuad(
    buffer,
    [right, bottom, front],
    [right, top, front],
    [right, top, back],
    [right, bottom, back],
    color
  )
  addQuad(
    buffer,
    [left, bottom, front],
    [right, bottom, front],
    [right, bottom, back],
    [left, bottom, back],
    color
  )
  addQuad(
    buffer,
    [left, top, front],
    [left, top, back],
    [right, top, back],
    [right, top, front],
    color
  )
}

function addVerticalPrism(
  buffer: MeshBuffer,
  centerX: number,
  centerZ: number,
  bottomY: number,
  height: number,
  radius: number,
  sides: number,
  color: string
) {
  const vertices: Array<readonly [number, number, number]> = []
  for (const y of [bottomY, bottomY + height]) {
    for (let index = 0; index < sides; index += 1) {
      const angle = (index / sides) * Math.PI * 2
      vertices.push([
        centerX + Math.cos(angle) * radius,
        y,
        centerZ + Math.sin(angle) * radius,
      ])
    }
  }
  vertices.push(
    [centerX, bottomY, centerZ],
    [centerX, bottomY + height, centerZ]
  )

  const indices: number[] = []
  const bottomCenter = sides * 2
  const topCenter = bottomCenter + 1
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides
    indices.push(
      index,
      sides + index,
      sides + next,
      index,
      sides + next,
      next,
      bottomCenter,
      index,
      next,
      topCenter,
      sides + next,
      sides + index
    )
  }
  addPolyhedron(buffer, vertices, indices, color)
}

function addLowPolyCanopy(
  buffer: MeshBuffer,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
  height: number,
  color: string
) {
  const sides = 6
  const vertices: Array<readonly [number, number, number]> = [
    [centerX, centerY - height / 2, centerZ],
    [centerX, centerY + height / 2, centerZ],
  ]
  for (let index = 0; index < sides; index += 1) {
    const angle = (index / sides) * Math.PI * 2
    vertices.push([
      centerX + Math.cos(angle) * radius,
      centerY,
      centerZ + Math.sin(angle) * radius,
    ])
  }
  const indices: number[] = []
  for (let index = 0; index < sides; index += 1) {
    const current = 2 + index
    const next = 2 + ((index + 1) % sides)
    indices.push(0, next, current, 1, current, next)
  }
  addPolyhedron(buffer, vertices, indices, color)
}

function addGableRoof(
  buffer: MeshBuffer,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  color: string
) {
  const left = centerX - width / 2
  const right = centerX + width / 2
  const front = centerZ - depth / 2
  const back = centerZ + depth / 2
  addPolyhedron(
    buffer,
    [
      [left, eaveY, front],
      [right, eaveY, front],
      [left, eaveY, back],
      [right, eaveY, back],
      [left, eaveY + rise, centerZ],
      [right, eaveY + rise, centerZ],
    ],
    [0, 5, 1, 0, 4, 5, 2, 3, 5, 2, 5, 4, 0, 2, 4, 1, 5, 3],
    color
  )
}

function addHipRoof(
  buffer: MeshBuffer,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  color: string
) {
  const left = centerX - width / 2
  const right = centerX + width / 2
  const front = centerZ - depth / 2
  const back = centerZ + depth / 2
  const ridgeHalf = Math.max(0.25, width / 2 - depth / 2)
  addPolyhedron(
    buffer,
    [
      [left, eaveY, front],
      [right, eaveY, front],
      [right, eaveY, back],
      [left, eaveY, back],
      [centerX - ridgeHalf, eaveY + rise, centerZ],
      [centerX + ridgeHalf, eaveY + rise, centerZ],
    ],
    [0, 5, 1, 0, 4, 5, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2],
    color
  )
}

function addRoadFacingGableRoof(
  buffer: MeshBuffer,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  color: string
) {
  const left = centerX - width / 2
  const right = centerX + width / 2
  const front = centerZ - depth / 2
  const back = centerZ + depth / 2
  addPolyhedron(
    buffer,
    [
      [left, eaveY, front],
      [right, eaveY, front],
      [left, eaveY, back],
      [right, eaveY, back],
      [centerX, eaveY + rise, front],
      [centerX, eaveY + rise, back],
    ],
    [0, 2, 5, 0, 5, 4, 1, 4, 5, 1, 5, 3, 0, 4, 1, 2, 3, 5],
    color
  )
}

function addSawtoothRoof(
  buffer: MeshBuffer,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  eaveY: number,
  rise: number,
  teeth: number,
  color: string
) {
  const bayWidth = width / teeth
  const front = centerZ - depth / 2
  const back = centerZ + depth / 2
  for (let index = 0; index < teeth; index += 1) {
    const left = centerX - width / 2 + bayWidth * index
    const right = left + bayWidth
    const peak = right - bayWidth * 0.2
    addPolyhedron(
      buffer,
      [
        [left, eaveY, front],
        [peak, eaveY + rise, front],
        [right, eaveY, front],
        [left, eaveY, back],
        [peak, eaveY + rise, back],
        [right, eaveY, back],
      ],
      [0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 0, 1, 2, 3, 5, 4],
      color
    )
  }
}

function addSlopedPanel(
  buffer: MeshBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  centerZ: number,
  depth: number,
  thickness: number,
  color: string
) {
  const front = centerZ - depth / 2
  const back = centerZ + depth / 2
  addPolyhedron(
    buffer,
    [
      [x0, y0, front],
      [x1, y1, front],
      [x1, y1, back],
      [x0, y0, back],
      [x0, y0 - thickness, front],
      [x1, y1 - thickness, front],
      [x1, y1 - thickness, back],
      [x0, y0 - thickness, back],
    ],
    [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0,
      4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
    ],
    color
  )
}

function addFrontWindows(
  buffer: MeshBuffer,
  xs: readonly number[],
  ys: readonly number[],
  frontZ: number,
  width: number,
  height: number
) {
  for (const y of ys) {
    for (const x of xs) {
      addBox(
        buffer,
        [x, y, frontZ],
        [width, height, 0.1],
        BUILDING_COLORS.glass
      )
    }
  }
}

function addSideWindows(
  buffer: MeshBuffer,
  sideX: number,
  zs: readonly number[],
  ys: readonly number[],
  width: number,
  height: number
) {
  for (const y of ys) {
    for (const z of zs) {
      addBox(buffer, [sideX, y, z], [0.1, height, width], BUILDING_COLORS.glass)
    }
  }
}

function addFrontDoor(
  buffer: MeshBuffer,
  x: number,
  frontZ: number,
  width = 1.25,
  height = 2.25
) {
  addBox(
    buffer,
    [x, height / 2 + 0.06, frontZ],
    [width, height, 0.12],
    BUILDING_COLORS.ink
  )
}

function addFrontCanopy(
  buffer: MeshBuffer,
  centerX: number,
  frontZ: number,
  width: number,
  depth: number,
  height: number,
  color = BUILDING_COLORS.cream
) {
  addBox(buffer, [centerX, height, frontZ], [width, 0.18, depth], color)
}

function groundContactBounds(buffer: MeshBuffer) {
  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index < buffer.positions.length; index += 3) {
    if (Math.abs(buffer.positions[index + 1]) > BUILDING_GRADE_EPSILON) {
      continue
    }
    minX = Math.min(minX, buffer.positions[index])
    maxX = Math.max(maxX, buffer.positions[index])
    minZ = Math.min(minZ, buffer.positions[index + 2])
    maxZ = Math.max(maxZ, buffer.positions[index + 2])
  }
  return [minX, maxX, minZ, maxZ].every(Number.isFinite)
    ? { minX, maxX, minZ, maxZ }
    : null
}

function removeCoplanarGroundFaces(buffer: MeshBuffer) {
  const retained: number[] = []
  for (let index = 0; index < buffer.indices.length; index += 3) {
    const triangle = buffer.indices.slice(index, index + 3)
    const liesOnGrade = triangle.every(
      (vertexIndex) =>
        Math.abs(buffer.positions[vertexIndex * 3 + 1]) <=
        BUILDING_GRADE_EPSILON
    )
    if (!liesOnGrade) retained.push(...triangle)
  }
  buffer.indices.splice(0, buffer.indices.length, ...retained)
}

function planBuildingGeometry(
  building: CompiledEnvironmentalBuildingV3
): BuildingGeometryPlan {
  const architecture = meshBuffer()
  const openings = meshBuffer()
  const [width, depth] = building.source.footprint
  const front = -depth / 2 + 0.3
  const face = -depth / 2 + 0.235
  const shellDepth = depth - 0.6

  switch (building.source.archetype) {
    case "town-pavilion": {
      const parkTop = 0.13
      const pathWidth = 3
      const parkLawn = "#83a77e"
      const parkCanopy = "#2f7968"
      const parkTrunk = "#765748"
      const parkPlanting = "#6f9a71"
      const lawnWidth = (width - pathWidth - 1.3) / 2
      const lawnDepth = (depth - pathWidth - 1.3) / 2
      const lawnX = pathWidth / 2 + lawnWidth / 2
      const lawnZ = pathWidth / 2 + lawnDepth / 2

      // Town Square is an open civic park, not an enclosed portfolio
      // building. A shallow raised park plane owns the terrain seam while the
      // exposed cross becomes the walking path through four planted lawns.
      addBox(
        architecture,
        [0, parkTop / 2 - 0.04, 0],
        [width - 0.35, parkTop + 0.08, depth - 0.35],
        BUILDING_COLORS.cream
      )
      for (const x of [-lawnX, lawnX]) {
        for (const z of [-lawnZ, lawnZ]) {
          addBox(
            architecture,
            [x, parkTop + 0.035, z],
            [lawnWidth, 0.07, lawnDepth],
            parkLawn
          )
        }
      }

      // A low planted roundel creates a civic focal point without becoming
      // portfolio content or blocking the cross-path circulation.
      addVerticalPrism(
        architecture,
        0,
        0,
        parkTop,
        0.16,
        0.72,
        10,
        BUILDING_COLORS.brick
      )
      addVerticalPrism(
        architecture,
        0,
        0,
        parkTop + 0.16,
        0.34,
        0.38,
        8,
        parkPlanting
      )

      const treePositions: readonly Vec2[] = [
        [-width * 0.34, -depth * 0.29],
        [width * 0.34, -depth * 0.29],
        [-width * 0.34, depth * 0.27],
        [width * 0.34, depth * 0.27],
      ]
      for (const [x, z] of treePositions) {
        addVerticalPrism(architecture, x, z, parkTop, 2.35, 0.17, 6, parkTrunk)
        addLowPolyCanopy(architecture, x, 3.05, z, 1.28, 1.65, parkCanopy)
      }

      // The rear shade pavilion supplies a recognizable park landmark while
      // remaining open on all sides.
      const pavilionZ = depth / 2 - 2.05
      for (const x of [-2.15, 2.15]) {
        for (const z of [pavilionZ - 1.05, pavilionZ + 1.05]) {
          addBox(
            architecture,
            [x, parkTop + 1.35, z],
            [0.22, 2.7, 0.22],
            BUILDING_COLORS.ink
          )
        }
      }
      addHipRoof(
        architecture,
        0,
        pavilionZ,
        5.25,
        3.2,
        parkTop + 2.72,
        0.72,
        BUILDING_COLORS.coral
      )
      break
    }
    case "schoolhouse": {
      addBox(
        architecture,
        [0, 2.7, 0],
        [width - 0.65, 5.4, shellDepth],
        BUILDING_COLORS.warm
      )
      addHipRoof(
        architecture,
        0,
        0,
        width,
        depth,
        5.4,
        1.45,
        BUILDING_COLORS.coral
      )
      addFrontCanopy(architecture, 0, front - 0.02, 2.75, 0.72, 2.75)
      for (const x of [-1.05, 1.05]) {
        addBox(
          architecture,
          [x, 1.37, front - 0.12],
          [0.22, 2.65, 0.22],
          BUILDING_COLORS.cream
        )
      }
      addBox(
        architecture,
        [width / 2 - 0.7, 3.15, front],
        [0.1, 6.3, 0.1],
        BUILDING_COLORS.cream
      )
      addFrontDoor(openings, 0, face, 1.35, 2.35)
      addFrontWindows(
        openings,
        [-4.15, -2.55, 2.55, 4.15],
        [1.75, 4.05],
        face,
        1.05,
        1.08
      )
      for (const sideX of [
        -(width - 0.65) / 2 - 0.06,
        (width - 0.65) / 2 + 0.06,
      ]) {
        addSideWindows(openings, sideX, [-1.7, 1.7], [1.75, 4.05], 1, 1.05)
      }
      break
    }
    case "academic-hall": {
      const centralDepth = shellDepth - 0.35
      const centralFront = 0.2 - centralDepth / 2
      const centralFace = centralFront - 0.06
      const wingFace = front - 0.06
      addBox(
        architecture,
        [0, 2.6, 0.2],
        [width - 2.2, 5.2, centralDepth],
        BUILDING_COLORS.brick
      )
      for (const x of [-width / 2 + 0.9, width / 2 - 0.9]) {
        addBox(
          architecture,
          [x, 2.25, 0],
          [1.8, 4.5, shellDepth],
          BUILDING_COLORS.brick
        )
      }
      addRoadFacingGableRoof(
        architecture,
        0,
        0,
        width - 1.4,
        depth,
        5.2,
        1.45,
        BUILDING_COLORS.slate
      )
      for (const x of [-3.1, -1.75, 1.75, 3.1]) {
        addBox(
          architecture,
          [x, 1.75, front - 0.11],
          [0.28, 3.5, 0.3],
          BUILDING_COLORS.cream
        )
      }
      addBox(
        architecture,
        [0, 3.55, front - 0.08],
        [7.25, 0.24, 0.45],
        BUILDING_COLORS.cream
      )
      addFrontDoor(openings, 0, centralFace, 1.8, 2.55)
      addFrontWindows(openings, [-4.75, 4.75], [1.7, 3.65], wingFace, 0.9, 1.05)
      for (const sideX of [-width / 2 - 0.06, width / 2 + 0.06]) {
        addSideWindows(openings, sideX, [-1.6, 1.6], [1.7, 3.65], 0.9, 1)
      }
      break
    }
    case "engineering-campus": {
      const mainWidth = width - 3
      const towerX = width / 2 - 1.35
      const towerDepth = shellDepth - 0.2
      const towerFront = 0.1 - towerDepth / 2
      const towerFace = towerFront - 0.06
      addBox(
        architecture,
        [-1.15, 2.6, 0],
        [mainWidth, 5.2, shellDepth],
        BUILDING_COLORS.sage
      )
      addBox(
        architecture,
        [towerX, 3.35, 0.1],
        [2.25, 6.7, towerDepth],
        BUILDING_COLORS.ink
      )
      addBox(
        architecture,
        [-1.15, 5.34, 0],
        [width - 2.55, 0.28, depth - 0.25],
        BUILDING_COLORS.tin
      )
      addBox(
        architecture,
        [width / 2 - 1.35, 6.83, 0.1],
        [2.55, 0.26, depth - 0.5],
        BUILDING_COLORS.tin
      )
      addFrontCanopy(architecture, -1.15, front - 0.07, 2.6, 0.65, 2.55)
      addFrontDoor(openings, -1.15, face, 1.35, 2.3)
      addFrontWindows(
        openings,
        [-4.15, -2.55, -0.65, 1.15],
        [2.05, 4.15],
        face,
        0.85,
        1
      )
      addFrontWindows(openings, [towerX], [2.05, 4.15], towerFace, 0.85, 1)
      addSideWindows(
        openings,
        -1.15 - mainWidth / 2 - 0.06,
        [-1.55, 1.55],
        [2.05, 4.15],
        0.9,
        0.95
      )
      break
    }
    case "tech-office": {
      addBox(
        architecture,
        [0, 2.4, 0],
        [width - 0.65, 4.8, shellDepth],
        BUILDING_COLORS.warm
      )
      addBox(
        architecture,
        [-2.1, 5.15, 0.05],
        [4.3, 0.7, shellDepth - 0.2],
        BUILDING_COLORS.brick
      )
      addBox(
        architecture,
        [2.05, 4.96, 0],
        [3.7, 0.32, depth - 0.35],
        BUILDING_COLORS.slate
      )
      addFrontCanopy(architecture, 0, front - 0.06, 2.5, 0.68, 2.55)
      addFrontDoor(openings, 0, face, 1.25, 2.25)
      addFrontWindows(
        openings,
        [-3.65, -2.15, 2.15, 3.65],
        [1.8, 3.75],
        face,
        0.95,
        1.05
      )
      for (const sideX of [
        -(width - 0.65) / 2 - 0.06,
        (width - 0.65) / 2 + 0.06,
      ]) {
        addSideWindows(openings, sideX, [-1.5, 1.5], [1.8, 3.75], 0.9, 1)
      }
      break
    }
    case "service-centre": {
      const serviceDepth = shellDepth - 0.3
      const serviceFront = 0.15 - serviceDepth / 2
      const serviceFace = serviceFront - 0.06
      addBox(
        architecture,
        [0, 1.5, 0.15],
        [width - 0.7, 3, serviceDepth],
        BUILDING_COLORS.sage
      )
      addHipRoof(architecture, 0, 0, width, depth, 3, 1.1, BUILDING_COLORS.tin)
      addFrontCanopy(
        architecture,
        0,
        front - 0.05,
        width - 1.15,
        0.72,
        2.45,
        BUILDING_COLORS.cream
      )
      for (const x of [-3.6, -1.9, 1.9, 3.6]) {
        addBox(
          architecture,
          [x, 1.2, front - 0.14],
          [0.2, 2.4, 0.2],
          BUILDING_COLORS.cream
        )
      }
      addBox(
        architecture,
        [0, 0.09, front - 0.14],
        [1.75, 0.18, 0.75],
        BUILDING_COLORS.cream
      )
      addFrontDoor(openings, 0, serviceFace, 1.25, 2.2)
      addFrontWindows(openings, [-2.8, 2.8], [1.55], serviceFace, 1.35, 1.05)
      for (const sideX of [
        -(width - 0.7) / 2 - 0.06,
        (width - 0.7) / 2 + 0.06,
      ]) {
        addSideWindows(openings, sideX, [-1.35, 1.65], [1.55], 1.1, 0.95)
      }
      break
    }
    case "software-studio": {
      const lowerWidth = width - 0.65
      const upperDepth = shellDepth - 0.3
      const upperFront = 0.15 - upperDepth / 2
      const upperFace = upperFront - 0.06
      addBox(
        architecture,
        [0, 1.55, 0],
        [lowerWidth, 3.1, shellDepth],
        BUILDING_COLORS.cool
      )
      addBox(
        architecture,
        [1.35, 4.25, 0.15],
        [5.2, 2.4, shellDepth - 0.3],
        BUILDING_COLORS.sage
      )
      addBox(
        architecture,
        [-2.65, 3.35, 0],
        [2.35, 0.34, depth - 0.3],
        BUILDING_COLORS.coral
      )
      addBox(
        architecture,
        [1.35, 5.55, 0.15],
        [5.55, 0.2, depth - 0.65],
        BUILDING_COLORS.slate
      )
      addFrontCanopy(architecture, -1.9, front - 0.05, 2.25, 0.66, 2.5)
      addFrontDoor(openings, -1.9, face, 1.25, 2.25)
      addFrontWindows(
        openings,
        [-3.65, 0.25, 1.65, 3.05],
        [1.75],
        face,
        1,
        1.05
      )
      addFrontWindows(openings, [0.25, 1.65, 3.05], [4.25], upperFace, 1, 1.05)
      for (const sideX of [-lowerWidth / 2 - 0.06, lowerWidth / 2 + 0.06]) {
        addSideWindows(openings, sideX, [-1.5, 1.5], [1.75], 0.95, 1)
      }
      addSideWindows(
        openings,
        1.35 + 5.2 / 2 + 0.06,
        [-1.3, 1.3],
        [4.25],
        0.9,
        1
      )
      break
    }
    case "health-clinic": {
      const coreWidth = 5
      const coreDepth = shellDepth - 0.2
      const coreFront = 0.15 - coreDepth / 2
      const coreFace = coreFront - 0.06
      const wingWidth = (width - coreWidth - 0.35) / 2
      const wingOffset = coreWidth / 2 + wingWidth / 2 + 0.175
      addBox(
        architecture,
        [0, 2.7, 0.15],
        [coreWidth, 5.4, coreDepth],
        BUILDING_COLORS.sage
      )
      for (const x of [-wingOffset, wingOffset]) {
        addBox(
          architecture,
          [x, 1.65, 0],
          [wingWidth, 3.3, shellDepth],
          BUILDING_COLORS.cool
        )
        addBox(
          architecture,
          [x, 3.42, 0],
          [wingWidth + 0.18, 0.24, depth - 0.35],
          BUILDING_COLORS.tin
        )
      }
      addBox(
        architecture,
        [0, 5.54, 0.15],
        [coreWidth + 0.35, 0.28, depth - 0.5],
        BUILDING_COLORS.slate
      )
      addFrontCanopy(architecture, 0, front - 0.08, 3.8, 0.76, 2.65)
      addBox(
        architecture,
        [0, 4.38, coreFace],
        [0.95, 0.25, 0.14],
        BUILDING_COLORS.cream
      )
      addBox(
        architecture,
        [0, 4.38, coreFace],
        [0.25, 0.95, 0.14],
        BUILDING_COLORS.cream
      )
      addFrontDoor(openings, 0, coreFace, 1.4, 2.3)
      addFrontWindows(
        openings,
        [-wingOffset, wingOffset],
        [1.75],
        face,
        Math.min(1.2, wingWidth - 0.45),
        1.05
      )
      addFrontWindows(openings, [-1.35, 1.35], [1.85, 3.75], coreFace, 0.9, 1)
      const outerWingX = wingOffset + wingWidth / 2
      for (const sideX of [-outerWingX - 0.06, outerWingX + 0.06]) {
        addSideWindows(openings, sideX, [-1.4, 1.4], [1.75], 0.9, 0.95)
      }
      break
    }
    case "reading-room": {
      const monitorDepth = shellDepth - 0.4
      const monitorFront = 0.15 - monitorDepth / 2
      const monitorFace = monitorFront - 0.06
      addBox(
        architecture,
        [0, 2.3, 0],
        [width - 0.65, 4.6, shellDepth],
        BUILDING_COLORS.warm
      )
      addBox(
        architecture,
        [0, 5.35, 0.15],
        [5.2, 1.5, shellDepth - 0.4],
        BUILDING_COLORS.sage
      )
      addBox(
        architecture,
        [0, 4.72, 0],
        [width, 0.24, depth],
        BUILDING_COLORS.slate
      )
      addGableRoof(
        architecture,
        0,
        0.15,
        5.65,
        depth - 0.35,
        6.1,
        0.75,
        BUILDING_COLORS.slate
      )
      addFrontCanopy(architecture, 0, front - 0.06, 2.7, 0.68, 2.55)
      addFrontDoor(openings, 0, face, 1.35, 2.3)
      addFrontWindows(
        openings,
        [-4.15, -2.75, -1.4, 1.4, 2.75, 4.15],
        [2.15],
        face,
        0.82,
        1.75
      )
      addFrontWindows(openings, [-1.7, 0, 1.7], [5.35], monitorFace, 0.9, 0.65)
      for (const sideX of [
        -(width - 0.65) / 2 - 0.06,
        (width - 0.65) / 2 + 0.06,
      ]) {
        addSideWindows(openings, sideX, [-1.45, 1.45], [2.15], 0.9, 1.5)
      }
      break
    }
    case "maker-workshop": {
      addBox(
        architecture,
        [0, 1.5, 0],
        [width - 0.65, 3, shellDepth],
        BUILDING_COLORS.cool
      )
      addSawtoothRoof(
        architecture,
        0,
        0,
        width,
        depth,
        3,
        1.05,
        3,
        BUILDING_COLORS.tin
      )
      addBox(
        architecture,
        [width / 2 - 1, 3.65, 1.6],
        [0.5, 1.3, 0.55],
        BUILDING_COLORS.brick
      )
      addFrontDoor(openings, 0, face, 3.25, 2.55)
      addFrontWindows(openings, [-3.7, 3.7], [2.05], face, 1, 0.8)
      for (const sideX of [
        -(width - 0.65) / 2 - 0.06,
        (width - 0.65) / 2 + 0.06,
      ]) {
        addSideWindows(openings, sideX, [-1.45, 1.45], [2.05], 0.85, 0.75)
      }
      for (const y of [0.7, 1.25, 1.8]) {
        addBox(
          openings,
          [0, y, face - 0.015],
          [3.05, 0.07, 0.04],
          BUILDING_COLORS.cream
        )
      }
      break
    }
    case "community-hall": {
      addBox(
        architecture,
        [0, 2.4, 0],
        [width - 0.65, 4.8, shellDepth],
        BUILDING_COLORS.brick
      )
      addRoadFacingGableRoof(
        architecture,
        0,
        0,
        width,
        depth,
        4.8,
        1.65,
        BUILDING_COLORS.slate
      )
      addFrontCanopy(
        architecture,
        0,
        front - 0.07,
        width - 1.3,
        0.78,
        3.15,
        BUILDING_COLORS.cream
      )
      for (const x of [-4.4, -2.15, 2.15, 4.4]) {
        addBox(
          architecture,
          [x, 1.55, front - 0.13],
          [0.28, 3.1, 0.3],
          BUILDING_COLORS.cream
        )
      }
      addFrontDoor(openings, 0, face, 2.6, 2.65)
      addFrontWindows(openings, [-4.8, 4.8], [2.05], face, 1.15, 1.25)
      for (const sideX of [
        -(width - 0.65) / 2 - 0.06,
        (width - 0.65) / 2 + 0.06,
      ]) {
        addSideWindows(openings, sideX, [-1.6, 1.6], [2.05], 1, 1.15)
      }
      break
    }
    case "garden-pavilion": {
      addBox(
        architecture,
        [0, 0.12, 0],
        [width - 0.45, 0.24, depth - 0.45],
        BUILDING_COLORS.cream
      )
      const postXs = [-width / 2 + 0.75, width / 2 - 0.75]
      for (const x of postXs) {
        const roofUnderside =
          3.55 + (4.25 - 3.55) * (Math.abs(x) / (width / 2)) - 0.18
        const postBottom = 0.24
        const postHeight = roofUnderside - postBottom
        for (const z of [-depth / 2 + 0.75, depth / 2 - 0.75]) {
          addBox(
            architecture,
            [x, postBottom + postHeight / 2, z],
            [0.28, postHeight, 0.28],
            BUILDING_COLORS.ink
          )
        }
      }
      addSlopedPanel(
        architecture,
        -width / 2,
        4.25,
        0,
        3.55,
        0,
        depth,
        0.18,
        BUILDING_COLORS.slate
      )
      addSlopedPanel(
        architecture,
        0,
        3.55,
        width / 2,
        4.25,
        0,
        depth,
        0.18,
        BUILDING_COLORS.slate
      )
      addBox(
        architecture,
        [0, 3.35, depth / 2 - 0.62],
        [width - 1.6, 0.2, 0.25],
        BUILDING_COLORS.cream
      )
      addBox(
        openings,
        [-1.45, 1.45, depth / 2 - 0.72],
        [2.4, 2.35, 0.12],
        BUILDING_COLORS.sage
      )
      addBox(
        openings,
        [1.45, 1.45, depth / 2 - 0.72],
        [2.4, 2.35, 0.12],
        BUILDING_COLORS.sage
      )
      break
    }
    default: {
      const exhaustive: never = building.source.archetype
      throw new Error(`Unsupported environmental archetype ${exhaustive}`)
    }
  }

  /*
   * Closed boxes previously left many overlapping downward faces exactly on
   * the terrain plane. Remove those invisible coplanar triangles, then derive
   * one foundation from the actual grade-contact vertices rather than the
   * authored lot footprint. The cap projects beyond every wall/post, so no
   * archetype can escape the cover and expose another terrain seam.
   */
  const contact =
    groundContactBounds(architecture) ??
    ({
      minX: -width / 2,
      maxX: width / 2,
      minZ: -depth / 2,
      maxZ: depth / 2,
    } as const)
  removeCoplanarGroundFaces(architecture)
  const foundationMinX = contact.minX - BUILDING_FOUNDATION_PROJECTION
  const foundationMaxX = contact.maxX + BUILDING_FOUNDATION_PROJECTION
  const foundationMinZ = contact.minZ - BUILDING_FOUNDATION_PROJECTION
  const foundationMaxZ = contact.maxZ + BUILDING_FOUNDATION_PROJECTION
  addBox(
    architecture,
    [
      (foundationMinX + foundationMaxX) / 2,
      BUILDING_FOUNDATION_TOP - BUILDING_FOUNDATION_HEIGHT / 2,
      (foundationMinZ + foundationMaxZ) / 2,
    ],
    [
      foundationMaxX - foundationMinX,
      BUILDING_FOUNDATION_HEIGHT,
      foundationMaxZ - foundationMinZ,
    ],
    BUILDING_COLORS.foundation
  )

  return { architecture, openings }
}

function geometryFromBuffer(
  building: CompiledEnvironmentalBuildingV3,
  role: "architecture" | "openings",
  buffer: MeshBuffer
): GeometryDefinitionV3 {
  const positions: number[] = []
  const determinant =
    building.tangent[0] * building.outward[1] -
    building.tangent[1] * building.outward[0]
  for (let index = 0; index < buffer.positions.length; index += 3) {
    const localX = buffer.positions[index]
    const localY = buffer.positions[index + 1]
    const localZ = buffer.positions[index + 2]
    positions.push(
      round(
        building.center[0] +
          building.tangent[0] * localX +
          building.outward[0] * localZ
      ),
      round(building.baseHeight + localY),
      round(
        building.center[1] +
          building.tangent[1] * localX +
          building.outward[1] * localZ
      )
    )
  }
  const indices = [...buffer.indices]
  if (determinant < 0) {
    for (let index = 0; index < indices.length; index += 3) {
      const second = indices[index + 1]
      indices[index + 1] = indices[index + 2]
      indices[index + 2] = second
    }
  }
  return {
    id: `geometry.${building.source.id}.${role}`,
    kind: "building",
    materialId: BUILDING_ARCHITECTURE_MATERIAL,
    y: 0,
    positions,
    indices,
    colors: buffer.colors.map((component) => round(component, 5)),
  }
}

function localColliderPolygon(
  building: CompiledEnvironmentalBuildingV3,
  localCenter: Vec2,
  size: readonly [width: number, depth: number]
): Vec2[] {
  const worldCenter: Vec2 = [
    building.center[0] +
      building.tangent[0] * localCenter[0] +
      building.outward[0] * localCenter[1],
    building.center[1] +
      building.tangent[1] * localCenter[0] +
      building.outward[1] * localCenter[1],
  ]
  return orientedRectangle(worldCenter, building.tangent, size[0], size[1])[0]
    .slice(0, -1)
    .map(([x, z]) => [round(x), round(z)] as Vec2)
}

function buildingColliders(
  building: CompiledEnvironmentalBuildingV3,
  cellId: string,
  topY: number
): ColliderManifest[] {
  if (
    building.source.archetype !== "garden-pavilion" &&
    building.source.archetype !== "town-pavilion"
  ) {
    return [
      {
        id: `collider.${building.source.id}`,
        kind: "polygon",
        cellId,
        polygon: building.footprint[0]
          .slice(0, -1)
          .map(([x, z]) => [round(x), round(z)] as Vec2),
        minY: building.baseHeight,
        maxY: round(topY),
      },
    ]
  }

  const [width, depth] = building.source.footprint
  const definitions: Array<{
    suffix: string
    center: Vec2
    size: readonly [number, number]
  }> = []

  if (building.source.archetype === "town-pavilion") {
    const treePositions: readonly Vec2[] = [
      [-width * 0.34, -depth * 0.29],
      [width * 0.34, -depth * 0.29],
      [-width * 0.34, depth * 0.27],
      [width * 0.34, depth * 0.27],
    ]
    treePositions.forEach((center, treeIndex) => {
      definitions.push({
        suffix: `tree-${String(treeIndex).padStart(2, "0")}`,
        center,
        size: [0.42, 0.42],
      })
    })
    const pavilionZ = depth / 2 - 2.05
    let postIndex = 0
    for (const x of [-2.15, 2.15]) {
      for (const z of [pavilionZ - 1.05, pavilionZ + 1.05]) {
        definitions.push({
          suffix: `pavilion-post-${String(postIndex).padStart(2, "0")}`,
          center: [x, z],
          size: [0.28, 0.28],
        })
        postIndex += 1
      }
    }
    definitions.push({
      suffix: "central-planter",
      center: [0, 0],
      size: [1.55, 1.55],
    })
    return definitions.map((definition) => ({
      id: `collider.${building.source.id}.${definition.suffix}`,
      kind: "polygon" as const,
      cellId,
      polygon: localColliderPolygon(
        building,
        definition.center,
        definition.size
      ),
      minY: building.baseHeight,
      maxY: round(topY),
    }))
  }

  let index = 0
  for (const x of [-width / 2 + 0.75, width / 2 - 0.75]) {
    for (const z of [-depth / 2 + 0.75, depth / 2 - 0.75]) {
      definitions.push({
        suffix: `post-${String(index).padStart(2, "0")}`,
        center: [x, z],
        size: [0.28, 0.28],
      })
      index += 1
    }
  }
  for (const [screenIndex, x] of [-1.45, 1.45].entries()) {
    definitions.push({
      suffix: `screen-${String(screenIndex).padStart(2, "0")}`,
      center: [x, depth / 2 - 0.72],
      size: [2.4, 0.12],
    })
  }

  return definitions.map((definition) => ({
    id: `collider.${building.source.id}.${definition.suffix}`,
    kind: "polygon",
    cellId,
    polygon: localColliderPolygon(building, definition.center, definition.size),
    minY: building.baseHeight,
    maxY: round(topY),
  }))
}

function accessGeometry(
  building: CompiledEnvironmentalBuildingV3,
  field: TerrainFieldV3
) {
  const geometry = triangulateMultiPolygonV3({
    id: `geometry.${building.source.id}.access`,
    kind: "surface",
    materialId: "surface.access-sand",
    y: 0,
    multiPolygon: [building.accessPolygon],
  })
  for (let index = 0; index < geometry.positions.length; index += 3) {
    const point: Vec2 = [
      geometry.positions[index],
      geometry.positions[index + 2],
    ]
    const shared = building.sharedBoundary2.some(
      (candidate) =>
        Math.abs(candidate[0] - point[0]) < 0.001 &&
        Math.abs(candidate[1] - point[1]) < 0.001
    )
    geometry.positions[index + 1] = round(
      field.heightAt(point) +
        (shared ? TRAVEL_SURFACE_CLEARANCE_V3 : TRAVEL_CENTERLINE_CLEARANCE_V3)
    )
  }
  return geometry
}

export function compileEnvironmentalBuildings(options: {
  world: AuthoredWorldV3
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  cells: CellManifestV3[]
  roads: RoadManifestV3[]
  field: TerrainFieldV3
  /**
   * An arrival site is streamed as one logical package even when its building
   * center crosses a grid boundary. Its checkpoint compiler already owns the
   * single road-to-door surface, so no duplicate access mesh is emitted here.
   */
  cellOverrides?: ReadonlyMap<string, string>
  arrivalSurfaceOverrides?: ReadonlyMap<string, readonly [string, string]>
}) {
  const geometries: GeometryDefinitionV3[] = []
  const manifests: EnvironmentalBuildingManifestV3[] = []
  const colliders: ColliderManifest[] = []
  const accessJunctions: AccessJunctionManifestV3[] = []

  for (const building of options.buildings) {
    const buildingPlan = planBuildingGeometry(building)
    const buildingGeometries = [
      geometryFromBuffer(building, "architecture", buildingPlan.architecture),
      geometryFromBuffer(building, "openings", buildingPlan.openings),
    ]
    const topY = Math.max(
      ...buildingGeometries.flatMap((geometry) =>
        geometry.positions.filter((_, index) => index % 3 === 1)
      )
    )
    const sharedArrivalSurfaceIds = options.arrivalSurfaceOverrides?.get(
      building.source.id
    )
    const access = sharedArrivalSurfaceIds
      ? null
      : accessGeometry(building, options.field)
    geometries.push(...buildingGeometries)
    if (access) geometries.push(access)
    const cellId =
      options.cellOverrides?.get(building.source.id) ??
      cellIdAtV3(building.center, options.world)
    const cell = options.cells.find((candidate) => candidate.id === cellId)
    if (!cell) throw new Error(`${building.source.id} is outside world bounds`)
    cell.geometryIds.push(...buildingGeometries.map((geometry) => geometry.id))
    if (access) cell.geometryIds.push(access.id)
    cell.environmentalBuildingIds.push(building.source.id)
    const compiledColliders = buildingColliders(building, cellId, topY)
    cell.colliderIds.push(...compiledColliders.map((collider) => collider.id))
    const materialIds = [BUILDING_ARCHITECTURE_MATERIAL]
    manifests.push({
      id: building.source.id,
      family: building.source.family,
      archetype: building.source.archetype,
      districtId: building.source.districtId,
      cellId,
      footprint: building.footprint[0]
        .slice(0, -1)
        .map(([x, z]) => [round(x), round(z)] as Vec2),
      baseHeight: building.baseHeight,
      height: round(topY - building.baseHeight),
      entrance: building.entrance,
      rotationY: building.rotationY,
      geometryIds: buildingGeometries.map((geometry) => geometry.id),
      materialIds,
    })
    colliders.push(...compiledColliders)

    const sharedBoundary = building.sharedBoundary2.map<Vec3>((point) => {
      const serializedPoint: Vec2 = [round(point[0]), round(point[1])]
      return [
        serializedPoint[0],
        round(
          options.field.heightAt(serializedPoint) + TRAVEL_SURFACE_CLEARANCE_V3
        ),
        serializedPoint[1],
      ]
    }) as unknown as readonly [Vec3, Vec3]
    const id = `junction.${building.source.id}`
    accessJunctions.push({
      id,
      buildingId: building.source.id,
      roadId: building.roadId,
      sharedBoundary,
      surfaceGeometryIds: sharedArrivalSurfaceIds
        ? [...sharedArrivalSurfaceIds]
        : [access!.id],
      navigationEdgeIds: [`nav-edge.access.${building.source.id}`],
    })
    const road = options.roads.find(
      (candidate) => candidate.id === building.roadId
    )
    if (!road) throw new Error(`${id} references missing road`)
    road.sharedJunctionIds.push(id)
  }
  return { geometries, manifests, colliders, accessJunctions }
}
