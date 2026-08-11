import polygonClipping, { type Polygon } from "polygon-clipping"

import type {
  AuthoredWorldV3,
  BridgeManifestV3,
  CellManifestV3,
  ColliderManifest,
  GeometryDefinitionV3,
  MaterialDefinitionV3,
  RoadManifestV3,
  Vec2,
  Vec3,
  WaterBodyManifestV3,
} from "../contracts/world.ts"
import {
  boundsOfPoints,
  circlePolygon,
  distance,
  multiPolygonArea,
  orientedRectangle,
  pointInMultiPolygon,
  round,
} from "./geometry.ts"
import { polygonFromPoints, triangulateMultiPolygonV3 } from "./geometry-v3.ts"
import type {
  BridgeCrossingDraftV3,
  CompiledWaterShapeV3,
} from "./hydrology.ts"
import type { SampledRoad } from "./roads.ts"
import {
  cellIdAtV3,
  ROAD_MARKING_CLEARANCE_V3,
  TRAVEL_CENTERLINE_CLEARANCE_V3,
  TRAVEL_SURFACE_CLEARANCE_V3,
  type TerrainFieldV3,
} from "./terrain.ts"

const { difference, intersection } = polygonClipping
const ROAD_LATERAL_SUBDIVISIONS = 4
const ROAD_LONGITUDINAL_SUBDIVISIONS = 2
export const ROAD_VERGE_WIDTH_V3 = 1.6
export const BRIDGE_SHOULDER_TERMINAL_LENGTH_V3 = 0.7
export const BRIDGE_APPROACH_TANGENT_BLEND_THRESHOLD_V3 = 25
export const BRIDGE_ROAD_REALIGN_THRESHOLD_V3 = 12

export function bridgeApproachOwnedSegmentCount(
  bridgeTangent: Vec2,
  roadTangent: Vec2
) {
  const dot = Math.max(
    -1,
    Math.min(
      1,
      bridgeTangent[0] * roadTangent[0] + bridgeTangent[1] * roadTangent[1]
    )
  )
  const angle = (Math.acos(dot) * 180) / Math.PI
  return angle > BRIDGE_APPROACH_TANGENT_BLEND_THRESHOLD_V3 ? 2 : 1
}

const ROAD_VERGE_CROSS_SECTION = [
  { offset: 0.035, lift: 0.036, color: "#c9b58c" },
  { offset: 0.68, lift: 0.026, color: "#b29a73" },
  { offset: 0.91, lift: 0.018, color: "#8a7257" },
  { offset: 1.24, lift: 0.012, color: "#5d705f" },
  { offset: ROAD_VERGE_WIDTH_V3, lift: 0.02, color: "#6f9779" },
] as const

interface ColoredGeometryBuffer {
  positions: number[]
  indices: number[]
  colors: number[]
}

function upwardSurfaceTriangles(
  points: readonly [Vec3, Vec3, Vec3, Vec3]
): readonly (readonly [number, number, number])[] {
  const normalY = (a: number, b: number, c: number) =>
    (points[b][2] - points[a][2]) * (points[c][0] - points[a][0]) -
    (points[b][0] - points[a][0]) * (points[c][2] - points[a][2])
  const diagonals = [
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
    [
      [0, 1, 3],
      [1, 2, 3],
    ],
  ] as const
  // One diagonal of a concave transition quad crosses outside its boundary
  // and gives the two triangles opposite winding. Select the diagonal whose
  // triangles agree, then normalize both to upward winding.
  const triangles =
    diagonals.find(([first, second]) => {
      const firstNormal = normalY(first[0], first[1], first[2])
      const secondNormal = normalY(second[0], second[1], second[2])
      return firstNormal * secondNormal > 1e-10
    }) ?? diagonals[0]
  return triangles.map(([a, b, c]) =>
    normalY(a, b, c) >= 0 ? [a, b, c] : [a, c, b]
  )
}

function colorChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ]
}

function appendColoredSurfaceQuad(
  buffer: ColoredGeometryBuffer,
  points: readonly [Vec3, Vec3, Vec3, Vec3],
  color: string
) {
  const offset = buffer.positions.length / 3
  const channels = colorChannels(color)
  for (const point of points) {
    buffer.positions.push(...point)
    buffer.colors.push(...channels)
  }
  // Colored strips use grid ordering: current-near, next-near,
  // current-far, next-far. Convert that to perimeter order before choosing
  // the valid diagonal for a curved/concave quad, then map it back.
  const perimeterOrder = [0, 1, 3, 2] as const
  const perimeterPoints = perimeterOrder.map(
    (index) => points[index]
  ) as unknown as [Vec3, Vec3, Vec3, Vec3]
  for (const triangle of upwardSurfaceTriangles(perimeterPoints)) {
    buffer.indices.push(
      ...triangle.map((index) => offset + perimeterOrder[index])
    )
  }
}

function offsetFromRoadEdge(
  edge: Vec2,
  oppositeEdge: Vec2,
  amount: number
): Vec2 {
  const dx = edge[0] - oppositeEdge[0]
  const dz = edge[1] - oppositeEdge[1]
  const length = Math.hypot(dx, dz) || 1
  return [edge[0] + (dx / length) * amount, edge[1] + (dz / length) * amount]
}

function cellPolygon(cell: CellManifestV3): Polygon {
  return polygonFromPoints([
    [cell.bounds[0], cell.bounds[1]],
    [cell.bounds[2], cell.bounds[1]],
    [cell.bounds[2], cell.bounds[3]],
    [cell.bounds[0], cell.bounds[3]],
  ])
}

function pointInPolygon(point: Vec2, polygon: Polygon) {
  return pointInMultiPolygon(point, [polygon])
}

function roadNormal(
  points: readonly Vec2[],
  index: number
): { tangent: Vec2; normal: Vec2 } {
  const start = points[index]
  const end = points[index + 1]
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const length = Math.hypot(dx, dz) || 1
  const tangent: Vec2 = [dx / length, dz / length]
  return { tangent, normal: [-tangent[1], tangent[0]] }
}

function roadEdgesAtPoint(road: SampledRoad, index: number) {
  const point = road.points[index]
  const halfWidth = road.source.width / 2
  const previous =
    index > 0 ? roadNormal(road.points, index - 1).normal : undefined
  const next =
    index < road.points.length - 1
      ? roadNormal(road.points, index).normal
      : undefined
  const reference = next ?? previous ?? ([1, 0] as Vec2)
  let miter: Vec2 = reference
  if (previous && next) {
    const length = Math.hypot(previous[0] + next[0], previous[1] + next[1])
    if (length > 1e-6) {
      miter = [
        (previous[0] + next[0]) / length,
        (previous[1] + next[1]) / length,
      ]
    }
  }
  const alignment = Math.max(
    0.68,
    Math.abs(miter[0] * reference[0] + miter[1] * reference[1])
  )
  const offset = Math.min(halfWidth * 1.45, halfWidth / alignment)
  return {
    left: [point[0] + miter[0] * offset, point[1] + miter[1] * offset] as Vec2,
    right: [point[0] - miter[0] * offset, point[1] - miter[1] * offset] as Vec2,
  }
}

export interface RoadEdgeSegmentV3 {
  roadId: string
  index: number
  center: Vec2
  tangent: Vec2
  normal: Vec2
  left: readonly [Vec2, Vec2]
  right: readonly [Vec2, Vec2]
}

