import polygonClipping, { type MultiPolygon } from "polygon-clipping"

import type {
  AuthoredWorldV3,
  BridgeManifestV3,
  CellManifestV3,
  GeometryDefinitionV3,
  NavigationEdgeV3,
  NavigationNodeV3,
  PortfolioCheckpointManifestV3,
  Vec2,
  Vec3,
} from "../contracts/world.ts"
import {
  circlePolygon,
  distance,
  normalize,
  orientedRectangle,
  pointInMultiPolygon,
  round,
} from "./geometry.ts"
import { polygonFromPoints, triangulateMultiPolygonV3 } from "./geometry-v3.ts"
import type { CompiledEnvironmentalBuildingV3 } from "./building-kit.ts"
import { bridgeDeckHeightAt } from "./bridges.ts"
import type { CompiledWaterShapeV3 } from "./hydrology.ts"
import type { SampledRoad } from "./roads.ts"
import {
  ACCESS_SURFACE_CLEARANCE_V3,
  cellIdAtV3,
  TRAVEL_CENTERLINE_CLEARANCE_V3,
  TRAVEL_SURFACE_CLEARANCE_V3,
  type TerrainFieldV3,
} from "./terrain.ts"

const { difference } = polygonClipping

interface ColoredSiteBuffer {
  positions: number[]
  indices: number[]
  colors: number[]
}

function siteColorChannels(hex: string): readonly [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ]
}

function movePoint(
  point: Vec2,
  tangent: Vec2,
  outward: Vec2,
  along: number,
  across: number
): Vec2 {
  return [
    point[0] + tangent[0] * along + outward[0] * across,
    point[1] + tangent[1] * along + outward[1] * across,
  ]
}

function appendColoredSiteShape(options: {
  buffer: ColoredSiteBuffer
  id: string
  multiPolygon: MultiPolygon
  color: string
  field: TerrainFieldV3
  clearance: number
}) {
  if (options.multiPolygon.length === 0) return
  const shape = triangulateMultiPolygonV3({
    id: options.id,
    kind: "surface",
    materialId: "surface.forecourt-detail",
    y: 0,
    multiPolygon: options.multiPolygon,
  })
  const vertexOffset = options.buffer.positions.length / 3
  const channels = siteColorChannels(options.color)
  for (let index = 0; index < shape.positions.length; index += 3) {
    const point: Vec2 = [shape.positions[index], shape.positions[index + 2]]
    options.buffer.positions.push(
      round(point[0]),
      round(options.field.heightAt(point) + options.clearance),
      round(point[1])
    )
    options.buffer.colors.push(...channels)
  }
  for (const index of shape.indices) {
    options.buffer.indices.push(vertexOffset + index)
  }
}

function forecourtAccent(districtId: string) {
  return (
    {
      town: "#b96f4f",
      education: "#a9664d",
      career: "#5f8790",
      learning: "#62866f",
      projects: "#b66e46",
      community: "#a9824e",
      contact: "#3f765c",
    }[districtId] ?? "#8a7257"
  )
}