export function roadEdgeSegment(
  road: SampledRoad,
  index: number
): RoadEdgeSegmentV3 {
  const start = road.points[index]
  const end = road.points[index + 1]
  const { tangent, normal } = roadNormal(road.points, index)
  const startEdges = roadEdgesAtPoint(road, index)
  const endEdges = roadEdgesAtPoint(road, index + 1)
  return {
    roadId: road.source.id,
    index,
    center: [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2],
    tangent,
    normal,
    left: [startEdges.left, endEdges.left],
    right: [startEdges.right, endEdges.right],
  }
}

/**
 * Reframes only the rendered road samples immediately around a bridge. The
 * authored road remains the source for terrain, buildings and checkpoint
 * placement; this local copy moves the visible curve upstream so the final
 * approach is straight without relocating the surrounding portfolio sites.
 */
export function realignRoadsForBridgeApproaches(
  roads: readonly SampledRoad[],
  drafts: readonly BridgeCrossingDraftV3[]
) {
  const projectedToBridgeAxis = (
    point: Vec2,
    draft: BridgeCrossingDraftV3
  ): Vec2 => {
    const dx = point[0] - draft.center[0]
    const dz = point[1] - draft.center[1]
    const longitudinal = dx * draft.tangent[0] + dz * draft.tangent[1]
    return [
      round(draft.center[0] + draft.tangent[0] * longitudinal, 5),
      round(draft.center[1] + draft.tangent[1] * longitudinal, 5),
    ]
  }
  const smootherstep = (value: number) =>
    value * value * value * (value * (value * 6 - 15) + 10)

  return roads.map<SampledRoad>((road) => {
    const points = road.points.map(([x, z]) => [x, z] as Vec2)
    for (const draft of drafts.filter(
      (candidate) => candidate.roadId === road.source.id
    )) {
      const workingRoad: SampledRoad = {
        ...road,
        points,
      }
      const segments = points
        .slice(0, -1)
        .map((_, index) => roadEdgeSegment(workingRoad, index))
      const inside = segments.map((segment) =>
        pointInPolygon(segment.center, draft.deckPolygon)
      )
      const firstInside = inside.findIndex(Boolean)
      const lastInside = inside.lastIndexOf(true)
      if (
        firstInside < 10 ||
        lastInside < firstInside ||
        lastInside + 5 >= points.length
      ) {
        continue
      }
      const incoming = segments[firstInside - 1].tangent
      const alignment = Math.max(
        -1,
        Math.min(
          1,
          draft.tangent[0] * incoming[0] + draft.tangent[1] * incoming[1]
        )
      )
      const headingDelta = (Math.acos(alignment) * 180) / Math.PI
      if (headingDelta <= BRIDGE_ROAD_REALIGN_THRESHOLD_V3) continue

      const straightSamples = 3
      const transitionSamples = 5
      const transitionStart =
        firstInside - straightSamples - transitionSamples
      const straightStart = firstInside - straightSamples
      for (let index = transitionStart; index <= straightStart; index += 1) {
        const amount = (index - transitionStart) / transitionSamples
        const blend = smootherstep(amount)
        if (blend <= 0) continue
        const original = points[index]
        const projected = projectedToBridgeAxis(original, draft)
        points[index] = [
          round(original[0] + (projected[0] - original[0]) * blend, 5),
          round(original[1] + (projected[1] - original[1]) * blend, 5),
        ]
      }
      for (let index = straightStart; index <= lastInside + 1; index += 1) {
        points[index] = projectedToBridgeAxis(points[index], draft)
      }
      const exitTransitionSamples = 3
      for (let step = 1; step <= exitTransitionSamples; step += 1) {
        const index = lastInside + 1 + step
        const blend = smootherstep(step / exitTransitionSamples)
        if (blend >= 1) continue
        const original = points[index]
        const projected = projectedToBridgeAxis(original, draft)
        points[index] = [
          round(projected[0] + (original[0] - projected[0]) * blend, 5),
          round(projected[1] + (original[1] - projected[1]) * blend, 5),
        ]
      }
    }

    const cumulativeLengths = [0]
    for (let index = 1; index < points.length; index += 1) {
      cumulativeLengths.push(
        cumulativeLengths[index - 1] + distance(points[index - 1], points[index])
      )
    }
    return {
      source: road.source,
      points,
      cumulativeLengths,
      length: cumulativeLengths[cumulativeLengths.length - 1],
    }
  })
}

function serializedWaterPolygon(
  shape: CompiledWaterShapeV3
): WaterBodyManifestV3["polygon"] {
  const polygon = [...shape.multiPolygon].sort(
    (a, b) =>
      Math.abs(boundsArea(b[0].slice(0, -1))) -
      Math.abs(boundsArea(a[0].slice(0, -1)))
  )[0]
  if (!polygon) return []
  const rings = polygon.map((ring) =>
    ring.slice(0, -1).map(([x, z]) => [round(x), round(z)] as Vec2)
  )
  return rings.length === 1 ? rings[0] : rings
}

function boundsArea(points: readonly [number, number][]) {
  const bounds = boundsOfPoints(points)
  return (bounds[2] - bounds[0]) * (bounds[3] - bounds[1])
}

export function compileWaterGeometry(
  waters: readonly CompiledWaterShapeV3[],
  cells: CellManifestV3[]
) {
  const geometries: GeometryDefinitionV3[] = []
  const manifests: WaterBodyManifestV3[] = []
  const materials: MaterialDefinitionV3[] = []
  for (const water of waters) {
    const materialId = `surface.${water.id}`
    materials.push({
      id: materialId,
      kind: "water",
      color:
        water.kind === "pond"
          ? "#62a6c7"
          : water.kind === "ocean"
            ? "#4f9fd7"
            : "#5ea9e1",
      roughness: water.kind === "pond" ? 0.5 : 0.44,
      vertexColors: false,
      flowDirection: water.flowDirection,
      flowSpeed: water.flowSpeed,
      flowStrength: water.flowStrength,
    })
    const geometryIds: string[] = []
    for (const cell of cells) {
      const clipped = intersection(water.multiPolygon, cellPolygon(cell))
      if (multiPolygonArea(clipped) < 0.01) continue
      const id = `geometry.${water.id}.${cell.id}`
      const geometry = triangulateMultiPolygonV3({
        id,
        kind: "water",
        materialId,
        y: water.waterLevel,
        multiPolygon: clipped,
      })
      if (geometry.indices.length === 0) continue
      geometries.push(geometry)
      geometryIds.push(id)
      cell.geometryIds.push(id)
      cell.waterBodyIds.push(water.id)
    }
    manifests.push({
      id: water.id,
      kind: water.kind,
      polygon: serializedWaterPolygon(water),
      waterLevel: water.waterLevel,
      flowDirection: water.flowDirection,
      flowSpeed: water.flowSpeed,
      flowStrength: water.flowStrength,
      geometryIds,
      walkable: false,
    })
  }
  return { geometries, manifests, materials }
}

interface CrownedDeckStation {
  center: Vec2
  height: number
}

function emptyBridgeGeometry(
  id: string,
  materialId: string,
  walkable: boolean
): GeometryDefinitionV3 {
  return {
    id,
    kind: "bridge",
    materialId,
    y: 0,
    positions: [],
    indices: [],
    walkable,
  }
}