function forecourtMotif(
  building: CompiledEnvironmentalBuildingV3,
  center: Vec2
): MultiPolygon {
  const tangent = building.tangent
  const outward = building.outward
  const rectangle = (
    along: number,
    across: number,
    length: number,
    width: number,
    direction: Vec2 = tangent
  ) =>
    orientedRectangle(
      movePoint(center, tangent, outward, along, across),
      direction,
      length,
      width
    )
  const circle = (along: number, across: number, radius: number) =>
    circlePolygon(
      movePoint(center, tangent, outward, along, across),
      radius,
      12
    )
  const diagonalA = normalize([
    tangent[0] + outward[0],
    tangent[1] + outward[1],
  ])
  const diagonalB = normalize([
    tangent[0] - outward[0],
    tangent[1] - outward[1],
  ])

  switch (building.source.archetype) {
    case "town-pavilion":
      return [
        circle(-1.2, 0, 0.2),
        circle(1.2, 0, 0.2),
        circle(0, -1.2, 0.2),
        circle(0, 1.2, 0.2),
      ]
    case "schoolhouse":
      return [-0.55, 0, 0.55].map((across) => rectangle(0, across, 2.9, 0.11))
    case "academic-hall":
      return [rectangle(0, 0, 1.5, 1.5, diagonalA)]
    case "engineering-campus":
      return [rectangle(0, 0, 2.55, 0.13), rectangle(0, 0, 2.55, 0.13, outward)]
    case "tech-office":
      return [rectangle(0, -0.48, 3.1, 0.12), rectangle(0, 0.48, 3.1, 0.12)]
    case "service-centre":
      return [-0.82, 0, 0.82].map((across) => circle(0, across, 0.24))
    case "software-studio":
      return [
        rectangle(-0.38, 0, 1.55, 0.14, diagonalA),
        rectangle(0.38, 0, 1.55, 0.14, diagonalB),
      ]
    case "health-clinic":
      return [rectangle(0, 0, 1.85, 0.34), rectangle(0, 0, 1.85, 0.34, outward)]
    case "reading-room":
      return [
        rectangle(-0.46, 0, 1.55, 0.62, diagonalA),
        rectangle(0.46, 0, 1.55, 0.62, diagonalB),
      ]
    case "maker-workshop":
      return [-0.72, 0, 0.72].map((along) =>
        rectangle(along, 0, 0.46, 1.7, diagonalA)
      )
    case "community-hall":
      return [
        rectangle(-0.52, 0.12, 1.65, 0.12, diagonalA),
        rectangle(0, 0.28, 1.85, 0.12, outward),
        rectangle(0.52, 0.12, 1.65, 0.12, diagonalB),
      ]
    case "garden-pavilion":
      return [
        circle(-0.62, 0, 0.36),
        circle(0.62, 0, 0.36),
        circle(0, -0.62, 0.36),
        circle(0, 0.62, 0.36),
      ]
  }
}

function createForecourtSiteDetail(options: {
  id: string
  checkpointCenter: Vec2
  interactionRadius: number
  building: CompiledEnvironmentalBuildingV3
  roadBoundary: readonly [Vec2, Vec2]
  field: TerrainFieldV3
}) {
  const buffer: ColoredSiteBuffer = {
    positions: [],
    indices: [],
    colors: [],
  }
  const accent = forecourtAccent(options.building.source.districtId)
  const outerRadius = options.interactionRadius - 0.22
  const ring = difference(
    [circlePolygon(options.checkpointCenter, outerRadius, 28)],
    [circlePolygon(options.checkpointCenter, outerRadius - 0.16, 28)]
  )
  appendColoredSiteShape({
    buffer,
    id: `${options.id}.ring`,
    multiPolygon: ring,
    color: accent,
    field: options.field,
    clearance: ACCESS_SURFACE_CLEARANCE_V3 + 0.009,
  })
  appendColoredSiteShape({
    buffer,
    id: `${options.id}.motif`,
    multiPolygon: forecourtMotif(options.building, options.checkpointCenter),
    color: accent,
    field: options.field,
    clearance: ACCESS_SURFACE_CLEARANCE_V3 + 0.01,
  })

  // The access surface interrupts the longitudinal roadside drain. Two compact
  // headwall caps make the buried culvert legible without adding a collider or
  // a second material/draw-call bucket.
  for (const [index, boundary] of options.roadBoundary.entries()) {
    const headwallCenter: Vec2 = [
      boundary[0] + options.building.outward[0] * 1.08,
      boundary[1] + options.building.outward[1] * 1.08,
    ]
    appendColoredSiteShape({
      buffer,
      id: `${options.id}.culvert.${index}`,
      multiPolygon: [
        orientedRectangle(headwallCenter, options.building.outward, 0.72, 0.2),
      ],
      color: "#6f6253",
      field: options.field,
      clearance: TRAVEL_SURFACE_CLEARANCE_V3 + 0.014,
    })
  }

  return {
    id: options.id,
    kind: "surface",
    materialId: "surface.forecourt-detail",
    y: 0,
    positions: buffer.positions,
    indices: buffer.indices,
    colors: buffer.colors,
    walkable: false,
  } satisfies GeometryDefinitionV3
}

function bridgeAt(point: Vec2, bridges: readonly BridgeManifestV3[]) {
  return bridges.find((bridge) =>
    pointInMultiPolygon(point, [polygonFromPoints(bridge.deckPolygon)])
  )
}