function appendDoubleSidedQuad(
  geometry: GeometryDefinitionV3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3
) {
  const offset = geometry.positions.length / 3
  geometry.positions.push(...a, ...b, ...c, ...d)
  geometry.indices.push(
    offset,
    offset + 1,
    offset + 2,
    offset,
    offset + 2,
    offset + 3,
    offset + 2,
    offset + 1,
    offset,
    offset + 3,
    offset + 2,
    offset
  )
}

function appendOrientedBox(
  geometry: GeometryDefinitionV3,
  center: Vec2,
  tangent: Vec2,
  length: number,
  width: number,
  minimumY: number,
  maximumY: number
) {
  if (maximumY <= minimumY + 0.005) return
  const footprint = orientedRectangle(center, tangent, length, width)[0].slice(
    0,
    -1
  )
  const offset = geometry.positions.length / 3
  for (const [x, z] of footprint)
    geometry.positions.push(round(x), round(minimumY), round(z))
  for (const [x, z] of footprint)
    geometry.positions.push(round(x), round(maximumY), round(z))
  geometry.indices.push(
    offset,
    offset + 1,
    offset + 2,
    offset,
    offset + 2,
    offset + 3,
    offset + 4,
    offset + 6,
    offset + 5,
    offset + 4,
    offset + 7,
    offset + 6
  )
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4
    geometry.indices.push(
      offset + index,
      offset + 4 + next,
      offset + next,
      offset + index,
      offset + 4 + index,
      offset + 4 + next
    )
  }
}

function appendUpwardSurfaceQuad(
  geometry: GeometryDefinitionV3,
  points: readonly [Vec3, Vec3, Vec3, Vec3]
) {
  const offset = geometry.positions.length / 3
  geometry.positions.push(
    ...points[0],
    ...points[1],
    ...points[2],
    ...points[3]
  )
  for (const triangle of upwardSurfaceTriangles(points)) {
    geometry.indices.push(...triangle.map((index) => offset + index))
  }
}

function appendBridgeApproachApron(options: {
  deck: GeometryDefinitionV3
  verge: ColoredGeometryBuffer
  draft: BridgeCrossingDraftV3
  station: CrownedDeckStation
  outerLeftPoint: Vec2
  outerRightPoint: Vec2
  outerTangent: Vec2
  direction: -1 | 1
  field: TerrainFieldV3
}) {
  const {
    deck,
    verge,
    draft,
    station,
    outerLeftPoint,
    outerRightPoint,
    outerTangent,
    direction,
    field,
  } = options
  const deckHalfWidth = draft.width / 2
  const bridgeNormal: Vec2 = [-draft.tangent[1], draft.tangent[0]]
  const innerLeftPoint: Vec2 = [
    station.center[0] + bridgeNormal[0] * deckHalfWidth,
    station.center[1] + bridgeNormal[1] * deckHalfWidth,
  ]
  const innerRightPoint: Vec2 = [
    station.center[0] - bridgeNormal[0] * deckHalfWidth,
    station.center[1] - bridgeNormal[1] * deckHalfWidth,
  ]
  const outerCenter: Vec2 = [
    (outerLeftPoint[0] + outerRightPoint[0]) / 2,
    (outerLeftPoint[1] + outerRightPoint[1]) / 2,
  ]
  const span = distance(station.center, outerCenter)
  const leftSpan = distance(innerLeftPoint, outerLeftPoint)
  const rightSpan = distance(innerRightPoint, outerRightPoint)
  // Loft one symmetric road frame instead of bending the two boundaries
  // independently. Independent curves make the outside of a turn much longer
  // than the inside and read as a pointed shoulder wedge. A centered frame
  // keeps both sides equally wide while its zero-derivative width/normal blend
  // leaves each boundary tangent to the bridge and the sampled road.
  const handle = Math.max(
    0.01,
    Math.min(span * 0.32, leftSpan * 0.25, rightSpan * 0.25)
  )
  const innerDirection: Vec2 = [
    draft.tangent[0] * direction,
    draft.tangent[1] * direction,
  ]
  const outerDirection: Vec2 = [
    outerTangent[0] * direction,
    outerTangent[1] * direction,
  ]
  const centerControls: readonly [Vec2, Vec2] = [
    [
      station.center[0] + innerDirection[0] * handle,
      station.center[1] + innerDirection[1] * handle,
    ],
    [
      outerCenter[0] - outerDirection[0] * handle,
      outerCenter[1] - outerDirection[1] * handle,
    ],
  ]
  const smoothstep = (value: number) => value * value * (3 - 2 * value)
  const centerPointAt = (amount: number): Vec2 => {
    const inverse = 1 - amount
    return [
      inverse ** 3 * station.center[0] +
        3 * inverse ** 2 * amount * centerControls[0][0] +
        3 * inverse * amount ** 2 * centerControls[1][0] +
        amount ** 3 * outerCenter[0],
      inverse ** 3 * station.center[1] +
        3 * inverse ** 2 * amount * centerControls[0][1] +
        3 * inverse * amount ** 2 * centerControls[1][1] +
        amount ** 3 * outerCenter[1],
    ]
  }
  const outerHalfWidth = distance(outerLeftPoint, outerRightPoint) / 2
  const outerNormalLength =
    Math.hypot(
      outerLeftPoint[0] - outerRightPoint[0],
      outerLeftPoint[1] - outerRightPoint[1]
    ) || 1
  const outerNormal: Vec2 = [
    (outerLeftPoint[0] - outerRightPoint[0]) / outerNormalLength,
    (outerLeftPoint[1] - outerRightPoint[1]) / outerNormalLength,
  ]
  const frameAt = (amount: number) => {
    const blend = smoothstep(amount)
    const center =
      amount === 0
        ? station.center
        : amount === 1
          ? outerCenter
          : centerPointAt(amount)
    const normalX = bridgeNormal[0] + (outerNormal[0] - bridgeNormal[0]) * blend
    const normalZ = bridgeNormal[1] + (outerNormal[1] - bridgeNormal[1]) * blend
    const normalLength = Math.hypot(normalX, normalZ) || 1
    const normal: Vec2 = [normalX / normalLength, normalZ / normalLength]
    const halfWidth = deckHalfWidth + (outerHalfWidth - deckHalfWidth) * blend
    return {
      left: [
        center[0] + normal[0] * halfWidth,
        center[1] + normal[1] * halfWidth,
      ] as Vec2,
      right: [
        center[0] - normal[0] * halfWidth,
        center[1] - normal[1] * halfWidth,
      ] as Vec2,
    }
  }
  // Match the road compiler's roughly one-metre longitudinal tessellation.
  // Besides producing a visibly smooth bend, the smaller quads follow the
  // rendered terrain closely enough that an approach cannot cut through a
  // bank between its sampled vertices.
  const maximumBoundarySpan = Math.max(leftSpan, rightSpan)
  const intervals = Math.max(4, Math.ceil(maximumBoundarySpan / 0.9))
  const sectionAmounts = Array.from(
    { length: intervals + 1 },
    (_, index) => index / intervals
  )
  const sections = sectionAmounts.map((amount) => {
    const frame = frameAt(amount)
    const leftPoint = amount === 0 ? innerLeftPoint : frame.left
    const rightPoint = amount === 0 ? innerRightPoint : frame.right
    const heightBlend = smoothstep(amount)
    const surfacePoints = Array.from(
      { length: ROAD_LATERAL_SUBDIVISIONS + 1 },
      (_, crossSection): Vec3 => {
        const crossAmount = crossSection / ROAD_LATERAL_SUBDIVISIONS
        const point: Vec2 = [
          round(leftPoint[0] + (rightPoint[0] - leftPoint[0]) * crossAmount),
          round(leftPoint[1] + (rightPoint[1] - leftPoint[1]) * crossAmount),
        ]
        const terrainHeight =
          field.heightAt(point) + TRAVEL_SURFACE_CLEARANCE_V3
        const blendedHeight =
          station.height * (1 - heightBlend) +
          terrainHeight * heightBlend +
          (amount === 0 ? 0.006 : 0)
        return [
          point[0],
          round(Math.max(terrainHeight, blendedHeight)),
          point[1],
        ]
      }
    )
    const vergePoints = ([1, -1] as const).map((side) => {
      const edge = side === 1 ? leftPoint : rightPoint
      const opposite = side === 1 ? rightPoint : leftPoint
      return ROAD_VERGE_CROSS_SECTION.map(({ offset, lift }): Vec3 => {
        const point = offsetFromRoadEdge(edge, opposite, offset)
        const surfaceHeight =
          field.heightAt(point) + lift + 0.008 * (1 - amount)
        return [
          round(point[0]),
          round(
            station.height * (1 - heightBlend) + surfaceHeight * heightBlend
          ),
          round(point[1]),
        ]
      })
    })
    return {
      amount,
      surfacePoints,
      vergePoints,
    }
  })

  for (let index = 0; index < sections.length - 1; index += 1) {
    const current = sections[index]
    const next = sections[index + 1]
    for (
      let crossSection = 0;
      crossSection < ROAD_LATERAL_SUBDIVISIONS;
      crossSection += 1
    ) {
      appendUpwardSurfaceQuad(deck, [
        current.surfacePoints[crossSection],
        next.surfacePoints[crossSection],
        next.surfacePoints[crossSection + 1],
        current.surfacePoints[crossSection + 1],
      ])
    }
    // Keep the first shoulder section as a full-width abutment landing. The
    // road compiler clips pavement at the bridge boundary, so tapering or
    // omitting this short section exposes a triangular terrain sliver beside
    // the rail. Both ends remain square and every band reaches the deck seam.
    for (const sideIndex of [0, 1] as const) {
      for (
        let band = 0;
        band < ROAD_VERGE_CROSS_SECTION.length - 1;
        band += 1
      ) {
        appendColoredSurfaceQuad(
          verge,
          [
            current.vergePoints[sideIndex][band],
            next.vergePoints[sideIndex][band],
            current.vergePoints[sideIndex][band + 1],
            next.vergePoints[sideIndex][band + 1],
          ],
          ROAD_VERGE_CROSS_SECTION[band].color
        )
      }
    }
  }
}

interface BridgeApproachRoadEdges {
  start: {
    left: Vec2
    right: Vec2
    tangent: Vec2
  }
  end: {
    left: Vec2
    right: Vec2
    tangent: Vec2
  }
}

function bridgeApproachRoadEdges(
  road: SampledRoad,
  draft: BridgeCrossingDraftV3
): BridgeApproachRoadEdges {
  const segments = road.points
    .slice(0, -1)
    .map((_, index) => roadEdgeSegment(road, index))
  const inside = segments.map((segment) =>
    pointInPolygon(segment.center, draft.deckPolygon)
  )
  const firstInside = inside.findIndex(Boolean)
  const lastInside = inside.lastIndexOf(true)
  if (
    firstInside <= 0 ||
    lastInside < firstInside ||
    lastInside >= segments.length - 1
  ) {
    throw new Error(
      `${draft.id} requires sampled road segments on both approach banks`
    )
  }
  const immediateBefore = segments[firstInside - 1]
  const immediateAfter = segments[lastInside + 1]
  const before =
    segments[
      firstInside -
        bridgeApproachOwnedSegmentCount(draft.tangent, immediateBefore.tangent)
    ]
  const after =
    segments[
      lastInside +
        bridgeApproachOwnedSegmentCount(draft.tangent, immediateAfter.tangent)
    ]
  if (!before || !after) {
    throw new Error(`${draft.id} requires a complete dry-bank approach`)
  }
  return {
    start: {
      // The bridge owns this complete bank segment. Its far station gives the
      // centered loft genuine forward run instead of forcing a sideways turn
      // inside the last metre before the rail.
      left: before.left[0],
      right: before.right[0],
      tangent: before.tangent,
    },
    end: {
      left: after.left[1],
      right: after.right[1],
      tangent: after.tangent,
    },
  }
}

function deckProfile(draft: BridgeCrossingDraftV3, field: TerrainFieldV3) {
  const intervalCount = Math.max(8, Math.ceil(draft.length / 1.15))
  const normal: Vec2 = [-draft.tangent[1], draft.tangent[0]]
  const groundHeightAcrossDeck = (point: Vec2) =>
    Math.max(
      ...[-1, -0.5, 0, 0.5, 1].map((amount) =>
        field.heightAt([
          point[0] + normal[0] * (draft.width / 2) * amount,
          point[1] + normal[1] * (draft.width / 2) * amount,
        ])
      )
    )
  const start: Vec2 = [
    draft.center[0] - draft.tangent[0] * (draft.length / 2),
    draft.center[1] - draft.tangent[1] * (draft.length / 2),
  ]
  const end: Vec2 = [
    draft.center[0] + draft.tangent[0] * (draft.length / 2),
    draft.center[1] + draft.tangent[1] * (draft.length / 2),
  ]
  const startHeight =
    groundHeightAcrossDeck(start) + TRAVEL_CENTERLINE_CLEARANCE_V3
  const endHeight = groundHeightAcrossDeck(end) + TRAVEL_CENTERLINE_CLEARANCE_V3
  const entryHeight =
    groundHeightAcrossDeck(draft.entry) + TRAVEL_CENTERLINE_CLEARANCE_V3
  const exitHeight =
    groundHeightAcrossDeck(draft.exit) + TRAVEL_CENTERLINE_CLEARANCE_V3
  const groundedSpan = distance(draft.entry, draft.exit)
  const approachLength = Math.max(0, (draft.length - groundedSpan) / 2)
  const entryProgress = Math.min(0.24, approachLength / draft.length)
  const exitProgress = 1 - entryProgress
  const smoothstep = (value: number) => value * value * (3 - 2 * value)
  const progressValues = [
    ...Array.from(
      { length: intervalCount + 1 },
      (_, index) => index / intervalCount
    ),
    entryProgress,
    exitProgress,
  ]
    .sort((a, b) => a - b)
    .filter(
      (progress, index, values) =>
        index === 0 || Math.abs(progress - values[index - 1]) > 1e-5
    )
  const profileForRise = (rise: number) =>
    progressValues.map((progress) => {
      if (progress <= entryProgress && entryProgress > 1e-6) {
        const local = smoothstep(progress / entryProgress)
        return startHeight + (entryHeight - startHeight) * local
      }
      if (progress >= exitProgress && exitProgress < 1 - 1e-6) {
        const local = smoothstep((progress - exitProgress) / (1 - exitProgress))
        return exitHeight + (endHeight - exitHeight) * local
      }
      const local =
        (progress - entryProgress) /
        Math.max(1e-6, exitProgress - entryProgress)
      const baseline = entryHeight + (exitHeight - entryHeight) * local
      const crown = rise * 16 * local * local * (1 - local) * (1 - local)
      return baseline + crown
    })
  const maximumGrade = (heights: readonly number[]) =>
    heights.slice(1).reduce((maximum, height, index) => {
      const run =
        (progressValues[index + 1] - progressValues[index]) * draft.length
      return Math.max(maximum, Math.abs(height - heights[index]) / run)
    }, 0)

  let crownRise = Math.min(0.42, Math.max(0.24, draft.length * 0.025))
  let heights = profileForRise(crownRise)
  while (maximumGrade(heights) > 0.075 && crownRise > 0.08) {
    crownRise *= 0.9
    heights = profileForRise(crownRise)
  }

  const stations = heights.map<CrownedDeckStation>((height, index) => {
    const progress = progressValues[index]
    return {
      center: [
        round(start[0] + (end[0] - start[0]) * progress),
        round(start[1] + (end[1] - start[1]) * progress),
      ],
      height: round(height),
    }
  })
  return {
    stations,
    crownRise: round(crownRise),
  }
}