function nearestNode(
  nodes: readonly NavigationNodeV3[],
  point: Vec2,
  kind = "road"
) {
  const candidates = nodes.filter(
    (node) => node.kind === kind || node.kind === "bridge"
  )
  return candidates.reduce(
    (best, node) => {
      const candidateDistance = distance(
        [node.position[0], node.position[2]],
        point
      )
      return !best || candidateDistance < best.distance
        ? { node, distance: candidateDistance }
        : best
    },
    undefined as { node: NavigationNodeV3; distance: number } | undefined
  )?.node
}

export function compilePortfolioCheckpoints(options: {
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  bridges: readonly BridgeManifestV3[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  cells: CellManifestV3[]
  field: TerrainFieldV3
}) {
  const roads = new Map(options.roads.map((road) => [road.source.id, road]))
  const geometries: GeometryDefinitionV3[] = []
  const claimedArrivalBuildingIds = new Set<string>()
  const checkpoints =
    options.world.checkpoints.map<PortfolioCheckpointManifestV3>(
      (checkpoint, checkpointIndex) => {
        const road = roads.get(checkpoint.roadId)
        if (!road) {
          throw new Error(
            `${checkpoint.id} references missing road ${checkpoint.roadId}`
          )
        }
        const arrivalBuilding = options.buildings.find(
          (building) => building.source.id === checkpoint.arrivalBuildingId
        )
        if (!arrivalBuilding) {
          throw new Error(
            `${checkpoint.id} references missing arrival structure ${checkpoint.arrivalBuildingId}`
          )
        }
        if (claimedArrivalBuildingIds.has(checkpoint.arrivalBuildingId)) {
          throw new Error(
            `${checkpoint.arrivalBuildingId} is assigned to multiple arrival forecourts`
          )
        }
        claimedArrivalBuildingIds.add(checkpoint.arrivalBuildingId)
        if (
          arrivalBuilding.roadId !== checkpoint.roadId ||
          arrivalBuilding.source.districtId !== checkpoint.districtId ||
          arrivalBuilding.source.roadSide !== checkpoint.roadSide ||
          Math.abs(
            arrivalBuilding.source.roadProgress - checkpoint.roadProgress
          ) > 0.000_001
        ) {
          throw new Error(
            `${checkpoint.id} arrival structure is outside its route context`
          )
        }
        const segmentIndex = Math.max(
          0,
          Math.min(
            road.points.length - 2,
            Math.round(checkpoint.roadProgress * (road.points.length - 2))
          )
        )
        const buildingSegmentIndex = Math.max(
          0,
          Math.min(
            road.points.length - 2,
            Math.round(
              arrivalBuilding.source.roadProgress * (road.points.length - 2)
            )
          )
        )
        if (buildingSegmentIndex !== segmentIndex) {
          throw new Error(
            `${checkpoint.id} and its arrival structure use different road samples`
          )
        }
        const outward = arrivalBuilding.outward
        const roadBoundary = arrivalBuilding.sharedBoundary2
        const entrancePoint: Vec2 = [
          arrivalBuilding.entrance[0],
          arrivalBuilding.entrance[2],
        ]
        const forecourtDepth = checkpoint.interactionRadius + 0.9
        const point: Vec2 = [
          entrancePoint[0] - outward[0] * forecourtDepth,
          entrancePoint[1] - outward[1] * forecourtDepth,
        ]
        const bridge = bridgeAt(point, options.bridges)
        const y = bridge
          ? bridgeDeckHeightAt(bridge, point)
          : options.field.heightAt(point)
        const clearingPolygon = circlePolygon(
          point,
          checkpoint.interactionRadius,
          18
        )
        // The building access and checkpoint path are one shared surface. The
        // circle is cut out of the road-to-door strip, then rendered once as
        // the retained civic forecourt. This avoids coplanar duplicate meshes.
        const approachSurface = difference(
          [arrivalBuilding.accessPolygon],
          [clearingPolygon]
        )
        const suffix = String(checkpointIndex).padStart(2, "0")
        const approach = triangulateMultiPolygonV3({
          id: `geometry.checkpoint-approach.${suffix}`,
          kind: "surface",
          materialId: "surface.access-sand",
          y: 0,
          multiPolygon: approachSurface,
        })
        const clearing = triangulateMultiPolygonV3({
          id: `geometry.checkpoint-clearing.${suffix}`,
          kind: "surface",
          materialId: "surface.access-sand",
          y: 0,
          multiPolygon: [clearingPolygon],
        })
        const sharedRoadBoundary = roadBoundary.map<Vec3>((boundaryPoint) => {
          const serializedPoint: Vec2 = [
            round(boundaryPoint[0]),
            round(boundaryPoint[1]),
          ]
          return [
            serializedPoint[0],
            round(
              options.field.heightAt(serializedPoint) +
                TRAVEL_SURFACE_CLEARANCE_V3
            ),
            serializedPoint[1],
          ]
        }) as unknown as readonly [Vec3, Vec3]
        for (const geometry of [approach, clearing]) {
          for (let index = 0; index < geometry.positions.length; index += 3) {
            const vertex: Vec2 = [
              geometry.positions[index],
              geometry.positions[index + 2],
            ]
            const shared = sharedRoadBoundary.some(
              (boundary) =>
                Math.abs(boundary[0] - vertex[0]) < 0.001 &&
                Math.abs(boundary[2] - vertex[1]) < 0.001
            )
            geometry.positions[index + 1] = round(
              options.field.heightAt(vertex) +
                (shared
                  ? TRAVEL_SURFACE_CLEARANCE_V3
                  : ACCESS_SURFACE_CLEARANCE_V3)
            )
          }
        }
        // Stream the complete arrival site from the cell containing its
        // substantial structure. The forecourt can straddle a grid boundary,
        // so assigning ownership from its interaction point can concentrate
        // several buildings in the adjacent cell even though their footprints
        // are physically distributed across the grid.
        const cellId = cellIdAtV3(arrivalBuilding.center, options.world)
        const cell = options.cells.find((candidate) => candidate.id === cellId)
        if (!cell) throw new Error(`${checkpoint.id} is outside world bounds`)
        const siteDetail = createForecourtSiteDetail({
          id: `geometry.checkpoint-site-detail.${suffix}`,
          checkpointCenter: point,
          interactionRadius: checkpoint.interactionRadius,
          building: arrivalBuilding,
          roadBoundary,
          field: options.field,
        })
        geometries.push(approach, clearing, siteDetail)
        cell.geometryIds.push(approach.id, clearing.id, siteDetail.id)
        return {
          id: checkpoint.id,
          recordId: checkpoint.recordId,
          arrivalBuildingId: checkpoint.arrivalBuildingId,
          districtId: checkpoint.districtId,
          roadId: checkpoint.roadId,
          position: [round(point[0]), round(y + 0.06), round(point[1])],
          interactionRadius: checkpoint.interactionRadius,
          navNodeId: `nav.checkpoint.${checkpoint.recordId}`,
          approachGeometryIds: [approach.id, clearing.id],
          sharedRoadBoundary,
        }
      }
    )
  const arrivalBuildingCellIds = new Map<string, string>()
  const arrivalBuildingSurfaceIds = new Map<string, readonly [string, string]>()
  for (const [index, checkpoint] of checkpoints.entries()) {
    const authored = options.world.checkpoints[index]
    const cell = options.cells.find((candidate) =>
      candidate.geometryIds.includes(checkpoint.approachGeometryIds[1])
    )
    if (cell) {
      arrivalBuildingCellIds.set(authored.arrivalBuildingId, cell.id)
      arrivalBuildingSurfaceIds.set(authored.arrivalBuildingId, [
        checkpoint.approachGeometryIds[0],
        checkpoint.approachGeometryIds[1],
      ])
    }
  }
  return {
    checkpoints,
    geometries,
    arrivalBuildingCellIds,
    arrivalBuildingSurfaceIds,
  }
}

export function compileNavigationV3(options: {
  world: AuthoredWorldV3
  roads: readonly SampledRoad[]
  waters: readonly CompiledWaterShapeV3[]
  bridges: BridgeManifestV3[]
  buildings: readonly CompiledEnvironmentalBuildingV3[]
  checkpoints: readonly PortfolioCheckpointManifestV3[]
  field: TerrainFieldV3
}) {
  const nodes: NavigationNodeV3[] = []
  const edges: NavigationEdgeV3[] = []

  for (const road of options.roads) {
    const roadNodes: NavigationNodeV3[] = road.points.map((point, index) => {
      const bridge = bridgeAt(point, options.bridges)
      const id = `nav.road.${road.source.id}.${String(index).padStart(3, "0")}`
      return {
        id,
        position: [
          round(point[0]),
          bridge
            ? round(bridgeDeckHeightAt(bridge, point) + 0.02)
            : round(
                options.field.heightAt(point) + TRAVEL_CENTERLINE_CLEARANCE_V3
              ),
          round(point[1]),
        ],
        cellId: cellIdAtV3(point, options.world),
        kind: bridge ? "bridge" : "road",
        walkableSurfaceId: bridge?.id ?? road.source.id,
      }
    })
    nodes.push(...roadNodes)
    for (let index = 0; index < roadNodes.length - 1; index += 1) {
      const a = roadNodes[index]
      const b = roadNodes[index + 1]
      const midpoint: Vec2 = [
        (a.position[0] + b.position[0]) / 2,
        (a.position[2] + b.position[2]) / 2,
      ]
      const water = options.waters.find((candidate) =>
        pointInMultiPolygon(midpoint, candidate.multiPolygon)
      )
      const bridge = bridgeAt(midpoint, options.bridges)
      if (water && !bridge) {
        throw new Error(
          `Navigation ${a.id} -> ${b.id} enters ${water.id} without a bridge`
        )
      }
      edges.push({
        id: `nav-edge.road.${road.source.id}.${String(index).padStart(3, "0")}`,
        a: a.id,
        b: b.id,
        cost: round(
          Math.hypot(
            b.position[0] - a.position[0],
            b.position[1] - a.position[1],
            b.position[2] - a.position[2]
          )
        ),
        kind: bridge ? "bridge" : "road",
        ...(bridge ? { waterOverrideBridgeId: bridge.id } : {}),
      })
    }
  }

  for (const checkpoint of options.checkpoints) {
    const point: Vec2 = [checkpoint.position[0], checkpoint.position[2]]
    const anchor = nearestNode(nodes, point)
    if (!anchor)
      throw new Error(`${checkpoint.id} has no reachable road anchor`)
    const node: NavigationNodeV3 = {
      id: checkpoint.navNodeId,
      position: checkpoint.position,
      cellId: cellIdAtV3(point, options.world),
      kind: "checkpoint",
      walkableSurfaceId: checkpoint.id,
    }
    nodes.push(node)
    edges.push({
      id: `nav-edge.checkpoint.${checkpoint.recordId}`,
      a: anchor.id,
      b: node.id,
      cost: round(distance([anchor.position[0], anchor.position[2]], point)),
      kind: "checkpoint",
    })
  }

  for (const building of options.buildings) {
    const point: Vec2 = [building.entrance[0], building.entrance[2]]
    const anchor = nearestNode(nodes, point)
    if (!anchor)
      throw new Error(`${building.source.id} has no reachable road anchor`)
    const node: NavigationNodeV3 = {
      id: `nav.access.${building.source.id}`,
      position: building.entrance,
      cellId: cellIdAtV3(point, options.world),
      kind: "access",
      walkableSurfaceId: `junction.${building.source.id}`,
    }
    nodes.push(node)
    edges.push({
      id: `nav-edge.access.${building.source.id}`,
      a: anchor.id,
      b: node.id,
      cost: round(distance([anchor.position[0], anchor.position[2]], point)),
      kind: "access",
    })
  }

  for (const bridge of options.bridges) {
    const bridgeNodes = nodes.filter(
      (node) =>
        node.kind === "bridge" &&
        pointInMultiPolygon(
          [node.position[0], node.position[2]],
          [polygonFromPoints(bridge.deckPolygon)]
        )
    )
    if (bridgeNodes.length < 2) {
      throw new Error(`${bridge.id} has fewer than two navigation anchors`)
    }
    bridge.navNodeIds = [
      bridgeNodes[0].id,
      bridgeNodes[bridgeNodes.length - 1].id,
    ]
  }

  const checkpointNodeIds = Object.fromEntries(
    options.checkpoints.map((checkpoint) => [
      checkpoint.recordId,
      checkpoint.navNodeId,
    ])
  )
  return { nodes, edges, checkpointNodeIds }
}