function appendRailRibbon(
  geometry: GeometryDefinitionV3,
  stations: readonly CrownedDeckStation[],
  normal: Vec2,
  side: -1 | 1,
  lateralOffset: number,
  verticalOffset: number,
  thickness: number
) {
  const half = thickness / 2
  for (let index = 0; index < stations.length - 1; index += 1) {
    const first = stations[index]
    const second = stations[index + 1]
    const firstCenter: Vec2 = [
      first.center[0] + normal[0] * lateralOffset * side,
      first.center[1] + normal[1] * lateralOffset * side,
    ]
    const secondCenter: Vec2 = [
      second.center[0] + normal[0] * lateralOffset * side,
      second.center[1] + normal[1] * lateralOffset * side,
    ]
    const across: Vec2 = [normal[0] * half, normal[1] * half]
    const firstBottom = first.height + verticalOffset - half
    const firstTop = first.height + verticalOffset + half
    const secondBottom = second.height + verticalOffset - half
    const secondTop = second.height + verticalOffset + half
    const a: Vec3 = [
      firstCenter[0] - across[0],
      firstBottom,
      firstCenter[1] - across[1],
    ]
    const b: Vec3 = [
      secondCenter[0] - across[0],
      secondBottom,
      secondCenter[1] - across[1],
    ]
    const c: Vec3 = [
      secondCenter[0] + across[0],
      secondBottom,
      secondCenter[1] + across[1],
    ]
    const d: Vec3 = [
      firstCenter[0] + across[0],
      firstBottom,
      firstCenter[1] + across[1],
    ]
    const e: Vec3 = [a[0], firstTop, a[2]]
    const f: Vec3 = [b[0], secondTop, b[2]]
    const g: Vec3 = [c[0], secondTop, c[2]]
    const h: Vec3 = [d[0], firstTop, d[2]]
    appendDoubleSidedQuad(geometry, a, b, f, e)
    appendDoubleSidedQuad(geometry, d, h, g, c)
    appendDoubleSidedQuad(geometry, e, f, g, h)
    appendDoubleSidedQuad(geometry, a, d, c, b)
  }
}

export function compileBridges(
  drafts: readonly BridgeCrossingDraftV3[],
  waters: readonly CompiledWaterShapeV3[],
  roads: readonly SampledRoad[],
  world: AuthoredWorldV3,
  cells: CellManifestV3[],
  field: TerrainFieldV3
) {
  const geometries: GeometryDefinitionV3[] = []
  const bridges: BridgeManifestV3[] = []
  const colliders: ColliderManifest[] = []
  for (const draft of drafts) {
    const water = waters.find((candidate) => candidate.id === draft.waterBodyId)
    if (!water)
      throw new Error(`${draft.id} references missing ${draft.waterBodyId}`)
    const { stations, crownRise } = deckProfile(draft, field)
    const deckThickness = 0.26
    const deckHeight = round(
      Math.max(...stations.map((station) => station.height))
    )
    const normal: Vec2 = [-draft.tangent[1], draft.tangent[0]]
    const road = roads.find((candidate) => candidate.source.id === draft.roadId)
    if (!road) throw new Error(`${draft.id} references missing ${draft.roadId}`)
    const approachRoadEdges = bridgeApproachRoadEdges(road, draft)
    const halfWidth = draft.width / 2
    const deck = emptyBridgeGeometry(
      `geometry.${draft.id}.deck`,
      "surface.road-summer",
      true
    )
    for (const station of stations) {
      deck.positions.push(
        round(station.center[0] + normal[0] * halfWidth),
        station.height,
        round(station.center[1] + normal[1] * halfWidth),
        round(station.center[0] - normal[0] * halfWidth),
        station.height,
        round(station.center[1] - normal[1] * halfWidth)
      )
    }
    for (let index = 0; index < stations.length - 1; index += 1) {
      const left = index * 2
      const right = left + 1
      const nextLeft = left + 2
      const nextRight = left + 3
      deck.indices.push(left, nextLeft, right, nextLeft, nextRight, right)
    }
    const approachVerge: ColoredGeometryBuffer = {
      positions: [],
      indices: [],
      colors: [],
    }
    appendBridgeApproachApron({
      deck,
      verge: approachVerge,
      draft,
      station: stations[0],
      outerLeftPoint: approachRoadEdges.start.left,
      outerRightPoint: approachRoadEdges.start.right,
      outerTangent: approachRoadEdges.start.tangent,
      direction: -1,
      field,
    })
    appendBridgeApproachApron({
      deck,
      verge: approachVerge,
      draft,
      station: stations[stations.length - 1],
      outerLeftPoint: approachRoadEdges.end.left,
      outerRightPoint: approachRoadEdges.end.right,
      outerTangent: approachRoadEdges.end.tangent,
      direction: 1,
      field,
    })
    const approachVergeGeometry: GeometryDefinitionV3 = {
      id: `geometry.${draft.id}.approach-verges`,
      kind: "bridge",
      materialId: "surface.road-verge",
      y: 0,
      positions: approachVerge.positions,
      indices: approachVerge.indices,
      colors: approachVerge.colors,
      walkable: false,
    }

    const structure = emptyBridgeGeometry(
      `geometry.${draft.id}.structure`,
      "surface.bridge-support",
      false
    )
    for (let index = 0; index < stations.length - 1; index += 1) {
      const first = stations[index]
      const second = stations[index + 1]
      const firstLeft: Vec3 = [
        first.center[0] + normal[0] * halfWidth,
        first.height - deckThickness,
        first.center[1] + normal[1] * halfWidth,
      ]
      const firstRight: Vec3 = [
        first.center[0] - normal[0] * halfWidth,
        first.height - deckThickness,
        first.center[1] - normal[1] * halfWidth,
      ]
      const secondLeft: Vec3 = [
        second.center[0] + normal[0] * halfWidth,
        second.height - deckThickness,
        second.center[1] + normal[1] * halfWidth,
      ]
      const secondRight: Vec3 = [
        second.center[0] - normal[0] * halfWidth,
        second.height - deckThickness,
        second.center[1] - normal[1] * halfWidth,
      ]
      appendDoubleSidedQuad(
        structure,
        firstLeft,
        firstRight,
        secondRight,
        secondLeft
      )
      appendDoubleSidedQuad(
        structure,
        [firstLeft[0], first.height - 0.025, firstLeft[2]],
        [secondLeft[0], second.height - 0.025, secondLeft[2]],
        secondLeft,
        firstLeft
      )
      appendDoubleSidedQuad(
        structure,
        firstRight,
        secondRight,
        [secondRight[0], second.height - 0.025, secondRight[2]],
        [firstRight[0], first.height - 0.025, firstRight[2]]
      )
    }
    for (const station of [stations[0], stations[stations.length - 1]]) {
      appendOrientedBox(
        structure,
        station.center,
        draft.tangent,
        0.58,
        draft.width + 0.32,
        station.height - deckThickness - 0.48,
        station.height - 0.035
      )
    }
    if (draft.length >= 13) {
      const middle = stations[Math.floor(stations.length / 2)]
      const supportTop = middle.height - deckThickness - 0.04
      const supportBottom = water.waterLevel - 0.2
      for (const side of [-1, 1] as const) {
        appendOrientedBox(
          structure,
          [
            middle.center[0] + normal[0] * draft.width * 0.22 * side,
            middle.center[1] + normal[1] * draft.width * 0.22 * side,
          ],
          draft.tangent,
          0.62,
          0.56,
          supportBottom,
          supportTop
        )
      }
      appendOrientedBox(
        structure,
        middle.center,
        draft.tangent,
        0.68,
        draft.width * 0.7,
        supportTop - 0.16,
        supportTop + 0.02
      )
    }

    const railOffset = halfWidth - 0.16
    const railNormal: Vec2 = [-draft.tangent[1], draft.tangent[0]]
    const railSides = [-1, 1] as const
    const railFootprints = railSides.map((side) =>
      orientedRectangle(
        [
          draft.center[0] + railNormal[0] * railOffset * side,
          draft.center[1] + railNormal[1] * railOffset * side,
        ],
        draft.tangent,
        draft.length,
        0.18
      )
    )
    const railGeometry = emptyBridgeGeometry(
      `geometry.${draft.id}.rails`,
      "surface.bridge-rail",
      false
    )
    for (const side of railSides) {
      for (let index = 0; index < stations.length; index += 2) {
        const station = stations[index]
        appendOrientedBox(
          railGeometry,
          [
            station.center[0] + railNormal[0] * railOffset * side,
            station.center[1] + railNormal[1] * railOffset * side,
          ],
          draft.tangent,
          0.13,
          0.13,
          station.height + 0.025,
          station.height + 0.86
        )
      }
      if ((stations.length - 1) % 2 !== 0) {
        const station = stations[stations.length - 1]
        appendOrientedBox(
          railGeometry,
          [
            station.center[0] + railNormal[0] * railOffset * side,
            station.center[1] + railNormal[1] * railOffset * side,
          ],
          draft.tangent,
          0.13,
          0.13,
          station.height + 0.025,
          station.height + 0.86
        )
      }
      appendRailRibbon(
        railGeometry,
        stations,
        railNormal,
        side,
        railOffset,
        0.48,
        0.085
      )
      appendRailRibbon(
        railGeometry,
        stations,
        railNormal,
        side,
        railOffset,
        0.79,
        0.085
      )
    }

    const markings = emptyBridgeGeometry(
      `geometry.${draft.id}.markings`,
      "surface.road-marking",
      false
    )
    for (let index = 0; index < stations.length - 1; index += 2) {
      const first = stations[index]
      const second = stations[index + 1]
      const start: Vec3 = [
        first.center[0] + (second.center[0] - first.center[0]) * 0.16,
        first.height + (second.height - first.height) * 0.16 + 0.026,
        first.center[1] + (second.center[1] - first.center[1]) * 0.16,
      ]
      const end: Vec3 = [
        first.center[0] + (second.center[0] - first.center[0]) * 0.84,
        first.height + (second.height - first.height) * 0.84 + 0.026,
        first.center[1] + (second.center[1] - first.center[1]) * 0.84,
      ]
      const markerHalfWidth = 0.085
      appendDoubleSidedQuad(
        markings,
        [
          start[0] + normal[0] * markerHalfWidth,
          start[1],
          start[2] + normal[1] * markerHalfWidth,
        ],
        [
          end[0] + normal[0] * markerHalfWidth,
          end[1],
          end[2] + normal[1] * markerHalfWidth,
        ],
        [
          end[0] - normal[0] * markerHalfWidth,
          end[1],
          end[2] - normal[1] * markerHalfWidth,
        ],
        [
          start[0] - normal[0] * markerHalfWidth,
          start[1],
          start[2] - normal[1] * markerHalfWidth,
        ]
      )
    }

    geometries.push(
      deck,
      approachVergeGeometry,
      structure,
      railGeometry,
      markings
    )
    const cellId = cellIdAtV3(draft.center, world)
    const cell = cells.find((candidate) => candidate.id === cellId)
    if (!cell) throw new Error(`${draft.id} is outside the compiled world`)
    cell.geometryIds.push(
      deck.id,
      approachVergeGeometry.id,
      structure.id,
      railGeometry.id,
      markings.id
    )
    cell.bridgeIds.push(draft.id)
    const railColliderIds = railSides.map(
      (side) => `collider.${draft.id}.rail.${side === -1 ? "left" : "right"}`
    ) as [string, string]
    railFootprints.forEach((footprint, index) => {
      const collider: ColliderManifest = {
        id: railColliderIds[index],
        kind: "polygon",
        cellId,
        polygon: footprint[0]
          .slice(0, -1)
          .map(([x, z]) => [round(x), round(z)] as Vec2),
        minY: round(Math.min(...stations.map((station) => station.height))),
        maxY: round(deckHeight + 0.9),
      }
      colliders.push(collider)
      cell.colliderIds.push(collider.id)
    })
    bridges.push({
      id: draft.id,
      roadId: draft.roadId,
      waterBodyId: draft.waterBodyId,
      center: [round(draft.center[0]), deckHeight, round(draft.center[1])],
      tangent: [round(draft.tangent[0]), round(draft.tangent[1])],
      width: round(draft.width),
      length: round(draft.length),
      deckHeight,
      deckCenterline: stations.map(
        (station) =>
          [station.center[0], station.height, station.center[1]] as Vec3
      ),
      crownRise,
      deckThickness,
      deckPolygon: draft.deckPolygon[0]
        .slice(0, -1)
        .map(([x, z]) => [round(x), round(z)] as Vec2),
      geometryIds: [
        deck.id,
        approachVergeGeometry.id,
        structure.id,
        railGeometry.id,
        markings.id,
      ],
      railColliderIds,
      navNodeIds: ["", ""],
      walkable: true,
    })
  }
  return { geometries, bridges, colliders }
}

function bridgeAtPoint(point: Vec2, bridges: readonly BridgeManifestV3[]) {
  return bridges.find((bridge) =>
    pointInPolygon(point, polygonFromPoints(bridge.deckPolygon))
  )
}

function bridgeOwnedApproachSegments(
  road: SampledRoad,
  bridges: readonly BridgeManifestV3[]
) {
  const segments = road.points
    .slice(0, -1)
    .map((_, index) => roadEdgeSegment(road, index))
  const owned = new Set<number>()
  for (const bridge of bridges) {
    if (bridge.roadId !== road.source.id) continue
    const polygon = polygonFromPoints(bridge.deckPolygon)
    const inside = segments.map((segment) =>
      pointInPolygon(segment.center, polygon)
    )
    const firstInside = inside.findIndex(Boolean)
    const lastInside = inside.lastIndexOf(true)
    const startCount = bridgeApproachOwnedSegmentCount(
      bridge.tangent,
      segments[firstInside - 1].tangent
    )
    const endCount = bridgeApproachOwnedSegmentCount(
      bridge.tangent,
      segments[lastInside + 1].tangent
    )
    for (
      let offset = 1;
      offset <= Math.max(startCount, endCount);
      offset += 1
    ) {
      if (offset <= startCount && firstInside >= offset)
        owned.add(firstInside - offset)
      if (
        offset <= endCount &&
        lastInside >= 0 &&
        lastInside + offset < segments.length
      )
        owned.add(lastInside + offset)
    }
  }
  return owned
}

/**
 * Samples the compiler-owned crowned travel profile. Older generated packages
 * did not serialize a profile and intentionally retain their flat height.
 */
export function bridgeDeckHeightAt(bridge: BridgeManifestV3, point: Vec2) {
  const profile = bridge.deckCenterline
  if (!profile || profile.length < 2) return bridge.deckHeight

  let nearestDistanceSquared = Number.POSITIVE_INFINITY
  let nearestHeight = bridge.deckHeight
  for (let index = 0; index < profile.length - 1; index += 1) {
    const start = profile[index]
    const end = profile[index + 1]
    const dx = end[0] - start[0]
    const dz = end[2] - start[2]
    const lengthSquared = dx * dx + dz * dz
    const progress =
      lengthSquared <= 1e-9
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point[0] - start[0]) * dx + (point[1] - start[2]) * dz) /
                lengthSquared
            )
          )
    const x = start[0] + dx * progress
    const z = start[2] + dz * progress
    const distanceSquared = (point[0] - x) ** 2 + (point[1] - z) ** 2
    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared
      nearestHeight = start[1] + (end[1] - start[1]) * progress
    }
  }
  return round(nearestHeight)
}

function roadSideHasArrivalOpening(
  world: AuthoredWorldV3,
  road: SampledRoad,
  segmentIndex: number,
  side: -1 | 1
) {
  return world.environmentalBuildings.some(
    (building) =>
      building.roadId === road.source.id &&
      building.roadSide === side &&
      Math.max(
        0,
        Math.min(
          road.points.length - 2,
          Math.round(
            building.roadProgress * Math.max(0, road.points.length - 2)
          )
        )
      ) === segmentIndex
  )
}

function roadVergeTouchesWater(
  segment: RoadEdgeSegmentV3,
  side: -1 | 1,
  waters: readonly CompiledWaterShapeV3[]
) {
  const edge = side === 1 ? segment.left : segment.right
  const opposite = side === 1 ? segment.right : segment.left
  const outerStart = offsetFromRoadEdge(
    edge[0],
    opposite[0],
    ROAD_VERGE_WIDTH_V3
  )
  const outerEnd = offsetFromRoadEdge(edge[1], opposite[1], ROAD_VERGE_WIDTH_V3)
  const outerMiddle: Vec2 = [
    (outerStart[0] + outerEnd[0]) / 2,
    (outerStart[1] + outerEnd[1]) / 2,
  ]
  return [edge[0], edge[1], outerStart, outerMiddle, outerEnd].some((point) =>
    waters.some((water) => pointInMultiPolygon(point, water.multiPolygon))
  )
}

function appendRoadVerge(
  buffer: ColoredGeometryBuffer,
  segment: RoadEdgeSegmentV3,
  side: -1 | 1,
  field: TerrainFieldV3
) {
  const edge = side === 1 ? segment.left : segment.right
  const opposite = side === 1 ? segment.right : segment.left
  // The first two bands read as a compacted shoulder and worn outer edge. The
  // narrow dark band is a shallow monsoon drain cue; its elevation remains
  // above the terrain mesh so it cannot create a hidden traversal trench.
  const startPoints = ROAD_VERGE_CROSS_SECTION.map(({ offset }) =>
    offsetFromRoadEdge(edge[0], opposite[0], offset)
  )
  const endPoints = ROAD_VERGE_CROSS_SECTION.map(({ offset }) =>
    offsetFromRoadEdge(edge[1], opposite[1], offset)
  )
  const pointAt = (point: Vec2, lift: number): Vec3 => [
    round(point[0]),
    round(field.heightAt(point) + lift),
    round(point[1]),
  ]
  for (let index = 0; index < ROAD_VERGE_CROSS_SECTION.length - 1; index += 1) {
    const near = ROAD_VERGE_CROSS_SECTION[index]
    const far = ROAD_VERGE_CROSS_SECTION[index + 1]
    const nearStart = pointAt(startPoints[index], near.lift)
    const nearEnd = pointAt(endPoints[index], near.lift)
    const farStart = pointAt(startPoints[index + 1], far.lift)
    const farEnd = pointAt(endPoints[index + 1], far.lift)
    appendColoredSurfaceQuad(
      buffer,
      side === 1
        ? [farStart, farEnd, nearStart, nearEnd]
        : [nearStart, nearEnd, farStart, farEnd],
      near.color
    )
  }
}

export function compileRoadGeometry(options: {
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  waters: readonly CompiledWaterShapeV3[]
  bridges: readonly BridgeManifestV3[]
  cells: CellManifestV3[]
  field: TerrainFieldV3
}) {
  const geometries: GeometryDefinitionV3[] = []
  const manifests: RoadManifestV3[] = []
  for (const road of options.roads) {
    const bridgeOwnedSegments = bridgeOwnedApproachSegments(
      road,
      options.bridges
    )
    const groups = new Map<string, RoadEdgeSegmentV3[]>()
    for (let index = 0; index < road.points.length - 1; index += 1) {
      const segment = roadEdgeSegment(road, index)
      if (bridgeOwnedSegments.has(segment.index)) continue
      const bridge = bridgeAtPoint(segment.center, options.bridges)
      if (bridge) continue
      const water = options.waters.find((candidate) =>
        pointInMultiPolygon(segment.center, candidate.multiPolygon)
      )
      if (water) {
        throw new Error(
          `${road.source.id} crosses ${water.id} without a bridge deck`
        )
      }
      const cellId = cellIdAtV3(segment.center, options.world)
      const group = groups.get(cellId) ?? []
      group.push(segment)
      groups.set(cellId, group)
    }

    const surfaceGeometryIds: string[] = []
    for (const [cellId, segments] of groups) {
      const positions: number[] = []
      const indices: number[] = []
      const markingPositions: number[] = []
      const markingIndices: number[] = []
      const verge: ColoredGeometryBuffer = {
        positions: [],
        indices: [],
        colors: [],
      }
      for (const segment of segments) {
        // A road segment is wider than one terrain-grid interval. Splitting it
        // laterally keeps each pavement triangle close to the same rendered
        // terrain plane instead of spanning across several terrain diagonals.
        const interpolate = (start: Vec2, end: Vec2, amount: number): Vec2 => [
          start[0] + (end[0] - start[0]) * amount,
          start[1] + (end[1] - start[1]) * amount,
        ]
        for (
          let longitudinal = 0;
          longitudinal < ROAD_LONGITUDINAL_SUBDIVISIONS;
          longitudinal += 1
        ) {
          const startAmount = longitudinal / ROAD_LONGITUDINAL_SUBDIVISIONS
          const endAmount = (longitudinal + 1) / ROAD_LONGITUDINAL_SUBDIVISIONS
          const startLeft = interpolate(
            segment.left[0],
            segment.left[1],
            startAmount
          )
          const startRight = interpolate(
            segment.right[0],
            segment.right[1],
            startAmount
          )
          const endLeft = interpolate(
            segment.left[0],
            segment.left[1],
            endAmount
          )
          const endRight = interpolate(
            segment.right[0],
            segment.right[1],
            endAmount
          )
          for (
            let crossSection = 0;
            crossSection < ROAD_LATERAL_SUBDIVISIONS;
            crossSection += 1
          ) {
            const leftAmount = crossSection / ROAD_LATERAL_SUBDIVISIONS
            const rightAmount = (crossSection + 1) / ROAD_LATERAL_SUBDIVISIONS
            const corners = [
              interpolate(startLeft, startRight, leftAmount),
              interpolate(endLeft, endRight, leftAmount),
              interpolate(startLeft, startRight, rightAmount),
              interpolate(endLeft, endRight, rightAmount),
            ]
            const offset = positions.length / 3
            for (const point of corners) {
              const serializedPoint: Vec2 = [round(point[0]), round(point[1])]
              positions.push(
                serializedPoint[0],
                round(
                  options.field.heightAt(serializedPoint) +
                    TRAVEL_SURFACE_CLEARANCE_V3
                ),
                serializedPoint[1]
              )
            }
            indices.push(
              offset,
              offset + 1,
              offset + 2,
              offset + 1,
              offset + 3,
              offset + 2
            )
          }
        }
        const turnaroundRadius = road.source.endTurnaroundRadius
        const insideTurnaround =
          turnaroundRadius !== undefined &&
          distance(segment.center, road.points[road.points.length - 1]) <=
            turnaroundRadius + 0.1
        if (segment.index % 2 === 0 && !insideTurnaround) {
          const segmentLength = distance(
            road.points[segment.index],
            road.points[segment.index + 1]
          )
          const halfLength = Math.min(0.7, segmentLength * 0.34)
          const halfWidth = 0.085
          const start: Vec2 = [
            segment.center[0] - segment.tangent[0] * halfLength,
            segment.center[1] - segment.tangent[1] * halfLength,
          ]
          const end: Vec2 = [
            segment.center[0] + segment.tangent[0] * halfLength,
            segment.center[1] + segment.tangent[1] * halfLength,
          ]
          const markingOffset = markingPositions.length / 3
          for (const point of [
            [
              start[0] + segment.normal[0] * halfWidth,
              start[1] + segment.normal[1] * halfWidth,
            ],
            [
              end[0] + segment.normal[0] * halfWidth,
              end[1] + segment.normal[1] * halfWidth,
            ],
            [
              start[0] - segment.normal[0] * halfWidth,
              start[1] - segment.normal[1] * halfWidth,
            ],
            [
              end[0] - segment.normal[0] * halfWidth,
              end[1] - segment.normal[1] * halfWidth,
            ],
          ] as Vec2[]) {
            markingPositions.push(
              round(point[0]),
              round(options.field.heightAt(point) + ROAD_MARKING_CLEARANCE_V3),
              round(point[1])
            )
          }
          markingIndices.push(
            markingOffset,
            markingOffset + 1,
            markingOffset + 2,
            markingOffset + 1,
            markingOffset + 3,
            markingOffset + 2
          )
        }
        for (const side of [-1, 1] as const) {
          if (
            !insideTurnaround &&
            !roadSideHasArrivalOpening(
              options.world,
              road,
              segment.index,
              side
            ) &&
            !roadVergeTouchesWater(segment, side, options.waters)
          ) {
            appendRoadVerge(verge, segment, side, options.field)
          }
        }
      }
      const id = `geometry.road.${road.source.id}.${cellId}`
      geometries.push({
        id,
        kind: "surface",
        materialId: "surface.road-summer",
        y: 0,
        positions,
        indices,
      })
      surfaceGeometryIds.push(id)
      const cell = options.cells.find((candidate) => candidate.id === cellId)
      cell?.geometryIds.push(id)
      if (markingIndices.length > 0) {
        const markingId = `geometry.road-markings.${road.source.id}.${cellId}`
        geometries.push({
          id: markingId,
          kind: "surface",
          materialId: "surface.road-marking",
          y: 0,
          positions: markingPositions,
          indices: markingIndices,
        })
        cell?.geometryIds.push(markingId)
      }
      if (verge.indices.length > 0) {
        const vergeId = `geometry.road-verge.${road.source.id}.${cellId}`
        geometries.push({
          id: vergeId,
          kind: "surface",
          materialId: "surface.road-verge",
          y: 0,
          positions: verge.positions,
          indices: verge.indices,
          colors: verge.colors,
          walkable: false,
        })
        cell?.geometryIds.push(vergeId)
      }
    }

    const endTurnaroundRadius = road.source.endTurnaroundRadius
    if (endTurnaroundRadius !== undefined) {
      if (
        !Number.isFinite(endTurnaroundRadius) ||
        endTurnaroundRadius < road.source.width / 2
      ) {
        throw new Error(
          `${road.source.id} turnaround radius must cover the road width`
        )
      }
      const endpoint = road.points[road.points.length - 1]
      const cellId = cellIdAtV3(endpoint, options.world)
      const id = `geometry.road-turnaround.${road.source.id}`
      const geometry = triangulateMultiPolygonV3({
        id,
        kind: "surface",
        materialId: "surface.road-summer",
        y: 0,
        multiPolygon: [circlePolygon(endpoint, endTurnaroundRadius, 24)],
      })
      for (let index = 0; index < geometry.positions.length; index += 3) {
        geometry.positions[index + 1] = round(
          options.field.heightAt([
            geometry.positions[index],
            geometry.positions[index + 2],
          ]) + TRAVEL_SURFACE_CLEARANCE_V3
        )
      }
      geometries.push(geometry)
      surfaceGeometryIds.push(id)
      const cell = options.cells.find((candidate) => candidate.id === cellId)
      cell?.geometryIds.push(id)

      const vergeId = `geometry.road-turnaround-verge.${road.source.id}`
      const verge = triangulateMultiPolygonV3({
        id: vergeId,
        kind: "surface",
        materialId: "surface.road-verge",
        y: 0,
        multiPolygon: difference(
          [
            circlePolygon(
              endpoint,
              endTurnaroundRadius + ROAD_VERGE_WIDTH_V3,
              32
            ),
          ],
          [circlePolygon(endpoint, endTurnaroundRadius + 0.04, 32)]
        ),
      })
      verge.colors = []
      for (let index = 0; index < verge.positions.length; index += 3) {
        const point: Vec2 = [verge.positions[index], verge.positions[index + 2]]
        verge.positions[index + 1] = round(options.field.heightAt(point) + 0.02)
        verge.colors.push(...colorChannels("#b29a73"))
      }
      verge.walkable = false
      geometries.push(verge)
      cell?.geometryIds.push(vergeId)
    }

    const centerline = road.points.map<Vec3>((point) => {
      const bridge = bridgeAtPoint(point, options.bridges)
      return [
        round(point[0]),
        bridge
          ? round(bridgeDeckHeightAt(bridge, point) + 0.02)
          : round(
              options.field.heightAt(point) + TRAVEL_CENTERLINE_CLEARANCE_V3
            ),
        round(point[1]),
      ]
    })
    manifests.push({
      id: road.source.id,
      from: road.source.from,
      to: road.source.to,
      width: road.source.width,
      ...(endTurnaroundRadius === undefined
        ? {}
        : { endTurnaroundRadius: round(endTurnaroundRadius) }),
      centerline,
      surfaceGeometryIds,
      sharedJunctionIds: [],
    })
  }
  return { geometries, manifests }
}
